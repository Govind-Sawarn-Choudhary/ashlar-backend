const db = require('../db');

function getOrCreateWallet(userId, role) {
  let wallet = db
    .prepare('SELECT * FROM wallets WHERE user_id = ? AND role = ?')
    .get(userId, role);

  if (!wallet) {
    db.prepare('INSERT INTO wallets (user_id, role, balance) VALUES (?, ?, 0)').run(
      userId,
      role,
    );
    wallet = db
      .prepare('SELECT * FROM wallets WHERE user_id = ? AND role = ?')
      .get(userId, role);
  }

  return wallet;
}

function mapTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    description: row.description,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
}

function getWalletSummary(userId, role) {
  const wallet = getOrCreateWallet(userId, role);
  const transactions = db
    .prepare(`
      SELECT * FROM wallet_transactions
      WHERE wallet_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `)
    .all(wallet.id)
    .map(mapTransaction);

  return {
    balance: wallet.balance,
    transactions,
  };
}

function getFilteredTransactions(userId, role, filter = 'all') {
  const wallet = getOrCreateWallet(userId, role);
  let query = `
    SELECT * FROM wallet_transactions
    WHERE wallet_id = ?
  `;

  if (filter === 'credit') {
    query += " AND type = 'credit'";
  } else if (filter === 'debit') {
    query += " AND type = 'debit'";
  }

  query += ' ORDER BY datetime(created_at) DESC LIMIT 100';

  return db.prepare(query).all(wallet.id).map(mapTransaction);
}

function addTransaction(walletId, { type, amount, description, referenceType, referenceId }) {
  if (amount <= 0) {
    const error = new Error('Amount must be greater than zero');
    error.status = 400;
    throw error;
  }

  const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(walletId);
  if (!wallet) {
    const error = new Error('Wallet not found');
    error.status = 404;
    throw error;
  }

  if (type === 'debit' && wallet.balance < amount) {
    const error = new Error('Insufficient wallet balance');
    error.status = 400;
    throw error;
  }

  const delta = type === 'credit' ? amount : -amount;

  db.prepare(`
    UPDATE wallets
    SET balance = balance + ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(delta, walletId);

  const result = db.prepare(`
    INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(walletId, type, amount, description || null, referenceType || null, referenceId || null);

  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(result.lastInsertRowid);
}

function creditWallet(userId, role, payload) {
  const wallet = getOrCreateWallet(userId, role);
  return addTransaction(wallet.id, { type: 'credit', ...payload });
}

function debitWallet(userId, role, payload) {
  const wallet = getOrCreateWallet(userId, role);
  return addTransaction(wallet.id, { type: 'debit', ...payload });
}

function addFunds(userId, amount) {
  return creditWallet(userId, 'user', {
    amount,
    description: 'Wallet top-up',
    referenceType: 'wallet_topup',
  });
}

function getMinWithdrawal() {
  const row = db
    .prepare('SELECT value FROM platform_settings WHERE key = ?')
    .get('min_wallet_withdrawal');
  const parsed = Number.parseFloat(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

function withdrawLawyerBalance(userId, amount) {
  const minAmount = getMinWithdrawal();

  if (!amount || amount <= 0) {
    const error = new Error('Valid withdrawal amount is required');
    error.status = 400;
    throw error;
  }

  if (amount < minAmount) {
    const error = new Error(`Minimum withdrawal amount is ₹${minAmount}`);
    error.status = 400;
    throw error;
  }

  const wallet = getOrCreateWallet(userId, 'lawyer');
  if (wallet.balance < amount) {
    const error = new Error('Insufficient wallet balance');
    error.status = 400;
    throw error;
  }

  const transaction = debitWallet(userId, 'lawyer', {
    amount,
    description: 'Withdrawal to bank account',
    referenceType: 'wallet_withdrawal',
  });

  return {
    balance: getOrCreateWallet(userId, 'lawyer').balance,
    transaction: mapTransaction(transaction),
  };
}

module.exports = {
  getOrCreateWallet,
  getWalletSummary,
  getFilteredTransactions,
  creditWallet,
  debitWallet,
  addFunds,
  addTransaction,
  withdrawLawyerBalance,
  getMinWithdrawal,
};
