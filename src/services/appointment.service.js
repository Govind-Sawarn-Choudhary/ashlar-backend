const db = require('../db');
const { createPayment } = require('./payment.service');
const { debitWallet, creditWallet, getWalletSummary } = require('./wallet.service');
const { getApprovedLawyerById, resolveBookingAmount, resolveBookingDuration } = require('./marketplace.service');
const platformSettings = require('./platformSettings.service');
const notificationService = require('./notification.service');

function mapAppointment(row) {
  const billingModel = row.billing_model || 'prepaid';
  const ratePerMinute =
    row.rate_per_minute != null ? Number(row.rate_per_minute) : null;

  return {
    id: row.id,
    userId: row.user_id,
    lawyerId: row.lawyer_id,
    mode: row.mode,
    consultationType: row.consultation_type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    amount: row.amount,
    durationMinutes: row.duration_minutes,
    paymentId: row.payment_id,
    notes: row.notes,
    billingModel,
    ratePerMinute,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userName: row.user_name,
    userPhone: row.user_phone,
    lawyerName: row.lawyer_name,
    lawyerPhone: row.lawyer_phone,
  };
}

function isOnlineMeteredConsultation(consultationType, mode) {
  return mode === 'online' && consultationType !== 'physical';
}

function resolveBookingStatus(consultationType, mode) {
  if (consultationType === 'physical' || mode === 'offline') {
    return 'pending';
  }
  return 'confirmed';
}

function creditLawyerForBooking(lawyerId, grossAmount, consultationType, appointmentId) {
  const payout = platformSettings.applyLawyerPayout(grossAmount);
  creditWallet(lawyerId, 'lawyer', {
    amount: payout.netAmount,
    description: `Consultation booking (${consultationType})${payout.commissionPercent > 0 ? ` · ${payout.commissionPercent}% platform fee` : ''}`,
    referenceType: 'booking',
    referenceId: appointmentId,
  });
  return payout;
}

function sendBookingNotifications({
  userId,
  lawyer,
  consultationType,
  status,
  scheduledAt,
  appointmentId,
  mode = 'online',
}) {
  const scheduleLabel = scheduledAt ? ` on ${scheduledAt}` : '';
  const category = mode === 'offline' || consultationType === 'physical' ? 'booking' : 'consultation';

  if (status === 'pending') {
    notificationService.createNotification(userId, 'user', {
      title: 'Meeting request sent',
      body: `Your in-person meeting request with ${lawyer.fullName}${scheduleLabel} is awaiting lawyer confirmation.`,
      category,
      actionType: 'appointment',
      actionId: appointmentId,
    });
    notificationService.createNotification(lawyer.id, 'lawyer', {
      title: 'New in-person meeting request',
      body: `Confirm or decline a ${consultationType} meeting request${scheduleLabel}.`,
      category,
      actionType: 'appointment',
      actionId: appointmentId,
    });
    return;
  }

  notificationService.createNotification(userId, 'user', {
    title: 'Appointment confirmed',
    body: `Your ${consultationType} appointment with ${lawyer.fullName} is confirmed.`,
    category,
    actionType: 'appointment',
    actionId: appointmentId,
  });

  notificationService.createNotification(lawyer.id, 'lawyer', {
    title: 'New appointment',
    body: `You have a new ${consultationType} consultation booking.`,
    category,
    actionType: 'appointment',
    actionId: appointmentId,
  });
}

