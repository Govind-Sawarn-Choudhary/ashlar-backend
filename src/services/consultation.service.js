const db = require('../db');
const appointmentService = require('./appointment.service');
const consultationBilling = require('./consultationBilling.service');
const notificationService = require('./notification.service');
const agoraService = require('./agora.service');
const webrtcService = require('./webrtc.service');

function mapSession(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    appointmentId: row.appointment_id,
    status: row.status,
    userJoinedAt: row.user_joined_at,
    lawyerJoinedAt: row.lawyer_joined_at,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    endedAt: row.ended_at,
    channelName: row.channel_name,
    billedMinutes: row.billed_minutes || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    body: row.body,
    createdAt: row.created_at,
  };
}

function getAppointmentForActor(appointmentId, actorUserId, actorRole) {
  const appointment = appointmentService.getAppointmentById(appointmentId);
  if (!appointment) {
    const error = new Error('Appointment not found');
    error.status = 404;
    throw error;
  }

  if (actorRole === 'user' && appointment.userId !== actorUserId) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  if (actorRole === 'lawyer' && appointment.lawyerId !== actorUserId) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  if (!['confirmed', 'completed'].includes(appointment.status)) {
    const error = new Error('Consultation is not available for this appointment');
    error.status = 400;
    throw error;
  }

  if (appointment.consultationType === 'physical') {
    const error = new Error('In-person appointments do not have an online session');
    error.status = 400;
    throw error;
  }

  return appointment;
}

function getSessionRowByAppointment(appointmentId) {
  return db
    .prepare('SELECT * FROM consultation_sessions WHERE appointment_id = ?')
    .get(appointmentId);
}

function getSessionRowById(sessionId) {
  return db.prepare('SELECT * FROM consultation_sessions WHERE id = ?').get(sessionId);
}

