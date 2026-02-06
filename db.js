const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'data', 'app.db');

let dbInstance;
let sqlInstance;

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getRunInfo(db) {
  const last = db.exec('SELECT last_insert_rowid() AS id');
  const changes = db.exec('SELECT changes() AS changes');
  const lastId = last && last[0] && last[0].values && last[0].values[0]
    ? last[0].values[0][0]
    : null;
  const changesCount = changes && changes[0] && changes[0].values && changes[0].values[0]
    ? changes[0].values[0][0]
    : 0;
  return { lastInsertRowid: lastId, changes: changesCount };
}

function createAdapter(db) {
  let inTransaction = false;

  function persist() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  function normalizeParams(args) {
    if (!args || args.length === 0) return null;
    if (args.length === 1) {
      const value = args[0];
      if (Array.isArray(value) || (value && typeof value === 'object')) return value;
      return [value];
    }
    return Array.from(args);
  }

  function exec(sql) {
    db.exec(sql);
    if (!inTransaction) {
      persist();
    }
  }

  function prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      get: (...args) => {
        const params = normalizeParams(args);
        if (params) stmt.bind(params);
        if (!stmt.step()) {
          stmt.reset();
          return undefined;
        }
        const row = stmt.getAsObject();
        stmt.reset();
        return row;
      },
      all: (...args) => {
        const params = normalizeParams(args);
        if (params) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.reset();
        return rows;
      },
      run: (...args) => {
        const params = normalizeParams(args);
        if (params) stmt.bind(params);
        stmt.step();
        stmt.reset();
        const info = getRunInfo(db);
        if (!inTransaction) {
          persist();
        }
        return info;
      },
      free: () => {
        stmt.free();
      }
    };
  }

  function transaction(fn) {
    return (...args) => {
      if (inTransaction) {
        return fn(...args);
      }
      inTransaction = true;
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        inTransaction = false;
        persist();
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        inTransaction = false;
        throw err;
      }
    };
  }

  function pragma(value) {
    db.exec(`PRAGMA ${value}`);
  }

  return { exec, prepare, transaction, pragma };
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
  const countRow = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (countRow && countRow.count > 0) return;

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
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  const tx = db.transaction(() => {
    seed.forEach((item, index) => {
      insert.run(item.name, item.slug, now, now, index + 1);
    });
  });
  tx();
}

async function getSql() {
  if (sqlInstance) return sqlInstance;
  const wasmDir = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  sqlInstance = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file)
  });
  return sqlInstance;
}

async function initDb() {
  if (dbInstance) return dbInstance;
  ensureDirExists(path.dirname(DB_PATH));
  const SQL = await getSql();
  let db;
  if (fs.existsSync(DB_PATH)) {
    const file = fs.readFileSync(DB_PATH);
    db = new SQL.Database(file);
  } else {
    db = new SQL.Database();
  }
  const adapter = createAdapter(db);
  adapter.pragma('foreign_keys = ON');
  migrate(adapter);
  seedCategories(adapter);
  dbInstance = adapter;
  return dbInstance;
}

module.exports = {
  initDb,
  DB_PATH
};