function createBooking(userId, payload) {
  const { lawyerId, mode, consultationType, scheduledAt, notes, payFromWallet } = payload;

  const lawyer = getApprovedLawyerById(lawyerId, userId);
  if (!lawyer) {
    const error = new Error('Lawyer not available for booking');
    error.status = 404;
    throw error;
  }

  const ratePerMinute = resolveBookingAmount(lawyerId, consultationType);
  if (ratePerMinute <= 0) {
    const error = new Error('Invalid consultation rate');
    error.status = 400;
    throw error;
  }

  const durationMinutes = resolveBookingDuration(lawyerId, consultationType);
  const status = resolveBookingStatus(consultationType, mode);

  if (status === 'pending' && !scheduledAt) {
    const error = new Error('Meeting date and time are required for in-person bookings');
    error.status = 400;
    throw error;
  }

  if (isOnlineMeteredConsultation(consultationType, mode)) {
    if (payFromWallet) {
      const error = new Error(
        'Online consultations bill per minute from wallet during the session. Top up wallet and book again.',
      );
      error.status = 400;
      throw error;
    }

    const minMinutes = platformSettings.getMinConsultWalletMinutes();
    const wallet = getWalletSummary(userId, 'user');
    const minRequired = ratePerMinute * minMinutes;
    if (wallet.balance < minRequired) {
      const error = new Error(
        `Wallet needs at least ₹${Math.ceil(minRequired)} (≈${minMinutes} min at ₹${ratePerMinute}/min). Please top up.`,
      );
      error.status = 402;
      throw error;
    }

    const result = db.prepare(`
      INSERT INTO appointments (
        user_id, lawyer_id, mode, consultation_type, status,
        scheduled_at, amount, duration_minutes, payment_id, notes,
        billing_model, rate_per_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      lawyerId,
      mode,
      consultationType,
      status,
      scheduledAt || null,
      0,
      durationMinutes,
      null,
      notes || null,
      'per_minute',
      ratePerMinute,
    );

    sendBookingNotifications({
      userId,
      lawyer,
      consultationType,
      status,
      scheduledAt,
      appointmentId: result.lastInsertRowid,
      mode,
    });

    return getAppointmentById(result.lastInsertRowid);
  }

  const amount = ratePerMinute;
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
      scheduled_at, amount, duration_minutes, payment_id, notes,
      billing_model, rate_per_minute
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    lawyerId,
    mode,
    consultationType,
    status,
    scheduledAt || null,
    amount,
    durationMinutes,
    payment.id,
    notes || null,
    'prepaid',
    null,
  );

  if (status === 'confirmed') {
    creditLawyerForBooking(lawyerId, amount, consultationType, result.lastInsertRowid);
  }

  sendBookingNotifications({
    userId,
    lawyer,
    consultationType,
    status,
    scheduledAt,
    appointmentId: result.lastInsertRowid,
    mode,
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

  const previousStatus = appointment.status;

  if (status === 'cancelled' && !['pending', 'confirmed'].includes(previousStatus)) {
    const error = new Error('This appointment cannot be cancelled');
    error.status = 400;
    throw error;
  }

  if (status === 'confirmed' && previousStatus === 'pending' && actorRole === 'lawyer') {
    creditLawyerForBooking(
      appointment.lawyerId,
      appointment.amount,
      appointment.consultationType,
      appointmentId,
    );
    notificationService.createNotification(appointment.userId, 'user', {
      title: 'Meeting confirmed',
      body: `Your in-person meeting with ${appointment.lawyerName || 'the lawyer'} has been confirmed.`,
      category: 'booking',
      actionType: 'appointment',
      actionId: appointmentId,
    });
  }

  function refundUserBooking(reasonTitle, reasonBody) {
    creditWallet(appointment.userId, 'user', {
      amount: appointment.amount,
      description: reasonTitle,
      referenceType: 'booking_refund',
      referenceId: appointmentId,
    });
    notificationService.createNotification(appointment.userId, 'user', {
      title: reasonTitle,
      body: reasonBody,
      category: 'booking',
      actionType: 'appointment',
      actionId: appointmentId,
    });
  }

  function clawBackLawyerCredit() {
    const credit = db.prepare(`
      SELECT wt.amount
      FROM wallet_transactions wt
      JOIN wallets w ON w.id = wt.wallet_id
      WHERE w.user_id = ? AND w.role = 'lawyer'
        AND wt.type = 'credit'
        AND wt.reference_type = 'booking'
        AND wt.reference_id = ?
      ORDER BY wt.id DESC
      LIMIT 1
    `).get(appointment.lawyerId, appointmentId);

    if (!credit) {
      return;
    }

    const balanceRow = db
      .prepare('SELECT balance FROM wallets WHERE user_id = ? AND role = ?')
      .get(appointment.lawyerId, 'lawyer');
    const balance = balanceRow?.balance ?? 0;
    const clawback = Math.min(Number(credit.amount), balance);
    if (clawback <= 0) {
      return;
    }

    debitWallet(appointment.lawyerId, 'lawyer', {
      amount: clawback,
      description: 'Booking cancelled — earnings adjustment',
      referenceType: 'booking_reversal',
      referenceId: appointmentId,
    });
  }

  if (status === 'cancelled' && previousStatus === 'pending') {
    refundUserBooking(
      'Meeting request cancelled',
      'Your in-person meeting request was cancelled. The booking amount has been refunded to your wallet.',
    );
    notificationService.createNotification(appointment.lawyerId, 'lawyer', {
      title: 'Meeting request cancelled',
      body:
        actorRole === 'user'
          ? 'The client cancelled their in-person meeting request.'
          : 'You declined or cancelled a pending in-person meeting request.',
      category: 'booking',
      actionType: 'appointment',
      actionId: appointmentId,
    });
  }

  if (status === 'cancelled' && previousStatus === 'confirmed') {
    if (appointment.billingModel !== 'per_minute' && appointment.amount > 0) {
      refundUserBooking(
        'Appointment cancelled',
        'Your appointment was cancelled. The booking amount has been refunded to your wallet.',
      );
      clawBackLawyerCredit();
    }
    const peerId = actorRole === 'user' ? appointment.lawyerId : appointment.userId;
    const peerRole = actorRole === 'user' ? 'lawyer' : 'user';
    notificationService.createNotification(peerId, peerRole, {
      title: 'Appointment cancelled',
      body:
        actorRole === 'user'
          ? 'The client cancelled a confirmed appointment.'
          : 'Your lawyer cancelled the appointment.',
      category: 'booking',
      actionType: 'appointment',
      actionId: appointmentId,
    });
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
  resolveBookingStatus,
  creditLawyerForBooking,
  sendBookingNotifications,
};
