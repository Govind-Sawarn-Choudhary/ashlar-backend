require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  tempOtpPhone: process.env.TEMP_OTP_PHONE || '8521429014',
  tempOtpCode: process.env.TEMP_OTP_CODE || '123456',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@ashlarlaw.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  uploadsDir: 'uploads',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  razorpayEnabled: Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  ),
  agoraAppId: process.env.AGORA_APP_ID || '',
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE || '',
  agoraChatAppKey: process.env.AGORA_CHAT_APP_KEY || '',
};

module.exports = config;
