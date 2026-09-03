const bcrypt = require('bcryptjs');
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { signAdminToken } = require('../services/token.service');
const {
  listLawyersForAdmin,
  getLawyerDetailForAdmin,
  updateLawyerVerification,
  adminVerifyBarFromPortal,
  adminApproveBarCouncil,
} = require('../services/lawyer.service');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const admin = db
    .prepare('SELECT id, email, password_hash FROM admins WHERE email = ?')
    .get(email.trim().toLowerCase());

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signAdminToken(admin);

  res.json({
    token,
    admin: {
      id: admin.id,
      email: admin.email,
    },
  });
});

const getLawyers = asyncHandler(async (req, res) => {
  const { status, search, barUnverified } = req.query;
  const lawyers = listLawyersForAdmin({
    status,
    search,
    barUnverified: barUnverified === '1' || barUnverified === 'true',
  });
  res.json({ lawyers });
});

const getLawyer = asyncHandler(async (req, res) => {
  const lawyer = getLawyerDetailForAdmin(Number(req.params.id));

  if (!lawyer) {
    return res.status(404).json({ error: 'Lawyer not found' });
  }

  res.json({ lawyer });
});

const patchVerification = asyncHandler(async (req, res) => {
  const { status, rejectionReason } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const lawyer = updateLawyerVerification(
    Number(req.params.id),
    status,
    rejectionReason,
  );

  if (!lawyer) {
    return res.status(404).json({ error: 'Lawyer not found' });
  }

  res.json({ lawyer });
});

const patchBarVerification = asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  const { action, enrollmentNumber, fullName, advocateName, state } = req.body;

  if (action === 'portal_check') {
    if (!enrollmentNumber?.trim()) {
      return res.status(400).json({ error: 'enrollmentNumber is required' });
    }

    const lawyer = getLawyerDetailForAdmin(userId);
    if (!lawyer) {
      return res.status(404).json({ error: 'Lawyer not found' });
    }

    const name = fullName?.trim() || lawyer.full_name || '';
    const data = await adminVerifyBarFromPortal(userId, enrollmentNumber.trim(), name);
    return res.json(data);
  }

  if (action === 'manual_approve') {
    const lawyer = adminApproveBarCouncil(userId, {
      enrollmentNumber: enrollmentNumber?.trim(),
      advocateName: advocateName?.trim(),
      state: state?.trim() || 'UP',
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Lawyer not found' });
    }

    return res.json({ lawyer });
  }

  return res.status(400).json({ error: 'Invalid action' });
});

const getStats = asyncHandler(async (req, res) => {
  const rows = db
    .prepare(`
      SELECT verification_status AS status, COUNT(*) AS count
      FROM lawyer_profiles
      WHERE onboarding_step = 'complete'
      GROUP BY verification_status
    `)
    .all();

  const stats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  };

  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }

  stats.barUnverified = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM lawyer_profiles
      WHERE onboarding_step = 'complete'
        AND (bar_enrollment_verified = 0 OR bar_enrollment_verified IS NULL)
    `)
    .get().count;

  res.json({ stats });
});

module.exports = {
  login,
  getLawyers,
  getLawyer,
  patchVerification,
  patchBarVerification,
  getStats,
};
