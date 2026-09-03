const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');
const db = require('../db');
const appointmentService = require('../services/appointment.service');
const paymentService = require('../services/payment.service');
const consultationService = require('../services/consultation.service');
const platformSettings = require('../services/platformSettings.service');
const agoraService = require('../services/agora.service');

const listUsers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT u.id, u.phone, u.created_at AS createdAt, up.full_name AS fullName,
      up.location, up.email, up.language, up.profile_complete AS profileComplete
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE u.role = 'user'
  `;
  const params = [];

  if (search?.trim()) {
    query += ' AND (u.phone LIKE ? OR up.full_name LIKE ? OR up.email LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY datetime(u.created_at) DESC LIMIT 100';

  const users = db.prepare(query).all(...params);
  res.json({ users });
});

const getUser = asyncHandler(async (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.phone, u.created_at AS createdAt, up.full_name AS fullName,
      up.location, up.email, up.language, up.profile_complete AS profileComplete
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE u.id = ? AND u.role = 'user'
  `).get(Number(req.params.id));

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const wallet = db.prepare(`
    SELECT balance FROM wallets WHERE user_id = ? AND role = 'user'
  `).get(user.id);

  const appointments = appointmentService.listUserAppointments(user.id);

  res.json({
    user: {
      ...user,
      profileComplete: Boolean(user.profileComplete),
      walletBalance: wallet?.balance ?? 0,
    },
    appointments,
  });
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = appointmentService.listAllAppointmentsForAdmin({
    status: req.query.status,
    limit: Number.parseInt(req.query.limit, 10) || 50,
    offset: Number.parseInt(req.query.offset, 10) || 0,
  });

  const filtered = appointments.filter((item) => {
    if (req.query.consultationType && item.consultationType !== req.query.consultationType) {
      return false;
    }
    if (req.query.mode && item.mode !== req.query.mode) {
      return false;
    }
    return true;
  });

  res.json({ appointments: filtered });
});

const getAppointment = asyncHandler(async (req, res) => {
  const appointment = appointmentService.getAppointmentById(Number(req.params.id));
  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const payment = appointment.paymentId
    ? paymentService.getPaymentById(appointment.paymentId)
    : null;

  const consultation = consultationService.getSessionByAppointmentForAdmin(appointment.id);

  res.json({ appointment, payment, consultation });
});

const listPayments = asyncHandler(async (req, res) => {
  const payments = paymentService.listPaymentsForAdmin({
    limit: Number.parseInt(req.query.limit, 10) || 50,
    offset: Number.parseInt(req.query.offset, 10) || 0,
    status: req.query.status,
    paymentType: req.query.paymentType,
  });
  res.json({ payments });
});

const listConsultations = asyncHandler(async (req, res) => {
  const sessions = consultationService.listSessionsForAdmin({
    status: req.query.status,
    limit: Number.parseInt(req.query.limit, 10) || 50,
    offset: Number.parseInt(req.query.offset, 10) || 0,
  });
  res.json({ sessions });
});

const getConsultation = asyncHandler(async (req, res) => {
  const detail = consultationService.getSessionDetailForAdmin(Number(req.params.id));
  if (!detail) {
    return res.status(404).json({ error: 'Consultation session not found' });
  }
  res.json(detail);
});

const endConsultation = asyncHandler(async (req, res) => {
  const session = consultationService.adminForceEndSession(Number(req.params.id));
  res.json({ session });
});

const getIntegrations = asyncHandler(async (_req, res) => {
  res.json({
    razorpay: {
      enabled: config.razorpayEnabled,
      keyConfigured: Boolean(config.razorpayKeyId),
    },
    agora: {
      enabled: agoraService.isEnabled(),
      appIdConfigured: Boolean(config.agoraAppId),
      certificateConfigured: Boolean(config.agoraAppCertificate),
      chatAppKeyConfigured: Boolean(config.agoraChatAppKey),
    },
    otp: {
      testMode: true,
      testPhone: config.tempOtpPhone,
    },
  });
});

const getExtendedStats = asyncHandler(async (_req, res) => {
  const lawyerStats = db.prepare(`
    SELECT
      SUM(CASE WHEN verification_status = 'pending' AND onboarding_step = 'complete' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN verification_status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN verification_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      COUNT(*) AS total
    FROM lawyer_profiles
  `).get();

  const userCount = db.prepare(`
    SELECT COUNT(*) AS count FROM users WHERE role = 'user'
  `).get().count;

  const appointmentCount = db.prepare(`
    SELECT COUNT(*) AS count FROM appointments
  `).get().count;

  const paymentTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'completed'
  `).get().total;

  const activeConsultations = db.prepare(`
    SELECT COUNT(*) AS count FROM consultation_sessions WHERE status = 'active'
  `).get().count;

  const waitingConsultations = db.prepare(`
    SELECT COUNT(*) AS count FROM consultation_sessions WHERE status = 'waiting'
  `).get().count;

  const bookingsByType = db.prepare(`
    SELECT consultation_type AS type, COUNT(*) AS count
    FROM appointments
    GROUP BY consultation_type
  `).all();

  res.json({
    lawyers: lawyerStats,
    users: userCount,
    appointments: appointmentCount,
    paymentTotal,
    activeConsultations,
    waitingConsultations,
    bookingsByType,
  });
});

const getSettings = asyncHandler(async (_req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM platform_settings').all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  res.json({
    settings,
    meta: platformSettings.getSettingsMeta(),
    updatedAt: Object.fromEntries(rows.map((row) => [row.key, row.updated_at])),
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  const allowedKeys = new Set([
    'support_phone',
    'commission_percent',
    'min_wallet_topup',
    'min_wallet_withdrawal',
    'challan_test_otp',
  ]);

  const entries = Object.entries(req.body || {}).filter(([key]) => allowedKeys.has(key));
  const upsert = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  for (const [key, value] of entries) {
    upsert.run(key, String(value));
  }

  const rows = db.prepare('SELECT key, value, updated_at FROM platform_settings').all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  res.json({
    settings,
    meta: platformSettings.getSettingsMeta(),
    updatedAt: Object.fromEntries(rows.map((row) => [row.key, row.updated_at])),
  });
});

module.exports = {
  listUsers,
  getUser,
  listAppointments,
  getAppointment,
  listPayments,
  listConsultations,
  getConsultation,
  endConsultation,
  getIntegrations,
  getExtendedStats,
  getSettings,
  updateSettings,
};