function assertSessionAccess(sessionId, actorUserId, actorRole) {
  const session = getSessionRowById(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  getAppointmentForActor(session.appointment_id, actorUserId, actorRole);
  return session;
}

function maybeActivateSession(sessionId) {
  const session = getSessionRowById(sessionId);
  if (!session || session.status === 'ended') {
    return getSessionRowById(sessionId);
  }

  if (session.user_joined_at && session.lawyer_joined_at && session.status !== 'active') {
    const appointment = appointmentService.getAppointmentById(session.appointment_id);
    const durationMinutes = appointment.durationMinutes || 30;
    db.prepare(`
      UPDATE consultation_sessions
      SET status = 'active',
          started_at = datetime('now'),
          ends_at = datetime('now', '+' || ? || ' minutes'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(durationMinutes, sessionId);
  }

  return getSessionRowById(sessionId);
}

function maybeExpireSession(sessionId) {
  const session = getSessionRowById(sessionId);
  if (!session || session.status === 'ended') {
    return session;
  }

  if (session.ends_at) {
    const expired = db
      .prepare("SELECT datetime('now') > datetime(?) AS expired")
      .get(session.ends_at);
    if (expired?.expired) {
      return endSession(sessionId, null, 'system');
    }
  }

  return session;
}

function endSession(sessionId, actorUserId, actorRole = 'user') {
  const session = getSessionRowById(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  if (session.status === 'ended') {
    return mapSession(session);
  }

  if (actorUserId != null) {
    getAppointmentForActor(session.appointment_id, actorUserId, actorRole);
  }

  db.prepare(`
    UPDATE consultation_sessions
    SET status = 'ended',
        ended_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(sessionId);

  webrtcService.clearSignals(sessionId);

  const appointment = appointmentService.getAppointmentById(session.appointment_id);
  if (appointment && appointment.status === 'confirmed') {
    appointmentService.updateAppointmentStatus(
      appointment.id,
      'completed',
      actorUserId ?? appointment.userId,
      actorRole === 'system' ? 'user' : actorRole,
    );
  }

  return mapSession(getSessionRowById(sessionId));
}

function getOrCreateSession(appointmentId, actorUserId, actorRole) {
  const appointment = getAppointmentForActor(appointmentId, actorUserId, actorRole);

  let session = getSessionRowByAppointment(appointmentId);
  if (!session) {
    const channelName = agoraService.buildChannelName(appointmentId);
    const result = db.prepare(`
      INSERT INTO consultation_sessions (appointment_id, status, channel_name)
      VALUES (?, 'waiting', ?)
    `).run(appointmentId, channelName);
    session = getSessionRowById(result.lastInsertRowid);
  } else if (!session.channel_name) {
    const channelName = agoraService.buildChannelName(appointmentId);
    db.prepare(`
      UPDATE consultation_sessions
      SET channel_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(channelName, session.id);
    session = getSessionRowById(session.id);
  }

  maybeExpireSession(session.id);
  session = getSessionRowById(session.id);

  return {
    appointment,
    session: mapSession(session),
  };
}

function joinSession(appointmentId, actorUserId, actorRole) {
  const { appointment, session } = getOrCreateSession(
    appointmentId,
    actorUserId,
    actorRole,
  );

  if (session.status === 'ended') {
    const error = new Error('Consultation session has ended');
    error.status = 400;
    throw error;
  }

  const joinColumn = actorRole === 'lawyer' ? 'lawyer_joined_at' : 'user_joined_at';
  const current = getSessionRowById(session.id);
  const isFirstJoin = !current[joinColumn];
  if (isFirstJoin) {
    db.prepare(`
      UPDATE consultation_sessions
      SET ${joinColumn} = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(session.id);
  }

  if (isFirstJoin) {
    const peerUserId = actorRole === 'lawyer' ? appointment.userId : appointment.lawyerId;
    const peerRole = actorRole === 'lawyer' ? 'user' : 'lawyer';
    const consultLabel =
      appointment.consultationType === 'video'
        ? 'Video call'
        : appointment.consultationType === 'audio'
          ? 'Audio call'
          : 'Chat consultation';
    notificationService.createNotification(peerUserId, peerRole, {
      title: actorRole === 'user' ? `${consultLabel} request` : 'Lawyer joined',
      body:
        actorRole === 'user'
          ? 'A client is waiting to connect. Open the app to join now.'
          : 'Your lawyer joined the session. Tap to connect before time runs out.',
      category: 'consultation',
      actionType: 'consultation',
      actionId: appointmentId,
    });
  }

  maybeActivateSession(session.id);
  maybeExpireSession(session.id);

  const updated = getSessionRowById(session.id);
  const freshAppointment = appointmentService.getAppointmentById(appointmentId);
  const peerUserId = actorRole === 'lawyer' ? appointment.userId : appointment.lawyerId;
  const peerRole = actorRole === 'lawyer' ? 'user' : 'lawyer';

  const needsRtc = ['audio', 'video'].includes(freshAppointment.consultationType);
  if (needsRtc && !agoraService.isEnabled()) {
    const error = new Error(
      'Audio/video calls require Agora on the server. Please contact support.',
    );
    error.status = 503;
    throw error;
  }

  return {
    appointment: freshAppointment,
    session: mapSession(updated),
    billing: consultationBilling.buildBillingSnapshot(
      freshAppointment,
      updated,
      actorRole,
    ),
    peerJoined: actorRole === 'lawyer'
      ? Boolean(updated.user_joined_at)
      : Boolean(updated.lawyer_joined_at),
    mediaProvider: 'agora',
    agora: agoraService.buildJoinCredentials({
      appointmentId,
      actorUserId,
      actorRole,
      peerUserId,
      peerRole,
    }),
    webrtc: { enabled: false },
    actor: {
      id: actorUserId,
      role: actorRole,
    },
  };
}

function listMessages(sessionId, actorUserId, actorRole, afterId = 0) {
  assertSessionAccess(sessionId, actorUserId, actorRole);
  maybeExpireSession(sessionId);

  const rows = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ? AND id > ?
    ORDER BY id ASC
    LIMIT 200
  `).all(sessionId, afterId);

  return rows.map(mapMessage);
}

function sendMessage(sessionId, actorUserId, actorRole, body) {
  const session = assertSessionAccess(sessionId, actorUserId, actorRole);
  maybeExpireSession(sessionId);

  const refreshed = getSessionRowById(sessionId);
  if (refreshed.status === 'ended') {
    const error = new Error('Consultation session has ended');
    error.status = 400;
    throw error;
  }

  const trimmed = String(body || '').trim();
  if (!trimmed) {
    const error = new Error('Message body is required');
    error.status = 400;
    throw error;
  }

  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, sender_id, sender_role, body)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, actorUserId, actorRole, trimmed.slice(0, 4000));

  if (!refreshed.user_joined_at || !refreshed.lawyer_joined_at) {
    const joinColumn = actorRole === 'lawyer' ? 'lawyer_joined_at' : 'user_joined_at';
    if (!refreshed[joinColumn]) {
      db.prepare(`
        UPDATE consultation_sessions
        SET ${joinColumn} = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(sessionId);
    }
    maybeActivateSession(sessionId);
  }

  return mapMessage(
    db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid),
  );
}

function listOnlineAppointments(actorUserId, actorRole, { status, consultationType } = {}) {
  const appointments = actorRole === 'lawyer'
    ? appointmentService.listLawyerAppointments(actorUserId, status)
    : appointmentService.listUserAppointments(actorUserId, status);

  return appointments.filter((item) => {
    if (item.consultationType === 'physical') {
      return false;
    }
    if (consultationType && item.consultationType !== consultationType) {
      return false;
    }
    return true;
  });
}

function mapSessionAdmin(row) {
  const billingModel = row.billing_model || 'prepaid';
  const ratePerMinute =
    row.rate_per_minute != null ? Number(row.rate_per_minute) : null;
  const billedMinutes = row.billed_minutes != null ? Number(row.billed_minutes) : 0;

  return {
    id: row.id,
    appointmentId: row.appointment_id,
    status: row.status,
    channelName: row.channel_name,
    userJoinedAt: row.user_joined_at,
    lawyerJoinedAt: row.lawyer_joined_at,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    consultationType: row.consultation_type,
    mode: row.mode,
    amount: row.amount,
    durationMinutes: row.duration_minutes,
    billingModel,
    ratePerMinute,
    billedMinutes,
    meteredCharged:
      billingModel === 'per_minute' && ratePerMinute
        ? billedMinutes * ratePerMinute
        : null,
    appointmentStatus: row.appointment_status,
    userName: row.user_name,
    userPhone: row.user_phone,
    lawyerName: row.lawyer_name,
    lawyerPhone: row.lawyer_phone,
  };
}

function listSessionsForAdmin({ status, limit = 50, offset = 0 } = {}) {
  let query = `
    SELECT cs.*,
      a.consultation_type, a.mode, a.amount, a.duration_minutes, a.status AS appointment_status,
      a.billing_model, a.rate_per_minute,
      up.full_name AS user_name, u.phone AS user_phone,
      lp.full_name AS lawyer_name, lu.phone AS lawyer_phone
    FROM consultation_sessions cs
    JOIN appointments a ON a.id = cs.appointment_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
  `;
  const params = [];

  if (status) {
    query += ' WHERE cs.status = ?';
    params.push(status);
  }

  query += ' ORDER BY datetime(cs.created_at) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params).map(mapSessionAdmin);
}

function getSessionDetailForAdmin(sessionId) {
  const row = db.prepare(`
    SELECT cs.*,
      a.consultation_type, a.mode, a.amount, a.duration_minutes, a.status AS appointment_status,
      a.billing_model, a.rate_per_minute,
      a.payment_id, a.notes, a.scheduled_at,
      up.full_name AS user_name, u.phone AS user_phone,
      lp.full_name AS lawyer_name, lu.phone AS lawyer_phone
    FROM consultation_sessions cs
    JOIN appointments a ON a.id = cs.appointment_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
    WHERE cs.id = ?
  `).get(sessionId);

  if (!row) {
    return null;
  }

  const messages = db.prepare(`
    SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 500
  `).all(sessionId).map(mapMessage);

  return {
    session: mapSessionAdmin(row),
    messages,
  };
}

function getSessionByAppointmentForAdmin(appointmentId) {
  const session = getSessionRowByAppointment(appointmentId);
  if (!session) {
    return null;
  }
  return getSessionDetailForAdmin(session.id);
}

function adminForceEndSession(sessionId) {
  return endSession(sessionId, null, 'system');
}

function postWebRtcSignal(sessionId, actorUserId, actorRole, signalType, payload) {
  assertSessionAccess(sessionId, actorUserId, actorRole);
  maybeExpireSession(sessionId);

  const refreshed = getSessionRowById(sessionId);
  if (refreshed.status === 'ended') {
    const error = new Error('Consultation session has ended');
    error.status = 400;
    throw error;
  }

  return webrtcService.postSignal(sessionId, actorUserId, signalType, payload);
}

function listWebRtcSignals(sessionId, actorUserId, actorRole, afterId = 0) {
  assertSessionAccess(sessionId, actorUserId, actorRole);
  maybeExpireSession(sessionId);
  return webrtcService.listSignals(sessionId, actorUserId, afterId);
}

function billConsultationMinute(sessionId, actorUserId, actorRole) {
  return consultationBilling.billConsultationMinute(
    sessionId,
    actorUserId,
    actorRole,
    endSession,
  );
}

function listIncomingForLawyer(lawyerId) {
  return db
    .prepare(`
      SELECT
        a.id AS appointment_id,
        a.consultation_type,
        COALESCE(up.full_name, u.phone) AS client_name,
        u.phone AS client_phone,
        cs.user_joined_at
      FROM consultation_sessions cs
      INNER JOIN appointments a ON a.id = cs.appointment_id
      INNER JOIN users u ON u.id = a.user_id
      LEFT JOIN user_profiles up ON up.user_id = a.user_id
      WHERE a.lawyer_id = ?
        AND a.consultation_type != 'physical'
        AND a.status = 'confirmed'
        AND cs.status != 'ended'
        AND cs.user_joined_at IS NOT NULL
        AND cs.lawyer_joined_at IS NULL
      ORDER BY datetime(cs.user_joined_at) DESC
    `)
    .all(lawyerId)
    .map((row) => ({
      appointmentId: row.appointment_id,
      consultationType: row.consultation_type,
      clientName: row.client_name,
      clientPhone: row.client_phone,
      userJoinedAt: row.user_joined_at,
    }));
}

module.exports = {
  getOrCreateSession,
  joinSession,
  billConsultationMinute,
  listMessages,
  sendMessage,
  endSession,
  listOnlineAppointments,
  listSessionsForAdmin,
  getSessionDetailForAdmin,
  getSessionByAppointmentForAdmin,
  adminForceEndSession,
  postWebRtcSignal,
  listWebRtcSignals,
  listIncomingForLawyer,
};
