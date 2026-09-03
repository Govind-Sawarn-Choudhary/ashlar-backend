const db = require('../db');

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function getCommissionPercent() {
  const parsed = Number.parseFloat(getSetting('commission_percent', '0'));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 100);
}

function getMinWalletTopup() {
  const parsed = Number.parseFloat(getSetting('min_wallet_topup', '0'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function getMinWithdrawal() {
  const parsed = Number.parseFloat(getSetting('min_wallet_withdrawal', '100'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }
  return parsed;
}

function applyLawyerPayout(grossAmount) {
  const commissionPercent = getCommissionPercent();
  const commissionAmount = (grossAmount * commissionPercent) / 100;
  const netAmount = grossAmount - commissionAmount;
  return {
    grossAmount,
    commissionPercent,
    commissionAmount,
    netAmount: Math.max(netAmount, 0),
  };
}

function getSettingsMeta() {
  return {
    support_phone: { enforced: true, description: 'Shown in user profile support section' },
    commission_percent: {
      enforced: true,
      description: 'Deducted from lawyer wallet credits on bookings',
    },
    min_wallet_topup: {
      enforced: true,
      description: 'Minimum Razorpay wallet top-up amount',
    },
    min_wallet_withdrawal: {
      enforced: true,
      description: 'Minimum lawyer wallet withdrawal amount',
    },
    challan_test_otp: {
      enforced: true,
      description: 'Test OTP for challan verification flow',
    },
  };
}

module.exports = {
  getSetting,
  getCommissionPercent,
  getMinWalletTopup,
  getMinWithdrawal,
  applyLawyerPayout,
  getSettingsMeta,
};
