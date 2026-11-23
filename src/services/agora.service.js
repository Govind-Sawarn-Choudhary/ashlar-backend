const config = require('../config');
const { RtcTokenBuilder, RtcRole, ChatTokenBuilder } = require('agora-token');

const TOKEN_TTL_SECONDS = 60 * 60;

function isEnabled() {
  return Boolean(config.agoraAppId);
}

/** Real Primary Certificate from Agora Console — must not be the same string as App ID. */
function hasRtcCertificate() {
  const appId = config.agoraAppId;
  const certificate = config.agoraAppCertificate;
  if (!appId || !certificate) {
    return false;
  }
  if (certificate.trim() === appId.trim()) {
    return false;
  }
  return true;
}

function buildChannelName(appointmentId) {
  return `ashlar_appt_${appointmentId}`;
}

function buildChatUserId(userId, role) {
  return `ashlar_${role}_${userId}`;
}

function buildRtcToken(channelName, uid) {
  if (!hasRtcCertificate()) {
    return null;
  }

  return RtcTokenBuilder.buildTokenWithUid(
    config.agoraAppId,
    config.agoraAppCertificate,
    channelName,
    Number(uid),
    RtcRole.PUBLISHER,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
  );
}

function buildChatToken(chatUserId) {
  if (!hasRtcCertificate()) {
    return null;
  }

  return ChatTokenBuilder.buildUserToken(
    config.agoraAppId,
    config.agoraAppCertificate,
    chatUserId,
    TOKEN_TTL_SECONDS,
  );
}

function buildJoinCredentials({
  appointmentId,
  actorUserId,
  actorRole,
  peerUserId,
  peerRole,
}) {
  if (!isEnabled()) {
    return {
      enabled: false,
      error: 'Call service is temporarily unavailable. Please try again later.',
    };
  }

  const channelName = buildChannelName(appointmentId);
  const chatUserId = buildChatUserId(actorUserId, actorRole);
  const peerChatUserId = buildChatUserId(peerUserId, peerRole);
  const rtcUid = Number(actorUserId);
  const rtcTokenRequired = hasRtcCertificate();
  /** Ashlar uses in-app REST chat by default; Agora Chat only when key is set. */
  const chatEnabled = Boolean(config.agoraChatAppKey);

  return {
    enabled: true,
    appId: config.agoraAppId,
    rtcTokenRequired,
    chatEnabled,
    chatAppKey: chatEnabled ? config.agoraChatAppKey : null,
    channelName,
    uid: rtcUid,
    rtcToken: rtcTokenRequired ? buildRtcToken(channelName, rtcUid) : null,
    chatToken: chatEnabled ? buildChatToken(chatUserId) : null,
    chatUserId: chatEnabled ? chatUserId : null,
    peerChatUserId: chatEnabled ? peerChatUserId : null,
  };
}

module.exports = {
  isEnabled,
  hasRtcCertificate,
  buildChannelName,
  buildChatUserId,
  buildJoinCredentials,
};
