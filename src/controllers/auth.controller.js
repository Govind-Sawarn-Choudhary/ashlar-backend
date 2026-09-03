const asyncHandler = require('../utils/asyncHandler');
const { sendOtp, verifyOtp } = require('../services/otp.service');
const { signUserToken } = require('../services/token.service');
const {
  getUserByPhoneAndRole,
  createUser,
  buildLawyerAuthPayload,
} = require('../services/lawyer.service');
const { buildUserAuthPayload } = require('../services/user.service');

const sendOtpHandler = asyncHandler(async (req, res) => {
  const { phone, role } = req.body;

  if (!phone || !role) {
    return res.status(400).json({ error: 'phone and role are required' });
  }

  if (!['lawyer', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be lawyer or user' });
  }

  const result = sendOtp(phone);
  res.json(result);
});

const verifyOtpHandler = asyncHandler(async (req, res) => {
  const { phone, otp, role } = req.body;

  if (!phone || !otp || !role) {
    return res.status(400).json({ error: 'phone, otp, and role are required' });
  }

  if (!['lawyer', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be lawyer or user' });
  }

  verifyOtp(phone, otp);

  let user = getUserByPhoneAndRole(phone, role);
  const isNewUser = !user;

  if (!user) {
    user = createUser(phone, role);
  }

  const token = signUserToken(user);

  if (role === 'lawyer') {
    const payload = buildLawyerAuthPayload(user);
    return res.json({
      token,
      isNewUser,
      ...payload,
    });
  }

  const payload = buildUserAuthPayload(user);

  res.json({
    token,
    isNewUser,
    ...payload,
  });
});

module.exports = {
  sendOtpHandler,
  verifyOtpHandler,
};
