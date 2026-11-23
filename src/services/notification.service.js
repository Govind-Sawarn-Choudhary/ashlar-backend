const db = require('../db');
const pushNotificationService = require('./pushNotification.service');

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    category: row.category || 'general',
    actionType: row.action_type || null,
    actionId: row.action_id != null ? Number(row.action_id) : null,
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

function countUnread(userId, role) {
  return db
    .prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND role = ? AND is_read = 0',
    )
    .get(userId, role).count;
}

function createNotification(
  userId,
  role,
  { title, body, category = 'general', actionType = null, actionId = null },
) {
  const result = db.prepare(`
    INSERT INTO notifications (user_id, role, title, body, category, action_type, action_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, role, title, body, category, actionType, actionId);

  const notification = mapNotification(
    db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid),
  );

  void pushNotificationService.sendPushToUser(userId, role, {
    title,
    body,
    data: {
      notificationId: String(notification.id),
      category: notification.category,
      actionType: notification.actionType || '',
      actionId: notification.actionId != null ? String(notification.actionId) : '',
    },
  });

  return notification;
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
    title: role === 'lawyer'
      ? 'Welcome to Ashlar Lawyer Hub'
      : 'Welcome to Ashlar Lawyer Hub',
    body: role === 'lawyer'
      ? 'Your lawyer account is ready. Complete your profile, set fees, and start receiving consultations once approved.'
      : 'Your account is ready. Explore lawyers, book consultations, and manage your legal matters.',
  });
}

module.exports = {
  listNotifications,
  countUnread,
  createNotification,
  markNotificationRead,
  markAllRead,
  seedWelcomeNotification,
};
