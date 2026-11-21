const db = require('../db');
const paymentService = require('./payment.service');
const walletService = require('./wallet.service');
const notificationService = require('./notification.service');

function listCategories() {
  return db
    .prepare(`
      SELECT id, name, slug, description, sort_order AS sortOrder
      FROM document_categories
      ORDER BY sort_order ASC
    `)
    .all();
}

function listProductsByCategory(categoryId) {
  return db
    .prepare(`
      SELECT id, category_id AS categoryId, name, description, price, sort_order AS sortOrder
      FROM document_products
      WHERE category_id = ?
      ORDER BY sort_order ASC
    `)
    .all(categoryId);
}

function getCategoryBySlug(slug) {
  return db
    .prepare(`
      SELECT id, name, slug, description, sort_order AS sortOrder
      FROM document_categories
      WHERE slug = ?
    `)
    .get(slug);
}

function getProductById(productId) {
  return db
    .prepare(`
      SELECT id, category_id AS categoryId, name, description, price
      FROM document_products
      WHERE id = ?
    `)
    .get(productId);
}

function purchaseProduct(userId, productId, { payFromWallet } = {}) {
  const product = getProductById(productId);
  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  const amount = Number(product.price);
  if (!amount || amount <= 0) {
    const error = new Error('Invalid product price');
    error.status = 400;
    throw error;
  }

  if (!payFromWallet) {
    const error = new Error('Gateway payments must use Razorpay order flow');
    error.status = 400;
    throw error;
  }

  walletService.debitWallet(userId, 'user', {
    amount,
    description: `Document: ${product.name}`,
    referenceType: 'document',
  });

  const payment = paymentService.createPayment(userId, {
    amount,
    paymentType: 'document',
    metadata: { productId, productName: product.name, source: 'wallet' },
  });

  notificationService.createNotification(userId, 'user', {
    title: 'Document order placed',
    body: `${product.name} order received. Our team will contact you shortly.`,
  });

  return { product, payment };
}

function listUserOrders(userId) {
  const rows = db
    .prepare(`
      SELECT id, amount, status, reference, metadata, created_at
      FROM payments
      WHERE user_id = ? AND payment_type = 'document' AND status = 'completed'
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `)
    .all(userId);

  return rows.map((row) => {
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      paymentId: row.id,
      amount: row.amount,
      status: row.status,
      reference: row.reference,
      productId: metadata.productId ?? null,
      productName: metadata.productName ?? 'Legal document',
      createdAt: row.created_at,
    };
  });
}

module.exports = {
  listCategories,
  listProductsByCategory,
  getCategoryBySlug,
  getProductById,
  purchaseProduct,
  listUserOrders,
};
