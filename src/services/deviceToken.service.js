const db = require('../db');

function upsertToken(userId, role, token, platform = 'android') {
  const normalized = String(token || '').trim();
  if (!normalized) {
    const error = new Error('Device token is required');
    error.status = 400;
    throw error;
  }

  db.prepare(`
    INSERT INTO device_push_tokens (user_id, role, token, platform, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      role = excluded.role,
      platform = excluded.platform,
      updated_at = datetime('now')
  `).run(userId, role, normalized, platform);
}

function listTokens(userId, role) {
  return db
    .prepare(
      'SELECT token FROM device_push_tokens WHERE user_id = ? AND role = ? ORDER BY datetime(updated_at) DESC',
    )
    .all(userId, role);
}

function removeTokens(tokens) {
  if (!tokens || tokens.length === 0) {
    return;
  }
  const remove = db.prepare('DELETE FROM device_push_tokens WHERE token = ?');
  for (const token of tokens) {
    remove.run(token);
  }
}

module.exports = {
  upsertToken,
  listTokens,
  removeTokens,
};