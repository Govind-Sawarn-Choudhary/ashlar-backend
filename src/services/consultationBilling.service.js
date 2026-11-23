const db = require('../db');
const appointmentService = require('./appointment.service');
const platformSettings = require('./platformSettings.service');
const notificationService = require('./notification.service');
const { debitWallet, creditWallet, getWalletSummary } = require('./wallet.service');

const MIN_SECONDS_PER_MINUTE = 40;
const WINDOW_SECONDS = 60;

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
 * Billable minute = at least 40 seconds in that 60-second window (0–40s free, 1:40+ = 2 min, etc.).
 */
function computeBillableMinutes(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (secs < MIN_SECONDS_PER_MINUTE) {
    return 0;
  }
  let remaining = secs;
  let count = 0;
  while (remaining > 0) {
    const inWindow = Math.min(remaining, WINDOW_SECONDS);
    if (inWindow >= MIN_SECONDS_PER_MINUTE) {
      count += 1;
    }
    remaining -= WINDOW_SECONDS;
  }
  return count;
}

function secondsSinceStarted(startedAt) {
  if (!startedAt) {
    return 0;
  }
  const row = db
    .prepare(
      "SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) AS secs",
    )
    .get(startedAt);
  return Math.max(0, row?.secs ?? 0);
}

function secondsBetween(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return 0;
  }
  const row = db
    .prepare(
      'SELECT CAST((julianday(?) - julianday(?)) * 86400 AS INTEGER) AS secs',
    )
    .get(endedAt, startedAt);
  return Math.max(0, row?.secs ?? 0);
}

/** Seconds of active call before minute `(billedSoFar + 1)` may be charged. */
function secondsUntilNextBill(billedSoFar) {
  return billedSoFar * WINDOW_SECONDS + MIN_SECONDS_PER_MINUTE;
}

function chargeOneMinute(session, appointment, ratePerMinute) {
  debitWallet(appointment.userId, 'user', {
    amount: ratePerMinute,
    description: `${appointment.consultationType} consultation (1 min)`,
    referenceType: 'consultation_minute',
    referenceId: session.id,
  });

  const payout = platformSettings.applyLawyerPayout(ratePerMinute);
  creditWallet(appointment.lawyerId, 'lawyer', {
    amount: payout.netAmount,
    description: `${appointment.consultationType} consultation (1 min)`,
    referenceType: 'consultation_minute',
    referenceId: session.id,
  });
}

function refundOneMinute(session, appointment, ratePerMinute) {
  creditWallet(appointment.userId, 'user', {
    amount: ratePerMinute,
    description: `${appointment.consultationType} consultation adjustment (partial min)`,
    referenceType: 'consultation_adjustment',
    referenceId: session.id,
  });

  const payout = platformSettings.applyLawyerPayout(ratePerMinute);
  try {
    debitWallet(appointment.lawyerId, 'lawyer', {
      amount: payout.netAmount,
      description: `${appointment.consultationType} consultation adjustment`,
      referenceType: 'consultation_adjustment',
      referenceId: session.id,
    });
  } catch (_) {
    // Lawyer wallet may be insufficient; user refund still applied.
  }
}

function syncBilledMinutes(sessionId, targetMinutes) {
  db.prepare(`
    UPDATE consultation_sessions
    SET billed_minutes = ?,
        last_billed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(targetMinutes, sessionId);
}

/**
 * On session end, align wallet charges with 40-second-per-minute rules (refund or catch-up).
 */
function finalizeSessionBilling(sessionId) {
  const session = getSessionRowById(sessionId);
  if (!session || !session.started_at) {
    return null;
  }

  const appointment = appointmentService.getAppointmentById(session.appointment_id);
  if (!appointment || appointment.billingModel !== 'per_minute') {
    return null;
  }

  const ratePerMinute = resolveRatePerMinute(appointment);
  if (ratePerMinute <= 0) {
    return null;
  }

  const endAt = session.ended_at || db.prepare("SELECT datetime('now') AS now").get().now;
  const elapsed = secondsBetween(session.started_at, endAt);
  const targetMinutes = computeBillableMinutes(elapsed);
  const billedSoFar = session.billed_minutes || 0;

  if (targetMinutes < billedSoFar) {
    for (let i = 0; i < billedSoFar - targetMinutes; i += 1) {
      refundOneMinute(session, appointment, ratePerMinute);
    }
    syncBilledMinutes(sessionId, targetMinutes);
  } else if (targetMinutes > billedSoFar) {
    const toCharge = targetMinutes - billedSoFar;
    for (let i = 0; i < toCharge; i += 1) {
      try {
        chargeOneMinute(session, appointment, ratePerMinute);
      } catch (error) {
        if (error.status === 400 && /insufficient/i.test(error.message)) {
          syncBilledMinutes(sessionId, billedSoFar + i);
          return {
            billedMinutes: billedSoFar + i,
            partial: true,
            ratePerMinute,
          };
        }
        throw error;
      }
    }
    syncBilledMinutes(sessionId, targetMinutes);
  }

  return {
    billedMinutes: targetMinutes,
    ratePerMinute,
    totalCharged: targetMinutes * ratePerMinute,
    callDurationSeconds: elapsed,
  };
}

/**
 * Debit user wallet and credit lawyer for one consultation minute (per-minute calls).
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

  if (!session.started_at) {
    return { skipped: true, reason: 'not_started', billedMinutes: billedSoFar };
  }

  const elapsed = secondsSinceStarted(session.started_at);
  const dueAt = secondsUntilNextBill(billedSoFar);
  if (elapsed < dueAt) {
    const wallet = getWalletSummary(appointment.userId, 'user');
    return {
      skipped: true,
      reason: 'grace_period',
      billedMinutes: billedSoFar,
      ratePerMinute,
      walletBalance: wallet.balance,
      totalCharged: billedSoFar * ratePerMinute,
      elapsedSeconds: elapsed,
      nextBillAtSeconds: dueAt,
      graceSeconds: MIN_SECONDS_PER_MINUTE,
    };
  }

  try {
    chargeOneMinute(session, appointment, ratePerMinute);
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

  const billedMinutes = billedSoFar + 1;
  syncBilledMinutes(sessionId, billedMinutes);

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
    elapsedSeconds: elapsed,
    nextBillAtSeconds: secondsUntilNextBill(billedMinutes),
    graceSeconds: MIN_SECONDS_PER_MINUTE,
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

  let elapsedSeconds = 0;
  let nextBillAtSeconds = null;
  if (session?.started_at && session?.status === 'active') {
    elapsedSeconds = secondsSinceStarted(session.started_at);
    nextBillAtSeconds = secondsUntilNextBill(session.billed_minutes || 0);
  }

  return {
    model: 'per_minute',
    ratePerMinute,
    minWalletMinutes: minMinutes,
    minWalletBalance: ratePerMinute * minMinutes,
    walletBalance: wallet?.balance ?? null,
    billedMinutes: session?.billed_minutes ?? 0,
    maxMinutes: appointment.durationMinutes || 60,
    graceSeconds: MIN_SECONDS_PER_MINUTE,
    elapsedSeconds,
    nextBillAtSeconds,
  };
}

module.exports = {
  billConsultationMinute,
  buildBillingSnapshot,
  finalizeSessionBilling,
  computeBillableMinutes,
  MIN_SECONDS_PER_MINUTE,
};