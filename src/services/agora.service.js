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

  return {
    enabled: true,
    appId: config.agoraAppId,
    chatAppKey: config.agoraChatAppKey || config.agoraAppId,
    channelName,
    uid: rtcUid,
    rtcToken: buildRtcToken(channelName, rtcUid),
    chatToken: buildChatToken(chatUserId),
    chatUserId,
    peerChatUserId,
  };
}

module.exports = {
  isEnabled,
  buildChannelName,
  buildChatUserId,
  buildJoinCredentials,
};
