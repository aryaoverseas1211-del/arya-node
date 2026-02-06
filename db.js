const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'public_html', 'data', 'app.db');

let dbInstance;

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      banner_title TEXT,
      banner_subtitle TEXT,
      banner_cta_text TEXT,
      banner_cta_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      short_desc TEXT,
      description TEXT,
      image TEXT,
      category_id INTEGER,
      status TEXT DEFAULT 'draft',
      low_stock_threshold INTEGER,
      pricing_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      sku TEXT UNIQUE,
      attributes_json TEXT,
      price REAL,
      stock_qty INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      delta_qty INTEGER NOT NULL,
      reason TEXT,
      performed_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
      FOREIGN KEY (performed_by) REFERENCES admins(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory_adjustments(variant_id);
    CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log(admin_id);
  `);
}

function seedCategories(db) {
  const count = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (count > 0) return;

  const now = new Date().toISOString();
  const seed = [
    { name: 'Lamination', slug: 'lamination' },
    { name: 'Binding', slug: 'binding' },
    { name: 'Files & Folders', slug: 'files-folders' },
    { name: 'ID Card & Lanyards', slug: 'id-cards-lanyards' },
    { name: 'ID Cards', slug: 'id-card' },
    { name: 'Photo Media & Inks', slug: 'photo-media-inks' },
    { name: 'Printing Supplies', slug: 'printing-supplies' },
    { name: 'School Stationery', slug: 'school-stationery' },
    { name: 'Sublimation', slug: 'sublimation' },
    { name: 'Note Counting', slug: 'note-counting' },
    { name: 'Corporate Gifting', slug: 'corporate-gifting' }
  ];

  const insert = db.prepare(`
    INSERT INTO categories (name, slug, created_at, updated_at, is_active, sort_order)
    VALUES (@name, @slug, @created_at, @updated_at, 1, @sort_order)
  `);
  const tx = db.transaction(() => {
    seed.forEach((item, index) => {
      insert.run({
        name: item.name,
        slug: item.slug,
        created_at: now,
        updated_at: now,
        sort_order: index + 1
      });
    });
  });
  tx();
}

function initDb() {
  if (dbInstance) return dbInstance;
  ensureDirExists(path.dirname(DB_PATH));
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('foreign_keys = ON');
  migrate(dbInstance);
  seedCategories(dbInstance);
  return dbInstance;
}

module.exports = {
  initDb,
  DB_PATH
};
