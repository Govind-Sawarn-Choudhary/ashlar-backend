const express = require('express');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  login,
  getLawyers,
  getLawyer,
  patchVerification,
  patchBarVerification,
  getStats,
} = require('../controllers/admin.controller');
const extended = require('../controllers/adminExtended.controller');

const router = express.Router();

router.post('/login', login);
router.get('/stats', requireAdmin, getStats);
router.get('/stats/overview', requireAdmin, extended.getExtendedStats);
router.get('/integrations', requireAdmin, extended.getIntegrations);
router.get('/lawyers', requireAdmin, getLawyers);
router.get('/lawyers/:id', requireAdmin, getLawyer);
router.patch('/lawyers/:id/verification', requireAdmin, patchVerification);
router.patch('/lawyers/:id/bar-verification', requireAdmin, patchBarVerification);

router.get('/users', requireAdmin, extended.listUsers);
router.get('/users/:id', requireAdmin, extended.getUser);
router.get('/appointments', requireAdmin, extended.listAppointments);
router.get('/appointments/:id', requireAdmin, extended.getAppointment);
router.get('/consultations', requireAdmin, extended.listConsultations);
router.get('/consultations/:id', requireAdmin, extended.getConsultation);
router.post('/consultations/:id/end', requireAdmin, extended.endConsultation);
router.get('/payments', requireAdmin, extended.listPayments);
router.get('/settings', requireAdmin, extended.getSettings);
router.put('/settings', requireAdmin, extended.updateSettings);

module.exports = router;
