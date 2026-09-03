const config = require('../config');

/**
 * Temporary OTP provider — swap with DLT/SMS when license is ready.
 */
function sendOtp(phone) {
  const normalized = String(phone).trim();

  if (normalized.length !== 10 || !/^\d+$/.test(normalized)) {
    const error = new Error('Phone number must be exactly 10 digits');
    error.status = 400;
    throw error;
  }

  // Until DLT: only the configured test number receives a valid OTP.
  if (normalized !== config.tempOtpPhone) {
    const error = new Error(
      'OTP is temporarily enabled only for the test number. Use DLT number when live.',
    );
    error.status = 403;
    throw error;
  }

  console.log(`[OTP] ${normalized} → ${config.tempOtpCode} (temporary test OTP)`);

  return {
    phone: normalized,
    expiresInSeconds: 300,
    message: 'OTP sent successfully',
  };
}

function verifyOtp(phone, otp) {
  const normalizedPhone = String(phone).trim();
  const normalizedOtp = String(otp).trim();

  if (normalizedPhone !== config.tempOtpPhone || normalizedOtp !== config.tempOtpCode) {
    const error = new Error('Invalid OTP');
    error.status = 401;
    throw error;
  }

  return true;
}

module.exports = {
  sendOtp,
  verifyOtp,
};
