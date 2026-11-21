const config = require('../config');

function isStagingOtp() {
  return config.otpMode === 'staging';
}

/**
 * OTP provider — set OTP_MODE=staging on cloud until DLT/SMS is live.
 */
function sendOtp(phone) {
  const normalized = String(phone).trim();

  if (normalized.length !== 10 || !/^\d+$/.test(normalized)) {
    const error = new Error('Phone number must be exactly 10 digits');
    error.status = 400;
    throw error;
  }

  if (!isStagingOtp() && normalized !== config.tempOtpPhone) {
    const error = new Error(
      'OTP is temporarily enabled only for the test number. Set OTP_MODE=staging on server or use DLT SMS.',
    );
    error.status = 403;
    throw error;
  }

  console.log(`[OTP] ${normalized} → ${config.tempOtpCode}`);

  return {
    phone: normalized,
    expiresInSeconds: 300,
    message: 'OTP sent successfully',
  };
}

function verifyOtp(phone, otp) {
  const normalizedPhone = String(phone).trim();
  const normalizedOtp = String(otp).trim();

  if (isStagingOtp()) {
    if (normalizedOtp !== config.tempOtpCode) {
      const error = new Error('Invalid OTP');
      error.status = 401;
      throw error;
    }
    return true;
  }

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