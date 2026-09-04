const db = require('../db');

const DOC_TYPES = [
  'bar_council_certificate',
  'identity_proof',
  'law_degree',
  'passport_photo',
];

const REQUIRED_DOC_TYPES = [
  'bar_council_certificate',
  'passport_photo',
];

const FEE_TYPES = ['chat', 'audio', 'video', 'physical'];

function getUserByPhoneAndRole(phone, role) {
  return db
    .prepare('SELECT * FROM users WHERE phone = ? AND role = ?')
    .get(phone, role);
}

function createUser(phone, role) {
  const result = db
    .prepare('INSERT INTO users (phone, role) VALUES (?, ?)')
    .run(phone, role);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function ensureLawyerProfile(userId) {
  const existing = db
    .prepare('SELECT * FROM lawyer_profiles WHERE user_id = ?')
    .get(userId);

  if (existing) {
    return existing;
  }

  db.prepare('INSERT INTO lawyer_profiles (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM lawyer_profiles WHERE user_id = ?').get(userId);
}

function getLawyerProfile(userId) {
  return db.prepare('SELECT * FROM lawyer_profiles WHERE user_id = ?').get(userId);
}

function getLawyerDocuments(userId) {
  return db
    .prepare('SELECT doc_type, file_name, file_path, mime_type, uploaded_at FROM lawyer_documents WHERE user_id = ?')
    .all(userId);
}

function getLawyerAvailability(userId) {
  return db
    .prepare('SELECT * FROM lawyer_availability WHERE user_id = ?')
    .get(userId);
}

function getLawyerFees(userId) {
  return db
    .prepare('SELECT fee_type, amount, duration_label, duration_minutes, location FROM lawyer_consultation_fees WHERE user_id = ?')
    .all(userId);
}

function resolveLawyerNextRoute(profile) {
  if (!profile) {
    return 'verify_details';
  }

  switch (profile.onboarding_step) {
    case 'details':
      return 'verify_details';
    case 'documents':
      return 'upload_documents';
    case 'availability':
      return 'select_availability';
    case 'fees':
      return 'fee_and_charges';
    case 'complete':
      if (profile.verification_status === 'rejected') {
        return 'rejected';
      }
      return 'dashboard';
    default:
      return 'verify_details';
  }
}

function deriveLawyerLocation(profile, fees = []) {
  if (profile.location?.trim()) {
    return profile.location.trim();
  }

  if (profile.bar_verified_address?.trim()) {
    const address = profile.bar_verified_address.trim().replace(/\s+/g, ' ');
    return address.length > 80 ? `${address.slice(0, 77)}...` : address;
  }

  const physicalFee = fees.find(
    (fee) => fee.fee_type === 'physical' && fee.location?.trim(),
  );
  if (physicalFee) {
    return physicalFee.location.trim();
  }

  if (profile.bar_state?.trim()) {
    return profile.bar_state.trim();
  }

  return null;
}

function locationFromBarPayload(payload) {
  if (payload.district?.trim()) {
    const state = payload.state?.trim() || 'UP';
    return `${payload.district.trim()}, ${state}`;
  }

  if (payload.address?.trim()) {
    const address = payload.address.trim().replace(/\s+/g, ' ');
    return address.length > 80 ? `${address.slice(0, 77)}...` : address;
  }

  if (payload.state?.trim()) {
    return payload.state.trim();
  }

  return null;
}

function syncLawyerLocation(userId, fees = []) {
  const profile = getLawyerProfile(userId);
  if (profile.location?.trim()) {
    return profile;
  }

  const derived = deriveLawyerLocation(profile, fees);
  if (!derived) {
    return profile;
  }

  db.prepare(`
    UPDATE lawyer_profiles
    SET location = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(derived, userId);

  return getLawyerProfile(userId);
}

function mapLawyerFeesForClient(fees) {
  return fees.map((fee) => ({
    feeType: fee.fee_type,
    amount: fee.amount,
    durationLabel: fee.duration_label,
    durationMinutes: fee.duration_minutes,
    location: fee.location,
  }));
}

const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

function normalizeSelectedDays(payload) {
  let days = [];

  if (Array.isArray(payload.selectedDays)) {
    days = payload.selectedDays;
  } else if (typeof payload.selectedDays === 'string' && payload.selectedDays.trim()) {
    try {
      const parsed = JSON.parse(payload.selectedDays);
      if (Array.isArray(parsed)) {
        days = parsed;
      }
    } catch {
      days = [];
    }
  }

  if (days.length === 0 && payload.selectedDay !== undefined && payload.selectedDay !== null) {
    days = [Number(payload.selectedDay) || 0];
  }

  return [...new Set(days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort(
    (a, b) => a - b,
  );
}

function mapLawyerAvailabilityForClient(row) {
  if (!row) {
    return null;
  }

  let selectedDays = [];
  if (row.selected_days) {
    try {
      const parsed = JSON.parse(row.selected_days);
      if (Array.isArray(parsed)) {
        selectedDays = parsed
          .map((day) => Number(day))
          .filter((day) => day >= 0 && day <= 6);
      }
    } catch {
      selectedDays = [];
    }
  }

  if (selectedDays.length === 0) {
    selectedDays = row.repeat_weekly
      ? [...ALL_WEEK_DAYS]
      : [Number(row.selected_day) || 0];
  }

  return {
    selectedDay: Number(row.selected_day) || selectedDays[0] || 0,
    selectedDays,
    repeatWeekly: Boolean(row.repeat_weekly),
    weekStart: row.week_start,
    weekEnd: row.week_end,
    fromTime: row.from_time,
    toTime: row.to_time,
  };
}

function buildLawyerAuthPayload(user) {
  ensureLawyerProfile(user.id);
  const rawFees = getLawyerFees(user.id);
  const fees = mapLawyerFeesForClient(rawFees);
  const profile = syncLawyerLocation(user.id, rawFees);
  const documents = getLawyerDocuments(user.id);
  const availability = getLawyerAvailability(user.id);
  const displayLocation = deriveLawyerLocation(profile, rawFees);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      role: user.role,
    },
    lawyer: {
      fullName: profile.full_name,
      practiceAreas: profile.practice_areas,
      experienceYears: profile.experience_years,
      bio: profile.bio,
      location: displayLocation,
      barState: profile.bar_state,
      barEnrollmentNumber: profile.bar_enrollment_number,
      barEnrollmentVerified: Boolean(profile.bar_enrollment_verified),
      barVerifiedName: profile.bar_verified_name,
      barCopNumber: profile.bar_cop_number,
      barVerifiedAddress: profile.bar_verified_address,
      barVerifiedEnrollmentDate: profile.bar_verified_enrollment_date,
      barManualReview: Boolean(profile.bar_manual_review),
      barNameMatched:
        profile.bar_name_matched === null || profile.bar_name_matched === undefined
          ? null
          : Boolean(profile.bar_name_matched),
      onboardingStep: profile.onboarding_step,
      verificationStatus: profile.verification_status,
      rejectionReason: profile.rejection_reason,
      isProfileComplete: profile.onboarding_step === 'complete',
      isApproved: profile.verification_status === 'approved',
    },
    documents,
    availability: mapLawyerAvailabilityForClient(availability),
    fees,
    nextRoute: resolveLawyerNextRoute(profile),
  };
}

function normalizeEnrollmentNumber(raw) {
  return String(raw || '').trim().toUpperCase();
}

function findLawyerByEnrollment(enrollmentNumber, excludeUserId = null) {
  const normalized = normalizeEnrollmentNumber(enrollmentNumber);
  if (!normalized) {
    return null;
  }

  let query = `
    SELECT lp.user_id, u.phone, lp.full_name, lp.bar_verified_name
    FROM lawyer_profiles lp
    INNER JOIN users u ON u.id = lp.user_id
    WHERE UPPER(TRIM(lp.bar_enrollment_number)) = ?
  `;
  const params = [normalized];

  if (excludeUserId) {
    query += ' AND lp.user_id != ?';
    params.push(excludeUserId);
  }

  return db.prepare(query).get(...params);
}

function assertEnrollmentAvailable(enrollmentNumber, userId) {
  const existing = findLawyerByEnrollment(enrollmentNumber, userId);
  if (existing) {
    const error = new Error(
      'This Bar Council enrollment is already registered with another lawyer account',
    );
    error.status = 409;
    throw error;
  }
}

function applyBarCouncilDetailsToProfile(userId, payload) {
  if (!payload.enrollmentFound && !payload.verified) {
    return;
  }

  const sets = [];
  const params = [];

  if (payload.advocateName?.trim() && payload.enrollmentFound) {
    sets.push('full_name = ?');
    params.push(payload.advocateName.trim());
  }

  const location = locationFromBarPayload(payload);
  if (location) {
    sets.push('location = ?');
    params.push(location);
  }

  if (sets.length === 0) {
    return;
  }

  params.push(userId);
  db.prepare(`
    UPDATE lawyer_profiles
    SET ${sets.join(', ')}, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(...params);
}

function saveLawyerDetails(userId, payload) {
  ensureLawyerProfile(userId);

  const profile = getLawyerProfile(userId);
  const isPostOnboarding = profile.onboarding_step === 'complete';

  const resolvedFullName =
    profile.bar_enrollment_verified && profile.bar_verified_name
      ? profile.bar_verified_name
      : payload.fullName?.trim() || null;

  const nextStep = isPostOnboarding ? profile.onboarding_step : 'documents';

  db.prepare(`
    UPDATE lawyer_profiles
    SET full_name = ?, practice_areas = ?, experience_years = ?, bio = ?,
        onboarding_step = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    resolvedFullName,
    payload.practiceAreas?.trim() || null,
    payload.experienceYears?.trim() || null,
    payload.bio?.trim() || null,
    nextStep,
    userId,
  );

  return getLawyerProfile(userId);
}

function saveBarVerification(userId, payload) {
  ensureLawyerProfile(userId);

  const enrollmentToCheck =
    payload.matchedEnrollmentNumber || payload.inputEnrollmentNumber;
  if (enrollmentToCheck) {
    assertEnrollmentAvailable(enrollmentToCheck, userId);
  }

  const verified = payload.verified ? 1 : 0;
  const manualReview = payload.needsManualReview ? 1 : 0;
  const nameMatched =
    payload.nameMatched === null || payload.nameMatched === undefined
      ? null
      : payload.nameMatched
        ? 1
        : 0;

  db.prepare(`
    UPDATE lawyer_profiles
    SET bar_state = ?, bar_enrollment_number = ?, bar_enrollment_verified = ?,
        bar_verified_name = ?, bar_verified_at = datetime('now'),
        bar_cop_number = ?, bar_verified_address = ?, bar_verified_enrollment_date = ?,
        bar_manual_review = ?, bar_name_matched = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    payload.state,
    normalizeEnrollmentNumber(payload.matchedEnrollmentNumber || payload.inputEnrollmentNumber),
    verified,
    payload.advocateName || null,
    payload.copNumber || null,
    payload.address || null,
    payload.enrollmentDate || null,
    manualReview,
    nameMatched,
    userId,
  );

  applyBarCouncilDetailsToProfile(userId, payload);

  return getLawyerProfile(userId);
}

function saveBarEnrollmentDraft(userId, { state = 'UP', enrollmentNumber }) {
  if (!enrollmentNumber?.trim()) {
    const error = new Error('enrollmentNumber is required');
    error.status = 400;
    throw error;
  }

  ensureLawyerProfile(userId);
  const profile = getLawyerProfile(userId);

  if (profile.bar_enrollment_verified) {
    return profile;
  }

  assertEnrollmentAvailable(enrollmentNumber, userId);

  db.prepare(`
    UPDATE lawyer_profiles
    SET bar_state = ?,
        bar_enrollment_number = ?,
        bar_manual_review = 1,
        updated_at = datetime('now')
    WHERE user_id = ?
  `  ).run(
    state.trim().toUpperCase(),
    normalizeEnrollmentNumber(enrollmentNumber),
    userId,
  );

  return getLawyerProfile(userId);
}

function markDocumentsStepComplete(userId) {
  const docs = getLawyerDocuments(userId);
  const uploadedTypes = new Set(docs.map((doc) => doc.doc_type));
  const missing = REQUIRED_DOC_TYPES.filter((type) => !uploadedTypes.has(type));

  if (missing.length > 0) {
    const error = new Error(`Missing documents: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }

  db.prepare(`
    UPDATE lawyer_profiles
    SET onboarding_step = 'availability', updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);

  return getLawyerProfile(userId);
}

function upsertLawyerDocument(userId, docType, fileMeta) {
  if (!DOC_TYPES.includes(docType)) {
    const error = new Error('Invalid document type');
    error.status = 400;
    throw error;
  }

  db.prepare(`
    INSERT INTO lawyer_documents (user_id, doc_type, file_name, file_path, mime_type)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, doc_type) DO UPDATE SET
      file_name = excluded.file_name,
      file_path = excluded.file_path,
      mime_type = excluded.mime_type,
      uploaded_at = datetime('now')
  `).run(
    userId,
    docType,
    fileMeta.originalName,
    fileMeta.filePath,
    fileMeta.mimeType || null,
  );

  return getLawyerDocuments(userId);
}

function saveLawyerAvailability(userId, payload) {
  ensureLawyerProfile(userId);

  const selectedDays = normalizeSelectedDays(payload);
  if (selectedDays.length === 0) {
    const error = new Error('Select at least one working day');
    error.status = 400;
    throw error;
  }

  const repeatWeekly = payload.repeatWeekly
    ? true
    : selectedDays.length === ALL_WEEK_DAYS.length;

  db.prepare(`
    INSERT INTO lawyer_availability (
      user_id, selected_day, selected_days, repeat_weekly, week_start, week_end, from_time, to_time, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      selected_day = excluded.selected_day,
      selected_days = excluded.selected_days,
      repeat_weekly = excluded.repeat_weekly,
      week_start = excluded.week_start,
      week_end = excluded.week_end,
      from_time = excluded.from_time,
      to_time = excluded.to_time,
      updated_at = datetime('now')
  `).run(
    userId,
    selectedDays[0],
    JSON.stringify(selectedDays),
    repeatWeekly ? 1 : 0,
    payload.weekStart || null,
    payload.weekEnd || null,
    payload.fromTime || null,
    payload.toTime || null,
  );

  const profile = getLawyerProfile(userId);
  if (profile.onboarding_step !== 'complete') {
    db.prepare(`
      UPDATE lawyer_profiles
      SET onboarding_step = 'fees', updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
  }

  return getLawyerProfile(userId);
}

function saveLawyerFees(userId, fees) {
  ensureLawyerProfile(userId);
  const profile = getLawyerProfile(userId);
  const isPostOnboarding = profile.onboarding_step === 'complete';

  if (!Array.isArray(fees) || fees.length === 0) {
    const error = new Error('Fees are required');
    error.status = 400;
    throw error;
  }

  const upsert = db.prepare(`
    INSERT INTO lawyer_consultation_fees (
      user_id, fee_type, amount, duration_label, duration_minutes, location, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, fee_type) DO UPDATE SET
      amount = excluded.amount,
      duration_label = excluded.duration_label,
      duration_minutes = excluded.duration_minutes,
      location = excluded.location,
      updated_at = datetime('now')
  `);

  const providedTypes = new Set();

  for (const fee of fees) {
    const feeType = fee.feeType || fee.fee_type;
    if (!FEE_TYPES.includes(feeType)) {
      const error = new Error(`Invalid fee type: ${feeType}`);
      error.status = 400;
      throw error;
    }

    providedTypes.add(feeType);
    upsert.run(
      userId,
      feeType,
      String(fee.amount ?? '').trim(),
      fee.durationLabel || fee.duration_label || null,
      Number(fee.durationMinutes ?? fee.duration_minutes) || 0,
      fee.location || null,
    );
  }

  const missing = FEE_TYPES.filter((type) => !providedTypes.has(type));
  if (missing.length > 0) {
    const error = new Error(`Missing fee types: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }

  if (isPostOnboarding) {
    db.prepare(`
      UPDATE lawyer_profiles
      SET updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
  } else {
    const latestProfile = getLawyerProfile(userId);
    const verificationStatus = latestProfile.bar_enrollment_verified ? 'approved' : 'pending';

    db.prepare(`
      UPDATE lawyer_profiles
      SET onboarding_step = 'complete',
          verification_status = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(verificationStatus, userId);
  }

  return getLawyerProfile(userId);
}

function listLawyersForAdmin({ status, search, barUnverified = false }) {
  let query = `
    SELECT
      u.id,
      u.phone,
      lp.full_name,
      lp.practice_areas,
      lp.experience_years,
      lp.onboarding_step,
      lp.verification_status,
      lp.rejection_reason,
      lp.bar_enrollment_number,
      lp.bar_enrollment_verified,
      lp.bar_manual_review,
      lp.bar_verified_name,
      lp.created_at,
      lp.updated_at
    FROM users u
    INNER JOIN lawyer_profiles lp ON lp.user_id = u.id
    WHERE u.role = 'lawyer'
  `;

  const params = [];

  if (status) {
    query += ' AND lp.verification_status = ?';
    params.push(status);
  }

  if (barUnverified) {
    query += ' AND (lp.bar_enrollment_verified = 0 OR lp.bar_enrollment_verified IS NULL)';
  }

  if (search) {
    query += ' AND (u.phone LIKE ? OR lp.full_name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }

  query += ' ORDER BY lp.updated_at DESC';

  return db.prepare(query).all(...params);
}

function getLawyerDetailForAdmin(userId) {
  const user = db
    .prepare(`
      SELECT u.id, u.phone, u.created_at,
        lp.full_name, lp.practice_areas, lp.experience_years, lp.bio, lp.location,
        lp.onboarding_step, lp.verification_status, lp.rejection_reason,
        lp.bar_state, lp.bar_enrollment_number, lp.bar_enrollment_verified,
        lp.bar_verified_name, lp.bar_verified_at, lp.bar_cop_number,
        lp.bar_verified_address, lp.bar_verified_enrollment_date,
        lp.bar_manual_review, lp.bar_name_matched,
        lp.created_at AS profile_created_at, lp.updated_at AS profile_updated_at
      FROM users u
      INNER JOIN lawyer_profiles lp ON lp.user_id = u.id
      WHERE u.id = ? AND u.role = 'lawyer'
    `)
    .get(userId);

  if (!user) {
    return null;
  }

  return {
    ...user,
    documents: getLawyerDocuments(userId),
    availability: getLawyerAvailability(userId),
    fees: getLawyerFees(userId),
  };
}

function updateLawyerVerification(userId, status, rejectionReason) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    const error = new Error('Invalid verification status');
    error.status = 400;
    throw error;
  }

  db.prepare(`
    UPDATE lawyer_profiles
    SET verification_status = ?, rejection_reason = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(status, rejectionReason || null, userId);

  return getLawyerDetailForAdmin(userId);
}

async function adminVerifyBarFromPortal(userId, enrollmentNumber, fullName) {
  const { verifyUpEnrollment } = require('./barCouncil/upBarCouncil.service');
  const result = await verifyUpEnrollment(enrollmentNumber, fullName);

  saveBarVerification(userId, result);

  return {
    result,
    lawyer: getLawyerDetailForAdmin(userId),
  };
}

function adminApproveBarCouncil(userId, payload = {}) {
  ensureLawyerProfile(userId);

  if (payload.enrollmentNumber?.trim()) {
    assertEnrollmentAvailable(payload.enrollmentNumber, userId);
  }

  db.prepare(`
    UPDATE lawyer_profiles
    SET bar_state = COALESCE(?, bar_state, 'UP'),
        bar_enrollment_number = COALESCE(?, bar_enrollment_number),
        bar_enrollment_verified = 1,
        bar_manual_review = 0,
        bar_verified_name = COALESCE(?, bar_verified_name, full_name),
        bar_verified_at = datetime('now'),
        bar_name_matched = 1,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    payload.state || 'UP',
    payload.enrollmentNumber || null,
    payload.advocateName || null,
    userId,
  );

  return getLawyerDetailForAdmin(userId);
}

module.exports = {
  DOC_TYPES,
  REQUIRED_DOC_TYPES,
  FEE_TYPES,
  getUserByPhoneAndRole,
  createUser,
  ensureLawyerProfile,
  getLawyerProfile,
  getLawyerDocuments,
  getLawyerAvailability,
  getLawyerFees,
  resolveLawyerNextRoute,
  buildLawyerAuthPayload,
  saveLawyerDetails,
  saveBarVerification,
  saveBarEnrollmentDraft,
  findLawyerByEnrollment,
  assertEnrollmentAvailable,
  normalizeEnrollmentNumber,
  markDocumentsStepComplete,
  upsertLawyerDocument,
  saveLawyerAvailability,
  saveLawyerFees,
  listLawyersForAdmin,
  getLawyerDetailForAdmin,
  updateLawyerVerification,
  adminVerifyBarFromPortal,
  adminApproveBarCouncil,
};
