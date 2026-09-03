const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { initSchema } = require('./schema');
const { seedMarketplaceData } = require('./seed');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ashlar.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initSchema(db);
seedMarketplaceData(db);

function ensureDefaultAdmin() {
  const existing = db
    .prepare('SELECT id FROM admins WHERE email = ?')
    .get(config.adminEmail);

  if (existing) {
    return;
  }

  const passwordHash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare(
    'INSERT INTO admins (email, password_hash) VALUES (?, ?)',
  ).run(config.adminEmail, passwordHash);

  console.log(`Default admin created: ${config.adminEmail}`);
}

ensureDefaultAdmin();

module.exports = db;
