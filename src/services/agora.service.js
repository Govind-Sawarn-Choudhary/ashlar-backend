const config = require('../config');
const { RtcTokenBuilder, RtcRole, ChatTokenBuilder } = require('agora-token');

const TOKEN_TTL_SECONDS = 60 * 60;

function isEnabled() {
  return Boolean(config.agoraAppId && config.agoraAppCertificate);
}

function buildChannelName(appointmentId) {
  return `ashlar_appt_${appointmentId}`;
}

function buildChatUserId(userId, role) {
  return `ashlar_${role}_${userId}`;
}

function buildRtcToken(channelName, uid) {
  if (!isEnabled()) {
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
  if (!isEnabled()) {
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
      error: 'Agora is not configured on the server',
    };
  }

  const channelName = buildChannelName(appointmentId);
  const chatUserId = buildChatUserId(actorUserId, actorRole);
  const peerChatUserId = buildChatUserId(peerUserId, peerRole);
  const rtcUid = Number(actorUserId);
  /** Ashlar uses in-app REST chat by default; Agora Chat only when key is set. */
  const chatEnabled = Boolean(config.agoraChatAppKey);

  return {
    enabled: true,
    appId: config.agoraAppId,
    chatEnabled,
    chatAppKey: chatEnabled ? config.agoraChatAppKey : null,
    channelName,
    uid: rtcUid,
    rtcToken: buildRtcToken(channelName, rtcUid),
    chatToken: chatEnabled ? buildChatToken(chatUserId) : null,
    chatUserId: chatEnabled ? chatUserId : null,
    peerChatUserId: chatEnabled ? peerChatUserId : null,
  };
}

module.exports = {
  isEnabled,
  buildChannelName,
  buildChatUserId,
  buildJoinCredentials,
};
