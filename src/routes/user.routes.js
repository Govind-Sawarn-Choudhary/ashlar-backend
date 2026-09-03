const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMe, saveProfile } = require('../controllers/user.controller');
const marketplace = require('../controllers/userMarketplace.controller');
const paymentController = require('../controllers/payment.controller');
const consultationController = require('../controllers/consultation.controller');

const router = express.Router();

function requireUserRole(req, res, next) {
  if (req.auth.role !== 'user') {
    return res.status(403).json({ error: 'User access only' });
  }
  next();
}

router.get('/me', requireAuth, requireUserRole, getMe);
router.put('/profile', requireAuth, requireUserRole, saveProfile);

router.get('/dashboard', requireAuth, requireUserRole, marketplace.getDashboard);
router.get('/wallet', requireAuth, requireUserRole, marketplace.getWallet);
router.post('/wallet/add-funds', requireAuth, requireUserRole, marketplace.addWalletFunds);

router.get('/lawyers', requireAuth, requireUserRole, marketplace.listLawyers);
router.get('/lawyers/:id', requireAuth, requireUserRole, marketplace.getLawyer);
router.post('/lawyers/:id/favourite', requireAuth, requireUserRole, marketplace.toggleFavourite);

router.post('/bookings', requireAuth, requireUserRole, marketplace.createBooking);
router.get('/appointments', requireAuth, requireUserRole, marketplace.listAppointments);

router.get('/consultations', requireAuth, requireUserRole, consultationController.listConsultations);
router.get('/appointments/:appointmentId/consultation', requireAuth, requireUserRole, consultationController.getSession);
router.post('/appointments/:appointmentId/consultation/join', requireAuth, requireUserRole, consultationController.joinSession);
router.get('/consultations/:sessionId/messages', requireAuth, requireUserRole, consultationController.listMessages);
router.post('/consultations/:sessionId/messages', requireAuth, requireUserRole, consultationController.sendMessage);
router.post('/consultations/:sessionId/end', requireAuth, requireUserRole, consultationController.endSession);

router.get('/payments/razorpay/config', requireAuth, requireUserRole, paymentController.getRazorpayConfig);
router.post('/payments/razorpay/order', requireAuth, requireUserRole, paymentController.createRazorpayOrder);
router.post('/payments/razorpay/verify', requireAuth, requireUserRole, paymentController.verifyRazorpayPayment);
router.get('/payments/:id', requireAuth, requireUserRole, marketplace.getPayment);

router.post('/challan/lookup', requireAuth, requireUserRole, marketplace.lookupChallan);
router.post('/challan/send-otp', requireAuth, requireUserRole, marketplace.sendChallanOtp);
router.post('/challan/verify-otp', requireAuth, requireUserRole, marketplace.verifyChallanOtp);
router.get('/challan', requireAuth, requireUserRole, marketplace.listChallans);
router.post('/challan/:id/pay', requireAuth, requireUserRole, marketplace.payChallan);

router.get('/notifications', requireAuth, requireUserRole, marketplace.listNotifications);
router.patch('/notifications/read-all', requireAuth, requireUserRole, marketplace.markAllNotificationsRead);
router.patch('/notifications/:id/read', requireAuth, requireUserRole, marketplace.markNotificationRead);

router.get('/documents/categories', requireAuth, requireUserRole, marketplace.listDocumentCategories);
router.get('/documents/categories/:categoryId/products', requireAuth, requireUserRole, marketplace.listDocumentProducts);
router.post('/documents/purchase', requireAuth, requireUserRole, marketplace.purchaseDocument);

router.get('/support', requireAuth, requireUserRole, marketplace.getSupportInfo);

module.exports = router;
