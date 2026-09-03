const asyncHandler = require('../utils/asyncHandler');
const { buildUserAuthPayload } = require('../services/user.service');
const walletService = require('../services/wallet.service');
const paymentService = require('../services/payment.service');
const marketplaceService = require('../services/marketplace.service');
const appointmentService = require('../services/appointment.service');
const challanService = require('../services/challan.service');
const notificationService = require('../services/notification.service');
const documentService = require('../services/document.service');
const db = require('../db');

const getDashboard = asyncHandler(async (req, res) => {
  const userId = req.auth.sub;
  notificationService.seedWelcomeNotification(userId, 'user');

  const wallet = walletService.getWalletSummary(userId, 'user');
  const appointments = appointmentService.listUserAppointments(userId).slice(0, 5);
  const lawyers = marketplaceService.listApprovedLawyers({ userId, limit: 4 });

  res.json({
    walletBalance: wallet.balance,
    recentAppointments: appointments,
    featuredLawyers: lawyers,
    preference: 'law',
  });
});

const getWallet = asyncHandler(async (req, res) => {
  const filter = req.query.filter || 'all';
  const wallet = walletService.getWalletSummary(req.auth.sub, 'user');
  const transactions = walletService.getFilteredTransactions(
    req.auth.sub,
    'user',
    filter,
  );

  res.json({ balance: wallet.balance, transactions });
});

const addWalletFunds = asyncHandler(async (req, res) => {
  return res.status(400).json({
    error: 'Use POST /api/user/payments/razorpay/order with paymentType wallet_topup',
  });
});

const listLawyers = asyncHandler(async (req, res) => {
  const lawyers = marketplaceService.listApprovedLawyers({
    q: req.query.q,
    practiceArea: req.query.practiceArea,
    userId: req.auth.sub,
    limit: Number.parseInt(req.query.limit, 10) || 20,
    offset: Number.parseInt(req.query.offset, 10) || 0,
  });

  res.json({ lawyers });
});

const getLawyer = asyncHandler(async (req, res) => {
  const lawyer = marketplaceService.getApprovedLawyerById(
    Number(req.params.id),
    req.auth.sub,
  );

  if (!lawyer) {
    return res.status(404).json({ error: 'Lawyer not found' });
  }

  res.json({ lawyer });
});

const toggleFavourite = asyncHandler(async (req, res) => {
  const result = marketplaceService.toggleFavourite(
    req.auth.sub,
    Number(req.params.id),
  );
  res.json(result);
});

const createBooking = asyncHandler(async (req, res) => {
  const { lawyerId, mode, consultationType, scheduledAt, notes, payFromWallet } =
    req.body;

  if (!lawyerId || !mode || !consultationType) {
    return res.status(400).json({
      error: 'lawyerId, mode, and consultationType are required',
    });
  }

  const appointment = appointmentService.createBooking(req.auth.sub, {
    lawyerId: Number(lawyerId),
    mode,
    consultationType,
    scheduledAt,
    notes,
    payFromWallet: Boolean(payFromWallet),
  });

  const payment = paymentService.getPayment(req.auth.sub, appointment.paymentId);

  res.status(201).json({ appointment, payment });
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = appointmentService.listUserAppointments(
    req.auth.sub,
    req.query.status,
  );
  res.json({ appointments });
});

const getPayment = asyncHandler(async (req, res) => {
  const payment = paymentService.getPayment(req.auth.sub, Number(req.params.id));
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  res.json({ payment });
});

const lookupChallan = asyncHandler(async (req, res) => {
  const { vehicleNumber } = req.body;
  const result = challanService.lookupVehicle(req.auth.sub, vehicleNumber);
  res.json(result);
});

const sendChallanOtp = asyncHandler(async (req, res) => {
  const { vehicleNumber, mobile } = req.body;
  const result = challanService.sendChallanOtp(req.auth.sub, vehicleNumber, mobile);
  res.json(result);
});

const verifyChallanOtp = asyncHandler(async (req, res) => {
  const { vehicleNumber, mobile, otp } = req.body;
  const result = challanService.verifyChallanOtp(
    req.auth.sub,
    vehicleNumber,
    mobile,
    otp,
  );
  res.json(result);
});

const listChallans = asyncHandler(async (req, res) => {
  const challans = challanService.listChallans(req.auth.sub, {
    vehicleNumber: req.query.vehicleNumber,
    status: req.query.status,
  });
  res.json({ challans });
});

const payChallan = asyncHandler(async (req, res) => {
  const result = challanService.payChallan(
    req.auth.sub,
    Number(req.params.id),
    { payFromWallet: Boolean(req.body.payFromWallet) },
  );
  res.json(result);
});

const listNotifications = asyncHandler(async (req, res) => {
  const notifications = notificationService.listNotifications(req.auth.sub, 'user');
  res.json({ notifications });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = notificationService.markNotificationRead(
    req.auth.sub,
    'user',
    Number(req.params.id),
  );
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ notification });
});

const listDocumentCategories = asyncHandler(async (_req, res) => {
  const categories = documentService.listCategories();
  res.json({ categories });
});

const listDocumentProducts = asyncHandler(async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const products = documentService.listProductsByCategory(categoryId);
  res.json({ products });
});

const getSupportInfo = asyncHandler(async (_req, res) => {
  const phone = db
    .prepare('SELECT value FROM platform_settings WHERE key = ?')
    .get('support_phone')?.value;

  res.json({
    supportPhone: phone || '+91-3333-333-333',
    socialLinks: {
      facebook: 'https://facebook.com',
      whatsapp: 'https://wa.me/',
      twitter: 'https://twitter.com',
      linkedin: 'https://linkedin.com',
      telegram: 'https://t.me/',
    },
  });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.auth.sub, 'user');
  res.json({ success: true });
});

const purchaseDocument = asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId);
  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  const result = documentService.purchaseProduct(req.auth.sub, productId, {
    payFromWallet: Boolean(req.body.payFromWallet),
  });

  res.status(201).json(result);
});

module.exports = {
  getDashboard,
  getWallet,
  addWalletFunds,
  listLawyers,
  getLawyer,
  toggleFavourite,
  createBooking,
  listAppointments,
  getPayment,
  lookupChallan,
  sendChallanOtp,
  verifyChallanOtp,
  listChallans,
  payChallan,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listDocumentCategories,
  listDocumentProducts,
  purchaseDocument,
  getSupportInfo,
};
