const db = require('../db');

function ensureUserProfile(userId) {
  const existing = db
    .prepare('SELECT * FROM user_profiles WHERE user_id = ?')
    .get(userId);

  if (existing) {
    return existing;
  }

  db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
}

function getUserProfile(userId) {
  return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
}

function buildUserAuthPayload(user) {
  const profile = ensureUserProfile(user.id);
  const isProfileComplete = Boolean(profile.profile_complete);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      role: user.role,
    },
    profile: {
      fullName: profile.full_name,
      location: profile.location,
      email: profile.email,
      language: profile.language,
      isProfileComplete,
    },
    nextRoute: isProfileComplete ? 'home' : 'create_account',
  };
}

function saveUserProfile(userId, payload) {
  ensureUserProfile(userId);

  db.prepare(`
    UPDATE user_profiles
    SET full_name = ?, location = ?, email = ?, language = ?,
        profile_complete = 1, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    payload.fullName?.trim() || null,
    payload.location?.trim() || null,
    payload.email?.trim() || null,
    payload.language?.trim() || null,
    userId,
  );

  return getUserProfile(userId);
}

module.exports = {
  ensureUserProfile,
  getUserProfile,
  buildUserAuthPayload,
  saveUserProfile,
};
