const db = require('../db');
const appointmentService = require('./appointment.service');
const platformSettings = require('./platformSettings.service');
const notificationService = require('./notification.service');
const { debitWallet, creditWallet, getWalletSummary } = require('./wallet.service');

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

  const appointment = appointmentService.getAppointmentById(session.appointment_id);
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

  return { session, appointment };
}

function resolveRatePerMinute(appointment) {
  if (appointment.billingModel === 'per_minute') {
    return Number(appointment.ratePerMinute) || 0;
  }
  return 0;
}

/**
 * Debit user wallet and credit lawyer for one consultation minute (Astrotalk-style).
 */
function billConsultationMinute(sessionId, actorUserId, actorRole, endSessionFn) {
  const { session, appointment } = assertSessionAccess(sessionId, actorUserId, actorRole);

  if (appointment.billingModel !== 'per_minute') {
    return { skipped: true, billingModel: 'prepaid' };
  }

  if (session.status !== 'active') {
    return { skipped: true, reason: 'session_not_active' };
  }

  const ratePerMinute = resolveRatePerMinute(appointment);
  if (ratePerMinute <= 0) {
    const error = new Error('Consultation rate is not configured');
    error.status = 400;
    throw error;
  }

  const maxMinutes = appointment.durationMinutes || 60;
  const billedSoFar = session.billed_minutes || 0;
  if (billedSoFar >= maxMinutes) {
    endSessionFn(sessionId, null, 'system');
    return { skipped: true, reason: 'max_duration_reached', billedMinutes: billedSoFar };
  }

  if (session.last_billed_at) {
    const throttle = db
      .prepare("SELECT datetime('now', '-50 seconds') < datetime(?) AS tooSoon")
      .get(session.last_billed_at);
    if (throttle?.tooSoon) {
      const wallet = getWalletSummary(appointment.userId, 'user');
      return {
        skipped: true,
        reason: 'throttled',
        billedMinutes: billedSoFar,
        ratePerMinute,
        walletBalance: wallet.balance,
        totalCharged: billedSoFar * ratePerMinute,
      };
    }
  }

  try {
    debitWallet(appointment.userId, 'user', {
      amount: ratePerMinute,
      description: `${appointment.consultationType} consultation (1 min)`,
      referenceType: 'consultation_minute',
      referenceId: sessionId,
    });
  } catch (error) {
    if (error.status === 400 && /insufficient/i.test(error.message)) {
      endSessionFn(sessionId, null, 'system');
      notificationService.createNotification(appointment.userId, 'user', {
        title: 'Consultation ended — low balance',
        body: 'Your wallet ran out during the consultation. Add funds to book again.',
        category: 'wallet',
        actionType: 'wallet',
      });
      const walletError = new Error(
        'Insufficient wallet balance. Session ended — please top up your wallet.',
      );
      walletError.status = 402;
      walletError.code = 'WALLET_EMPTY';
      throw walletError;
    }
    throw error;
  }

  const payout = platformSettings.applyLawyerPayout(ratePerMinute);
  creditWallet(appointment.lawyerId, 'lawyer', {
    amount: payout.netAmount,
    description: `${appointment.consultationType} consultation (1 min)`,
    referenceType: 'consultation_minute',
    referenceId: sessionId,
  });

  const billedMinutes = billedSoFar + 1;
  db.prepare(`
    UPDATE consultation_sessions
    SET last_billed_at = datetime('now'),
        billed_minutes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(billedMinutes, sessionId);

  const wallet = getWalletSummary(appointment.userId, 'user');
  const lowThreshold = ratePerMinute * 3;
  if (
    wallet.balance < lowThreshold &&
    !session.wallet_low_notified &&
    wallet.balance >= 0
  ) {
    db.prepare(
      'UPDATE consultation_sessions SET wallet_low_notified = 1, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(sessionId);
    notificationService.createNotification(appointment.userId, 'user', {
      title: 'Wallet running low',
      body: `About ${Math.max(1, Math.floor(wallet.balance / ratePerMinute))} minute(s) left at the current rate. Top up to avoid disconnection.`,
      category: 'wallet',
      actionType: 'wallet',
    });
  }

  return {
    billedMinutes,
    ratePerMinute,
    walletBalance: wallet.balance,
    totalCharged: billedMinutes * ratePerMinute,
    maxMinutes,
  };
}

function buildBillingSnapshot(appointment, session, actorRole) {
  if (appointment.billingModel !== 'per_minute') {
    return { model: 'prepaid' };
  }

  const ratePerMinute = resolveRatePerMinute(appointment);
  const minMinutes = platformSettings.getMinConsultWalletMinutes();
  const wallet =
    actorRole === 'user'
      ? getWalletSummary(appointment.userId, 'user')
      : null;

  return {
    model: 'per_minute',
    ratePerMinute,
    minWalletMinutes: minMinutes,
    minWalletBalance: ratePerMinute * minMinutes,
    walletBalance: wallet?.balance ?? null,
    billedMinutes: session?.billed_minutes ?? 0,
    maxMinutes: appointment.durationMinutes || 60,
  };
}

module.exports = {
  billConsultationMinute,
  buildBillingSnapshot,
};