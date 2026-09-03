const db = require('../db');
const { createPayment } = require('./payment.service');
const { debitWallet } = require('./wallet.service');

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function mapChallan(row) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    mobile: row.mobile,
    title: row.title,
    amount: row.amount,
    status: row.status,
    paymentId: row.payment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureSampleChallans(userId, vehicleNumber) {
  const normalizedVehicle = vehicleNumber.trim().toUpperCase();
  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM challans WHERE user_id = ? AND vehicle_number = ?')
    .get(userId, normalizedVehicle).count;

  if (existing > 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO challans (user_id, vehicle_number, title, amount, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  insert.run(userId, normalizedVehicle, 'Over-speeding fine', 1000, 'pending');
  insert.run(userId, normalizedVehicle, 'Signal violation', 500, 'in_progress');
  insert.run(userId, normalizedVehicle, 'Parking violation', 300, 'settled');
}

function lookupVehicle(userId, vehicleNumber) {
  if (!vehicleNumber?.trim()) {
    const error = new Error('vehicleNumber is required');
    error.status = 400;
    throw error;
  }

  ensureSampleChallans(userId, vehicleNumber);
  const normalizedVehicle = vehicleNumber.trim().toUpperCase();

  const challans = db
    .prepare(`
      SELECT * FROM challans
      WHERE user_id = ? AND vehicle_number = ?
      ORDER BY datetime(created_at) DESC
    `)
    .all(userId, normalizedVehicle)
    .map(mapChallan);

  return {
    vehicleNumber: normalizedVehicle,
    challans,
  };
}

function sendChallanOtp(userId, vehicleNumber, mobile) {
  const normalizedVehicle = vehicleNumber?.trim().toUpperCase();
  const normalizedMobile = String(mobile || '').replace(/\D/g, '');

  if (!normalizedVehicle || normalizedMobile.length !== 10) {
    const error = new Error('Valid vehicleNumber and 10-digit mobile are required');
    error.status = 400;
    throw error;
  }

  ensureSampleChallans(userId, normalizedVehicle);

  const otpCode = getSetting('challan_test_otp', '1234');

  db.prepare(`
    DELETE FROM challan_otp_sessions
    WHERE user_id = ? AND vehicle_number = ?
  `).run(userId, normalizedVehicle);

  db.prepare(`
    INSERT INTO challan_otp_sessions (user_id, vehicle_number, mobile, otp_code, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))
  `).run(userId, normalizedVehicle, normalizedMobile, otpCode);

  console.log(`[Challan OTP] ${normalizedMobile} → ${otpCode}`);

  return {
    vehicleNumber: normalizedVehicle,
    mobile: normalizedMobile,
    message: 'OTP sent successfully',
  };
}

function verifyChallanOtp(userId, vehicleNumber, mobile, otp) {
  const normalizedVehicle = vehicleNumber?.trim().toUpperCase();
  const normalizedMobile = String(mobile || '').replace(/\D/g, '');
  const normalizedOtp = String(otp || '').trim();

  const session = db.prepare(`
    SELECT * FROM challan_otp_sessions
    WHERE user_id = ? AND vehicle_number = ? AND mobile = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(userId, normalizedVehicle, normalizedMobile);

  if (!session) {
    const error = new Error('OTP session not found');
    error.status = 404;
    throw error;
  }

  if (session.otp_code !== normalizedOtp) {
    const error = new Error('Invalid OTP');
    error.status = 401;
    throw error;
  }

  if (new Date(session.expires_at) < new Date()) {
    const error = new Error('OTP expired');
    error.status = 401;
    throw error;
  }

  db.prepare(`
    UPDATE challan_otp_sessions SET verified = 1 WHERE id = ?
  `).run(session.id);

  db.prepare(`
    UPDATE challans SET mobile = ?, updated_at = datetime('now')
    WHERE user_id = ? AND vehicle_number = ?
  `).run(normalizedMobile, userId, normalizedVehicle);

  return lookupVehicle(userId, normalizedVehicle);
}

function listChallans(userId, { vehicleNumber, status } = {}) {
  let query = 'SELECT * FROM challans WHERE user_id = ?';
  const params = [userId];

  if (vehicleNumber?.trim()) {
    query += ' AND vehicle_number = ?';
    params.push(vehicleNumber.trim().toUpperCase());
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY datetime(created_at) DESC';

  return db.prepare(query).all(...params).map(mapChallan);
}

function payChallan(userId, challanId, { payFromWallet } = {}) {
  const challan = db
    .prepare('SELECT * FROM challans WHERE id = ? AND user_id = ?')
    .get(challanId, userId);

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

  const amount = challan.amount;

  if (payFromWallet) {
    debitWallet(userId, 'user', {
      amount,
      description: challan.title,
      referenceType: 'challan',
      referenceId: challan.id,
    });
  } else {
    const error = new Error('Gateway payments must use Razorpay order flow');
    error.status = 400;
    throw error;
  }

  const payment = createPayment(userId, {
    amount,
    paymentType: 'challan',
    metadata: { challanId: challan.id, vehicleNumber: challan.vehicle_number },
  });

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

module.exports = {
  lookupVehicle,
  sendChallanOtp,
  verifyChallanOtp,
  listChallans,
  payChallan,
};
