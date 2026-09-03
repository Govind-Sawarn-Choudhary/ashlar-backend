const crypto = require('crypto');
const db = require('../db');

function generateReference(prefix) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${Date.now()}-${suffix}`;
}

function mapPayment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    paymentType: row.payment_type,
    status: row.status,
    reference: row.reference,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    razorpayOrderId: row.razorpay_order_id || null,
    razorpayPaymentId: row.razorpay_payment_id || null,
    createdAt: row.created_at,
  };
}

function createPayment(userId, { amount, paymentType, metadata, status = 'completed' }) {
  if (amount <= 0) {
    const error = new Error('Payment amount must be greater than zero');
    error.status = 400;
    throw error;
  }

  const reference = generateReference('PAY');
  const result = db.prepare(`
    INSERT INTO payments (user_id, amount, payment_type, status, reference, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    amount,
    paymentType,
    status,
    reference,
    metadata ? JSON.stringify(metadata) : null,
  );

  return mapPayment(db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid));
}

function createPendingPayment(userId, { amount, paymentType, metadata }) {
  return createPayment(userId, {
    amount,
    paymentType,
    metadata,
    status: 'pending',
  });
}

function attachRazorpayOrder(paymentId, razorpayOrderId) {
  db.prepare(`
    UPDATE payments
    SET razorpay_order_id = ?
    WHERE id = ?
  `).run(razorpayOrderId, paymentId);

  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

function completePayment(paymentId, { razorpayOrderId, razorpayPaymentId }) {
  db.prepare(`
    UPDATE payments
    SET status = 'completed',
        razorpay_order_id = COALESCE(?, razorpay_order_id),
        razorpay_payment_id = ?
    WHERE id = ?
  `).run(razorpayOrderId, razorpayPaymentId, paymentId);

  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  return row ? mapPayment(row) : null;
}

function markPaymentFailed(paymentId) {
  db.prepare(`
    UPDATE payments
    SET status = 'failed'
    WHERE id = ?
  `).run(paymentId);
}

function getPayment(userId, paymentId) {
  const row = db
    .prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?')
    .get(paymentId, userId);

  return row ? mapPayment(row) : null;
}

function getPaymentById(paymentId) {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  return row ? mapPayment(row) : null;
}

function getPaymentByRazorpayOrderId(orderId) {
  const row = db
    .prepare('SELECT * FROM payments WHERE razorpay_order_id = ?')
    .get(orderId);

  return row ? mapPayment(row) : null;
}

function listPaymentsForAdmin({ limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT p.*, u.phone AS user_phone, up.full_name AS user_name
    FROM payments p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    ORDER BY datetime(p.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  return rows.map((row) => ({
    ...mapPayment(row),
    userPhone: row.user_phone,
    userName: row.user_name,
  }));
}

module.exports = {
  createPayment,
  createPendingPayment,
  attachRazorpayOrder,
  completePayment,
  markPaymentFailed,
  getPayment,
  getPaymentById,
  getPaymentByRazorpayOrderId,
  listPaymentsForAdmin,
  generateReference,
};
