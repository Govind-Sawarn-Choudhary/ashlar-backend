const config = require('../config');
const db = require('../db');

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function buildIceServers() {
  const servers = [...DEFAULT_STUN];

  if (config.webrtcTurnUrl) {
    servers.push({
      urls: config.webrtcTurnUrl,
      username: config.webrtcTurnUsername || undefined,
      credential: config.webrtcTurnCredential || undefined,
    });
  }

  return servers;
}

function buildJoinConfig(sessionId, actorRole) {
  return {
    enabled: true,
    sessionId,
    iceServers: buildIceServers(),
    isInitiator: actorRole === 'user',
  };
}

function mapSignal(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    signalType: row.signal_type,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

function postSignal(sessionId, senderId, signalType, payload) {
  const allowed = ['offer', 'answer', 'ice'];
  if (!allowed.includes(signalType)) {
    const error = new Error('Invalid WebRTC signal type');
    error.status = 400;
    throw error;
  }

  if (!payload || typeof payload !== 'string') {
    const error = new Error('Signal payload is required');
    error.status = 400;
    throw error;
  }

  const result = db.prepare(`
    INSERT INTO webrtc_signals (session_id, sender_id, signal_type, payload)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, senderId, signalType, payload.slice(0, 16000));

  return mapSignal(
    db.prepare('SELECT * FROM webrtc_signals WHERE id = ?').get(result.lastInsertRowid),
  );
}

function listSignals(sessionId, actorUserId, afterId = 0) {
  return db.prepare(`
    SELECT * FROM webrtc_signals
    WHERE session_id = ?
      AND sender_id != ?
      AND id > ?
    ORDER BY id ASC
    LIMIT 200
  `).all(sessionId, actorUserId, afterId).map(mapSignal);
}

function clearSignals(sessionId) {
  db.prepare('DELETE FROM webrtc_signals WHERE session_id = ?').run(sessionId);
}

module.exports = {
  buildJoinConfig,
  postSignal,
  listSignals,
  clearSignals,
};
