const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { requireLawyer } = require('../middleware/auth');
const { verifyEnrollment } = require('../controllers/barCouncil.controller');
const {
  getMe,
  saveDetails,
  uploadDocument,
  completeDocuments,
  saveAvailability,
  saveFees,
  skipOnboarding,
} = require('../controllers/lawyer.controller');
const marketplace = require('../controllers/lawyerMarketplace.controller');
const consultationController = require('../controllers/consultation.controller');

const uploadsPath = path.join(__dirname, '../../', config.uploadsDir);
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsPath),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${req.auth.sub}-${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();

router.post('/verify-bar-enrollment', requireLawyer, verifyEnrollment);
router.get('/me', requireLawyer, getMe);
router.put('/profile/details', requireLawyer, saveDetails);
router.post('/profile/documents', requireLawyer, upload.single('file'), uploadDocument);
router.post('/profile/documents/complete', requireLawyer, completeDocuments);
router.post('/profile/skip-onboarding', requireLawyer, skipOnboarding);
router.put('/profile/availability', requireLawyer, saveAvailability);
router.put('/profile/fees', requireLawyer, saveFees);

router.get('/dashboard', requireLawyer, marketplace.getDashboardStats);
router.get('/wallet', requireLawyer, marketplace.getWallet);
router.post('/wallet/withdraw', requireLawyer, marketplace.withdrawWallet);
router.get('/appointments', requireLawyer, marketplace.listAppointments);
router.patch('/appointments/:id/status', requireLawyer, marketplace.updateAppointmentStatus);

router.get('/consultations', requireLawyer, consultationController.listConsultations);
router.get('/appointments/:appointmentId/consultation', requireLawyer, consultationController.getSession);
router.post('/appointments/:appointmentId/consultation/join', requireLawyer, consultationController.joinSession);
router.get('/consultations/:sessionId/messages', requireLawyer, consultationController.listMessages);
router.post('/consultations/:sessionId/messages', requireLawyer, consultationController.sendMessage);
router.post('/consultations/:sessionId/end', requireLawyer, consultationController.endSession);

router.get('/notifications', requireLawyer, marketplace.listNotifications);
router.patch('/notifications/read-all', requireLawyer, marketplace.markAllNotificationsRead);
router.patch('/notifications/:id/read', requireLawyer, marketplace.markNotificationRead);

module.exports = router;
