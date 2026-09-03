const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');
const paymentService = require('../services/payment.service');
const razorpayService = require('../services/razorpay.service');
const paymentFulfillment = require('../services/paymentFulfillment.service');

const ALLOWED_TYPES = new Set(['booking', 'challan', 'wallet_topup', 'document']);
const getRazorpayConfig = asyncHandler(async (_req, res) => {
  res.json({
    enabled: config.razorpayEnabled,
    keyId: config.razorpayEnabled ? config.razorpayKeyId : null,
    currency: 'INR',
  });
});

const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { paymentType, amount, metadata = {} } = req.body;

  if (!ALLOWED_TYPES.has(paymentType)) {
    return res.status(400).json({ error: 'Invalid payment type' });
  }

  const resolvedAmount = paymentFulfillment.resolveOrderAmount(
    req.auth.sub,
    paymentType,
    metadata,
    amount,
  );

  const payment = paymentService.createPendingPayment(req.auth.sub, {
    amount: resolvedAmount,
    paymentType,
    metadata: { ...metadata, source: 'razorpay' },
  });

  const order = await razorpayService.createOrder({
    amount: resolvedAmount,
    receipt: payment.reference,
    notes: {
      paymentId: String(payment.id),
      paymentType,
      userId: String(req.auth.sub),
    },
  });

  paymentService.attachRazorpayOrder(payment.id, order.id);

  res.status(201).json({
    paymentId: payment.id,
    orderId: order.id,
    keyId: config.razorpayKeyId,
    amount: resolvedAmount,
    currency: order.currency,
    reference: payment.reference,
  });
});

const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    paymentId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  } = req.body;

  if (!paymentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({
      error: 'paymentId, razorpay_order_id, razorpay_payment_id, and razorpay_signature are required',
    });
  }

  const payment = paymentService.getPayment(req.auth.sub, Number(paymentId));
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (payment.status === 'completed') {
    const fulfillment = paymentFulfillment.fulfillPayment(req.auth.sub, payment);
    return res.json({ payment, fulfillment, alreadyCompleted: true });
  }

  const valid = razorpayService.verifyPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!valid) {
    paymentService.markPaymentFailed(Number(paymentId));
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  const completed = paymentService.completePayment(Number(paymentId), {
    razorpayOrderId,
    razorpayPaymentId,
  });

  const fulfillment = paymentFulfillment.fulfillPayment(req.auth.sub, completed);

  res.json({ payment: completed, fulfillment });
});

module.exports = {
  getRazorpayConfig,
  createRazorpayOrder,
  verifyRazorpayPayment,
};
