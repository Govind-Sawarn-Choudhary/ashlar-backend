const db = require('../db');

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

function listNotifications(userId, role) {
  return db
    .prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND role = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 50
    `)
    .all(userId, role)
    .map(mapNotification);
}

function createNotification(userId, role, { title, body }) {
  const result = db.prepare(`
    INSERT INTO notifications (user_id, role, title, body)
    VALUES (?, ?, ?, ?)
  `).run(userId, role, title, body);

  return mapNotification(
    db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid),
  );
}

function markNotificationRead(userId, role, notificationId) {
  db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE id = ? AND user_id = ? AND role = ?
  `).run(notificationId, userId, role);

  const row = db
    .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ? AND role = ?')
    .get(notificationId, userId, role);

  return row ? mapNotification(row) : null;
}

function markAllRead(userId, role) {
  db.prepare(`
    UPDATE notifications SET is_read = 1 WHERE user_id = ? AND role = ?
  `).run(userId, role);

  return { success: true };
}

function seedWelcomeNotification(userId, role) {
  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND role = ?')
    .get(userId, role).count;

  if (existing > 0) {
    return;
  }

  createNotification(userId, role, {
    title: 'Welcome to Ashlar Lawyer Hub',
    body: 'Your account is ready. Explore lawyers, book consultations, and manage your legal matters.',
  });
}

module.exports = {
  listNotifications,
  createNotification,
  markNotificationRead,
  markAllRead,
  seedWelcomeNotification,
};
