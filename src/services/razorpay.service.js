const crypto = require('crypto');
const Razorpay = require('razorpay');
const config = require('../config');

let client = null;

function getClient() {
  if (!config.razorpayEnabled) {
    return null;
  }

  if (!client) {
    client = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }

  return client;
}

function verifyPaymentSignature({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(body)
    .digest('hex');

  return expected === razorpaySignature;
}

async function createOrder({ amount, receipt, notes = {} }) {
  const razorpay = getClient();
  if (!razorpay) {
    const error = new Error('Razorpay is not configured on the server');
    error.status = 503;
    throw error;
  }

  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt,
    notes,
  });

  return order;
}

module.exports = {
  getClient,
  verifyPaymentSignature,
  createOrder,
};
