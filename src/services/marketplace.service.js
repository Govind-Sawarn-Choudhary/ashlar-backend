const db = require('../db');
const { getLawyerFees, getLawyerAvailability } = require('./lawyer.service');

function mapLawyerListItem(row) {
  return {
    id: row.user_id,
    fullName: row.full_name || row.bar_verified_name || 'Lawyer',
    practiceAreas: row.practice_areas,
    experienceYears: row.experience_years,
    location: row.location || row.bar_verified_address,
    bio: row.bio,
    phone: row.phone,
    isFavourite: Boolean(row.is_favourite),
    fees: getLawyerFees(row.user_id),
    availability: getLawyerAvailability(row.user_id),
  };
}

function listApprovedLawyers({ q, practiceArea, limit = 20, offset = 0, userId } = {}) {
  let query = `
    SELECT lp.*, u.phone,
      CASE WHEN f.lawyer_id IS NOT NULL THEN 1 ELSE 0 END AS is_favourite
    FROM lawyer_profiles lp
    JOIN users u ON u.id = lp.user_id
    LEFT JOIN favourites f ON f.lawyer_id = lp.user_id AND f.user_id = ?
    WHERE lp.onboarding_step = 'complete'
      AND lp.verification_status = 'approved'
  `;

  const params = [userId || 0];

  if (q?.trim()) {
    query += ` AND (
      lp.full_name LIKE ? OR lp.practice_areas LIKE ? OR lp.location LIKE ?
    )`;
    const term = `%${q.trim()}%`;
    params.push(term, term, term);
  }

  if (practiceArea?.trim()) {
    query += ' AND lp.practice_areas LIKE ?';
    params.push(`%${practiceArea.trim()}%`);
  }

  query += ' ORDER BY datetime(lp.updated_at) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params).map(mapLawyerListItem);
}

function getApprovedLawyerById(lawyerId, userId) {
  const row = db.prepare(`
    SELECT lp.*, u.phone,
      CASE WHEN f.lawyer_id IS NOT NULL THEN 1 ELSE 0 END AS is_favourite
    FROM lawyer_profiles lp
    JOIN users u ON u.id = lp.user_id
    LEFT JOIN favourites f ON f.lawyer_id = lp.user_id AND f.user_id = ?
    WHERE lp.user_id = ?
      AND lp.onboarding_step = 'complete'
      AND lp.verification_status = 'approved'
  `).get(userId || 0, lawyerId);

  return row ? mapLawyerListItem(row) : null;
}

function toggleFavourite(userId, lawyerId) {
  const lawyer = getApprovedLawyerById(lawyerId);
  if (!lawyer) {
    const error = new Error('Lawyer not found');
    error.status = 404;
    throw error;
  }

  const existing = db
    .prepare('SELECT 1 FROM favourites WHERE user_id = ? AND lawyer_id = ?')
    .get(userId, lawyerId);

  if (existing) {
    db.prepare('DELETE FROM favourites WHERE user_id = ? AND lawyer_id = ?').run(
      userId,
      lawyerId,
    );
    return { isFavourite: false };
  }

  db.prepare('INSERT INTO favourites (user_id, lawyer_id) VALUES (?, ?)').run(
    userId,
    lawyerId,
  );
  return { isFavourite: true };
}

function resolveBookingAmount(lawyerId, consultationType) {
  const fee = db
    .prepare(`
      SELECT amount FROM lawyer_consultation_fees
      WHERE user_id = ? AND fee_type = ?
    `)
    .get(lawyerId, consultationType);

  if (!fee) {
    const error = new Error('Consultation fee not configured for this lawyer');
    error.status = 400;
    throw error;
  }

  return Number.parseFloat(fee.amount) || 0;
}

function resolveBookingDuration(lawyerId, consultationType) {
  const fee = db
    .prepare(`
      SELECT duration_minutes FROM lawyer_consultation_fees
      WHERE user_id = ? AND fee_type = ?
    `)
    .get(lawyerId, consultationType);

  return fee?.duration_minutes || 30;
}

module.exports = {
  listApprovedLawyers,
  getApprovedLawyerById,
  toggleFavourite,
  resolveBookingAmount,
  resolveBookingDuration,
};
