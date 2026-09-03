const asyncHandler = require('../utils/asyncHandler');
const { buildUserAuthPayload, saveUserProfile } = require('../services/user.service');

const getMe = asyncHandler(async (req, res) => {
  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildUserAuthPayload(user));
});

const saveProfile = asyncHandler(async (req, res) => {
  const { fullName, location, email, language } = req.body;

  if (!fullName?.trim()) {
    return res.status(400).json({ error: 'fullName is required' });
  }

  saveUserProfile(req.auth.sub, {
    fullName,
    location,
    email,
    language,
  });

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  res.json(buildUserAuthPayload(user));
});

module.exports = {
  getMe,
  saveProfile,
};
