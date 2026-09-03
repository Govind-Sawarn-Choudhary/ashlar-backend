const ONBOARDING_STEPS = [
  'details',
  'documents',
  'availability',
  'fees',
  'complete',
];

const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'];

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'lawyer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(phone, role)
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      full_name TEXT,
      location TEXT,
      email TEXT,
      language TEXT,
      profile_complete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lawyer_profiles (
      user_id INTEGER PRIMARY KEY,
      full_name TEXT,
      practice_areas TEXT,
      experience_years TEXT,
      bio TEXT,
      location TEXT,
      onboarding_step TEXT NOT NULL DEFAULT 'details'
        CHECK (onboarding_step IN ('details', 'documents', 'availability', 'fees', 'complete')),
      verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'approved', 'rejected')),
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lawyer_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN (
        'bar_council_certificate',
        'identity_proof',
        'law_degree',
        'passport_photo'
      )),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, doc_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lawyer_availability (
      user_id INTEGER PRIMARY KEY,
      selected_day INTEGER NOT NULL DEFAULT 0,
      repeat_weekly INTEGER NOT NULL DEFAULT 0,
      week_start TEXT,
      week_end TEXT,
      from_time TEXT,
      to_time TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lawyer_consultation_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fee_type TEXT NOT NULL CHECK (fee_type IN ('chat', 'audio', 'video', 'physical')),
      amount TEXT NOT NULL,
      duration_label TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      location TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, fee_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_lawyer_profiles_verification
      ON lawyer_profiles(verification_status);

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'lawyer')),
      balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, role),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
      amount REAL NOT NULL,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL CHECK (payment_type IN ('booking', 'challan', 'wallet_topup')),
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed')),
      reference TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lawyer_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('online', 'offline')),
      consultation_type TEXT NOT NULL CHECK (consultation_type IN ('chat', 'audio', 'video', 'physical')),
      status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
      scheduled_at TEXT,
      amount REAL NOT NULL,
      payment_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lawyer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS favourites (
      user_id INTEGER NOT NULL,
      lawyer_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, lawyer_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lawyer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS document_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS challans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vehicle_number TEXT NOT NULL,
      mobile TEXT,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'settled')),
      payment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS challan_otp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vehicle_number TEXT NOT NULL,
      mobile TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'lawyer')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_lawyer ON appointments(lawyer_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, role);
    CREATE INDEX IF NOT EXISTS idx_challans_user ON challans(user_id);
  `);

  const lawyerProfileColumns = [
    ['bar_state', 'TEXT'],
    ['bar_enrollment_number', 'TEXT'],
    ['bar_enrollment_verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['bar_verified_name', 'TEXT'],
    ['bar_verified_at', 'TEXT'],
    ['bar_cop_number', 'TEXT'],
    ['bar_verified_address', 'TEXT'],
    ['bar_verified_enrollment_date', 'TEXT'],
    ['bar_manual_review', 'INTEGER NOT NULL DEFAULT 0'],
    ['bar_name_matched', 'INTEGER'],
  ];

  for (const [column, definition] of lawyerProfileColumns) {
    try {
      db.exec(`ALTER TABLE lawyer_profiles ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (!String(error.message).includes('duplicate column name')) {
        throw error;
      }
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lawyer_bar_enrollment_unique
      ON lawyer_profiles(bar_enrollment_number)
      WHERE bar_enrollment_number IS NOT NULL AND TRIM(bar_enrollment_number) != '';
  `);

  migratePaymentsTable(db);
}

function migratePaymentsTable(db) {
  const paymentColumns = db.prepare('PRAGMA table_info(payments)').all();
  const columnNames = new Set(paymentColumns.map((column) => column.name));

  if (!columnNames.has('razorpay_order_id')) {
    db.exec('ALTER TABLE payments ADD COLUMN razorpay_order_id TEXT');
  }

  if (!columnNames.has('razorpay_payment_id')) {
    db.exec('ALTER TABLE payments ADD COLUMN razorpay_payment_id TEXT');
  }

  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'")
    .get()?.sql;

  if (tableSql && !tableSql.includes("'document'")) {
    db.exec(`
      CREATE TABLE payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_type TEXT NOT NULL CHECK (payment_type IN ('booking', 'challan', 'wallet_topup', 'document')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'completed', 'failed')),
        reference TEXT NOT NULL,
        metadata TEXT,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO payments_new (
        id, user_id, amount, payment_type, status, reference, metadata,
        razorpay_order_id, razorpay_payment_id, created_at
      )
      SELECT
        id, user_id, amount, payment_type, status, reference, metadata,
        razorpay_order_id, razorpay_payment_id, created_at
      FROM payments;

      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
    `);
  }
}

module.exports = {
  initSchema,
  ONBOARDING_STEPS,
  VERIFICATION_STATUSES,
};
