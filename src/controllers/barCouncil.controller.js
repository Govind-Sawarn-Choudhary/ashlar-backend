const asyncHandler = require('../utils/asyncHandler');
const { verifyUpEnrollment } = require('../services/barCouncil/upBarCouncil.service');

const verifyEnrollment = asyncHandler(async (req, res) => {
  const { state, enrollmentNumber, fullName } = req.body;

  if (!state?.trim()) {
    return res.status(400).json({ error: 'state is required' });
  }

  if (!enrollmentNumber?.trim()) {
    return res.status(400).json({ error: 'enrollmentNumber is required' });
  }

  const normalizedState = state.trim().toUpperCase();

  if (normalizedState !== 'UP') {
    return res.status(400).json({
      error: 'Only UP Bar Council auto verification is enabled right now',
    });
  }

  const result = await verifyUpEnrollment(
    enrollmentNumber.trim(),
    fullName?.trim() || null,
  );

  const { saveBarVerification, buildLawyerAuthPayload } = require('../services/lawyer.service');
  saveBarVerification(req.auth.sub, result);

  const user = {
    id: req.auth.sub,
    phone: req.auth.phone,
    role: req.auth.role,
  };

  return res.json({
    ...result,
    profile: buildLawyerAuthPayload(user),
  });
});

module.exports = {
  verifyEnrollment,
};
