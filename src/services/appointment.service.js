const db = require('../db');
const { createPayment } = require('./payment.service');
const { debitWallet, creditWallet } = require('./wallet.service');
const { getApprovedLawyerById, resolveBookingAmount } = require('./marketplace.service');
const notificationService = require('./notification.service');

function mapAppointment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    lawyerId: row.lawyer_id,
    mode: row.mode,
    consultationType: row.consultation_type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    amount: row.amount,
    paymentId: row.payment_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userName: row.user_name,
    userPhone: row.user_phone,
    lawyerName: row.lawyer_name,
    lawyerPhone: row.lawyer_phone,
  };
}

function createBooking(userId, payload) {
  const { lawyerId, mode, consultationType, scheduledAt, notes, payFromWallet } = payload;

  const lawyer = getApprovedLawyerById(lawyerId, userId);
  if (!lawyer) {
    const error = new Error('Lawyer not available for booking');
    error.status = 404;
    throw error;
  }

  const amount = resolveBookingAmount(lawyerId, consultationType);
  if (amount <= 0) {
    const error = new Error('Invalid booking amount');
    error.status = 400;
    throw error;
  }

  let payment;

  if (payFromWallet) {
    debitWallet(userId, 'user', {
      amount,
      description: `Booking with ${lawyer.fullName}`,
      referenceType: 'booking',
    });
    payment = createPayment(userId, {
      amount,
      paymentType: 'booking',
      metadata: { lawyerId, mode, consultationType, source: 'wallet' },
    });
  } else {
    const error = new Error('Gateway payments must use Razorpay order flow');
    error.status = 400;
    throw error;
  }

  const result = db.prepare(`
    INSERT INTO appointments (
      user_id, lawyer_id, mode, consultation_type, status,
      scheduled_at, amount, payment_id, notes
    ) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
  `).run(
    userId,
    lawyerId,
    mode,
    consultationType,
    scheduledAt || null,
    amount,
    payment.id,
    notes || null,
  );

  creditWallet(lawyerId, 'lawyer', {
    amount,
    description: `Consultation booking (${consultationType})`,
    referenceType: 'booking',
    referenceId: result.lastInsertRowid,
  });

  notificationService.createNotification(userId, 'user', {
    title: 'Appointment confirmed',
    body: `Your ${consultationType} appointment with ${lawyer.fullName} is confirmed.`,
  });

  notificationService.createNotification(lawyerId, 'lawyer', {
    title: 'New appointment',
    body: `You have a new ${consultationType} consultation booking.`,
  });

  return getAppointmentById(result.lastInsertRowid);
}

function getAppointmentById(id) {
  const row = db.prepare(`
    SELECT a.*,
      up.full_name AS user_name,
      u.phone AS user_phone,
      lp.full_name AS lawyer_name,
      lu.phone AS lawyer_phone
    FROM appointments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
    WHERE a.id = ?
  `).get(id);

  return row ? mapAppointment(row) : null;
}

function listUserAppointments(userId, status) {
  let query = `
    SELECT a.*,
      up.full_name AS user_name,
      u.phone AS user_phone,
      lp.full_name AS lawyer_name,
      lu.phone AS lawyer_phone
    FROM appointments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
    WHERE a.user_id = ?
  `;
  const params = [userId];

  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY datetime(a.created_at) DESC';

  return db.prepare(query).all(...params).map(mapAppointment);
}

function listLawyerAppointments(lawyerId, status) {
  let query = `
    SELECT a.*,
      up.full_name AS user_name,
      u.phone AS user_phone,
      lp.full_name AS lawyer_name,
      lu.phone AS lawyer_phone
    FROM appointments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
    WHERE a.lawyer_id = ?
  `;
  const params = [lawyerId];

  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY datetime(a.created_at) DESC';

  return db.prepare(query).all(...params).map(mapAppointment);
}

function updateAppointmentStatus(appointmentId, status, actorUserId, actorRole) {
  const appointment = getAppointmentById(appointmentId);
  if (!appointment) {
    const error = new Error('Appointment not found');
    error.status = 404;
    throw error;
  }

  if (actorRole === 'lawyer' && appointment.lawyerId !== actorUserId) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  if (actorRole === 'user' && appointment.userId !== actorUserId) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  db.prepare(`
    UPDATE appointments
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, appointmentId);

  return getAppointmentById(appointmentId);
}

function listAllAppointmentsForAdmin({ status, limit = 50, offset = 0 } = {}) {
  let query = `
    SELECT a.*,
      up.full_name AS user_name,
      u.phone AS user_phone,
      lp.full_name AS lawyer_name,
      lu.phone AS lawyer_phone
    FROM appointments a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles up ON up.user_id = a.user_id
    JOIN users lu ON lu.id = a.lawyer_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = a.lawyer_id
  `;

  const params = [];
  if (status) {
    query += ' WHERE a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY datetime(a.created_at) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params).map(mapAppointment);
}

function getLawyerDashboardStats(lawyerId) {
  const earnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE w.user_id = ? AND w.role = 'lawyer' AND wt.type = 'credit'
      AND datetime(wt.created_at) >= datetime('now', 'start of month')
  `).get(lawyerId).total;

  const callsThisMonth = db.prepare(`
    SELECT COUNT(*) AS count FROM appointments
    WHERE lawyer_id = ? AND datetime(created_at) >= datetime('now', 'start of month')
  `).get(lawyerId).count;

  const overallCalls = db.prepare(`
    SELECT COUNT(*) AS count FROM appointments WHERE lawyer_id = ?
  `).get(lawyerId).count;

  const missedLeads = db.prepare(`
    SELECT COUNT(*) AS count FROM appointments
    WHERE lawyer_id = ? AND status = 'cancelled'
  `).get(lawyerId).count;

  return {
    earningsThisMonth: earnings,
    callsThisMonth,
    overallCalls,
    missedLeads,
  };
}

module.exports = {
  createBooking,
  getAppointmentById,
  listUserAppointments,
  listLawyerAppointments,
  updateAppointmentStatus,
  listAllAppointmentsForAdmin,
  getLawyerDashboardStats,
};
