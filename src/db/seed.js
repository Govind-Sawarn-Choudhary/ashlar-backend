function seedMarketplaceData(db) {
  const categoryCount = db
    .prepare('SELECT COUNT(*) AS count FROM document_categories')
    .get().count;

  if (categoryCount === 0) {
    const insertCategory = db.prepare(`
      INSERT INTO document_categories (name, slug, description, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    const categories = [
      ['Property Products', 'property-products', 'Property-related legal documents', 1],
      ['Startup Documents', 'startup-documents', 'Documents for startups and founders', 2],
      ['Agreements & Contracts', 'agreements-contracts', 'Standard agreements and contracts', 3],
      ['Property Documents', 'property-documents', 'Sale deed, lease, and property filings', 4],
      ['Company Formation', 'company-formation', 'Incorporation and compliance documents', 5],
      ['Intellectual Property', 'intellectual-property', 'Trademark, copyright, and IP filings', 6],
      ['Registration & Licenses', 'registration-licenses', 'Business registrations and licenses', 7],
    ];

    for (const row of categories) {
      insertCategory.run(...row);
    }

    const insertProduct = db.prepare(`
      INSERT INTO document_products (category_id, name, description, price, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    const productsByCategory = db
      .prepare('SELECT id, slug FROM document_categories ORDER BY sort_order')
      .all();

    for (const category of productsByCategory) {
      insertProduct.run(
        category.id,
        `${category.slug.replace(/-/g, ' ')} starter pack`,
        'Standard template pack with lawyer review option',
        499,
        1,
      );
      insertProduct.run(
        category.id,
        `${category.slug.replace(/-/g, ' ')} premium pack`,
        'Full document bundle with customization support',
        999,
        2,
      );
    }
  }

  const settingsCount = db
    .prepare('SELECT COUNT(*) AS count FROM platform_settings')
    .get().count;

  if (settingsCount === 0) {
    const insertSetting = db.prepare(`
      INSERT INTO platform_settings (key, value) VALUES (?, ?)
    `);

    insertSetting.run('support_phone', '+91-3333-333-333');
    insertSetting.run('commission_percent', '10');
    insertSetting.run('min_wallet_topup', '100');
    insertSetting.run('min_wallet_withdrawal', '100');
    insertSetting.run('challan_test_otp', '1234');
  }

  const upsertSetting = db.prepare(`
    INSERT INTO platform_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  upsertSetting.run('min_wallet_withdrawal', '100');
}

module.exports = {
  seedMarketplaceData,
};
