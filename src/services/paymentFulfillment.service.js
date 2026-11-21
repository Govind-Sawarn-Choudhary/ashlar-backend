const db = require('../db');
const appointmentService = require('./appointment.service');
const { debitWallet, creditWallet } = require('./wallet.service');
const { getApprovedLawyerById, resolveBookingAmount, resolveBookingDuration } = require('./marketplace.service');
const notificationService = require('./notification.service');
const documentService = require('./document.service');
const paymentService = require('./payment.service');
const platformSettings = require('./platformSettings.service');

function creditLawyerBooking(lawyerId, grossAmount, consultationType, referenceId) {
  return appointmentService.creditLawyerForBooking(
    lawyerId,
    grossAmount,
    consultationType,
    referenceId,
  );
}

function mapChallan(row) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    title: row.title,
    amount: row.amount,
    status: row.status,
  };
}

function fulfillBooking(userId, payment, metadata) {
  const { lawyerId, mode, consultationType, scheduledAt, notes } = metadata;

  if (appointmentService.isOnlineMeteredConsultation(consultationType, mode)) {
    const error = new Error(
      'Online chat/call/video uses per-minute wallet billing. Book without Razorpay payment.',
    );
    error.status = 400;
    throw error;
  }

  const lawyer = getApprovedLawyerById(Number(lawyerId), userId);
  if (!lawyer) {
    const error = new Error('Lawyer not available for booking');
    error.status = 404;
    throw error;
  }

  const existing = db
    .prepare('SELECT id FROM appointments WHERE payment_id = ?')
    .get(payment.id);
  if (existing) {
    return appointmentService.getAppointmentById(existing.id);
  }

  const amount = payment.amount;
  const durationMinutes = resolveBookingDuration(Number(lawyerId), consultationType);
  const status = appointmentService.resolveBookingStatus(consultationType, mode);

  if (status === 'pending' && !scheduledAt) {
    const error = new Error('Meeting date and time are required for in-person bookings');
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
    Number(lawyerId),
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
    creditLawyerBooking(Number(lawyerId), amount, consultationType, result.lastInsertRowid);
  }

  appointmentService.sendBookingNotifications({
    userId,
    lawyer,
    consultationType,
    status,
    scheduledAt,
  });

  return appointmentService.getAppointmentById(result.lastInsertRowid);
}

function fulfillChallan(userId, payment, metadata) {
  const challanId = Number(metadata.challanId);
  const challan = db
    .prepare('SELECT * FROM challans WHERE id = ? AND user_id = ?')
    .get(challanId, userId);

  if (!challan) {
    const error = new Error('Challan not found');
    error.status = 404;
    throw error;
  }

  if (challan.status === 'settled') {
    return {
      challan: mapChallan(challan),
      payment,
    };
  }

  db.prepare(`
    UPDATE challans
    SET status = 'settled', payment_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(payment.id, challan.id);

  return {
    challan: mapChallan(
      db.prepare('SELECT * FROM challans WHERE id = ?').get(challan.id),
    ),
    payment,
  };
}

function fulfillWalletTopup(userId, payment) {
  const existing = db.prepare(`
    SELECT wt.id FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE w.user_id = ? AND w.role = 'user'
      AND wt.reference_type = 'wallet_topup'
      AND wt.reference_id = ?
  `).get(userId, payment.id);

  const wallet = db
    .prepare('SELECT balance FROM wallets WHERE user_id = ? AND role = ?')
    .get(userId, 'user');

  if (existing) {
    return { balance: wallet?.balance ?? 0, payment };
  }

  creditWallet(userId, 'user', {
    amount: payment.amount,
    description: 'Wallet top-up via Razorpay',
    referenceType: 'wallet_topup',
    referenceId: payment.id,
  });

  const updated = db
    .prepare('SELECT balance FROM wallets WHERE user_id = ? AND role = ?')
    .get(userId, 'user');

  return {
    balance: updated?.balance ?? 0,
    payment,
  };
}

function fulfillDocument(userId, payment, metadata) {
  const productId = Number(metadata.productId);
  const product = documentService.getProductById(productId);

  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  notificationService.createNotification(userId, 'user', {
    title: 'Document order placed',
    body: `${product.name} order received. Our team will contact you shortly.`,
  });

  return { product, payment };
}

function fulfillPayment(userId, payment) {
  const metadata = payment.metadata || {};

  switch (payment.paymentType) {
    case 'booking':
      return {
        type: 'booking',
        appointment: fulfillBooking(userId, payment, metadata),
        payment,
      };
    case 'challan':
      return {
        type: 'challan',
        ...fulfillChallan(userId, payment, metadata),
      };
    case 'wallet_topup':
      return {
        type: 'wallet_topup',
        ...fulfillWalletTopup(userId, payment),
      };
    case 'document':
      return {
        type: 'document',
        ...fulfillDocument(userId, payment, metadata),
      };
    default: {
      const error = new Error('Unsupported payment type');
      error.status = 400;
      throw error;
    }
  }
}

function resolveOrderAmount(userId, paymentType, metadata, clientAmount) {
  switch (paymentType) {
    case 'booking': {
      if (
        appointmentService.isOnlineMeteredConsultation(
          metadata.consultationType,
          metadata.mode || 'online',
        )
      ) {
        const error = new Error(
          'Online consultations are billed per minute from wallet — not via Razorpay booking.',
        );
        error.status = 400;
        throw error;
      }
      const amount = resolveBookingAmount(
        Number(metadata.lawyerId),
        metadata.consultationType,
      );
      if (amount <= 0) {
        const error = new Error('Invalid booking amount');
        error.status = 400;
        throw error;
      }
      return amount;
    }
    case 'challan': {
      const challan = db
        .prepare('SELECT amount, status FROM challans WHERE id = ? AND user_id = ?')
        .get(Number(metadata.challanId), userId);
      if (!challan) {
        const error = new Error('Challan not found');
        error.status = 404;
        throw error;
      }
      if (challan.status === 'settled') {
        const error = new Error('Challan already settled');
        error.status = 400;
        throw error;
      }
      return challan.amount;
    }
    case 'document': {
      const product = documentService.getProductById(Number(metadata.productId));
      if (!product) {
        const error = new Error('Product not found');
        error.status = 404;
        throw error;
      }
      return Number(product.price);
    }
    case 'wallet_topup': {
      const amount = Number(clientAmount);
      const minTopup = platformSettings.getMinWalletTopup();
      if (!amount || amount <= 0) {
        const error = new Error('Valid amount is required');
        error.status = 400;
        throw error;
      }
      if (minTopup > 0 && amount < minTopup) {
        const error = new Error(`Minimum wallet top-up is ₹${minTopup}`);
        error.status = 400;
        throw error;
      }
      return amount;
    }
    default: {
      const error = new Error('Unsupported payment type');
      error.status = 400;
      throw error;
    }
  }
}

module.exports = {
  fulfillPayment,
  resolveOrderAmount,
  fulfillBooking,
};
