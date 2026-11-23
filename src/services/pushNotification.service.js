const admin = require('firebase-admin');
const config = require('../config');
const deviceTokenService = require('./deviceToken.service');

let firebaseReady = false;

function tryInitFirebase() {
  if (firebaseReady) {
    return true;
  }

  if (!config.firebaseServiceAccountJson) {
    return false;
  }

  try {
    const credentials = JSON.parse(config.firebaseServiceAccountJson);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
      });
    }
    firebaseReady = true;
    return true;
  } catch (error) {
    console.error('[FCM] Firebase init failed:', error.message);
    return false;
  }
}

function isPushEnabled() {
  return tryInitFirebase();
}

async function sendPushToUser(userId, role, { title, body, data = {} }) {
  if (!tryInitFirebase()) {
    return { sent: 0, skipped: 'firebase_not_configured' };
  }

  const tokens = deviceTokenService.listTokens(userId, role);
  if (tokens.length === 0) {
    return { sent: 0, skipped: 'no_device_tokens' };
  }

  const payload = {
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value ?? '')]),
    ),
    android: {
      priority: 'high',
      notification: {
        channelId: 'ashlar_alerts',
        sound: 'default',
      },
    },
    apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    tokens: tokens.map((row) => row.token),
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(payload);
    const stale = [];
    response.responses.forEach((item, index) => {
      if (
        !item.success &&
        item.error &&
        ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(
          item.error.code,
        )
      ) {
        stale.push(tokens[index].token);
      }
    });
    deviceTokenService.removeTokens(stale);
    return { sent: response.successCount, failed: response.failureCount };
  } catch (error) {
    console.error('[FCM] send failed:', error.message);
    return { sent: 0, error: error.message };
  }
}

module.exports = {
  isPushEnabled,
  sendPushToUser,
};