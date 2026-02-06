const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Papa = require('papaparse');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// App root is the deploy root; static assets live in /public
const APP_ROOT = process.env.APP_ROOT || __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const uploadsDir = path.join(APP_ROOT, 'uploads');
const dataDir = path.join(APP_ROOT, 'data');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Sessions
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Set it in Hostinger environment variables.');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Ensure directories exist
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
} catch (err) {
  console.error('Failed to create data/uploads directories:', err);
}

// Database init (async)
let db;

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function resolveUploadPath(urlPath) {
  const clean = (urlPath || '').replace(/^\/+/, '');
  return path.join(APP_ROOT, clean);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function slugify(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toProductResponse(row) {
  return {
    id: String(row.id),
    title: row.title,
    shortDesc: row.short_desc || '',
    description: row.description || '',
    image: row.image || '',
    categoryId: row.category_id || null,
    category: row.category_id ? {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug
    } : null,
    status: row.status,
    lowStockThreshold: row.low_stock_threshold,
    pricing: safeJsonParse(row.pricing_json, []),
    priceMin: row.price_min !== undefined ? row.price_min : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toVariantResponse(row) {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    sku: row.sku || '',
    attributes: safeJsonParse(row.attributes_json, {}),
    price: row.price,
    stockQty: row.stock_qty,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function logAudit(adminId, action, entity, entityId, details) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_log (admin_id, action, entity, entity_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      adminId || null,
      action,
      entity,
      entityId ? String(entityId) : null,
      details ? JSON.stringify(details) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
  if (count > 0) return;

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    console.warn('ADMIN_EMAIL or ADMIN_PASSWORD not set. Admin login will not be available until set.');
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO admins (email, password_hash, name, role, created_at)
    VALUES (?, ?, ?, 'admin', ?)
  `).run(email, hash, name, new Date().toISOString());
  console.log('Bootstrap admin created:', email);
}

async function startServer() {
  try {
    db = await initDb();
    ensureBootstrapAdmin();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
      console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

function getAdminById(id) {
  return db.prepare('SELECT id, email, name, role, created_at FROM admins WHERE id = ?').get(id);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    req.admin = getAdminById(req.session.adminId);
    if (!req.admin) {
      req.session.destroy(() => {});
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    return next();
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  if (req.accepts('html')) {
    return res.redirect('/admin/login');
  }
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Admin auth routes
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const ok = bcrypt.compareSync(password, admin.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  req.session.adminId = admin.id;
  logAudit(admin.id, 'login', 'admin', admin.id, { email: admin.email });
  return res.json({ success: true, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const adminId = req.session.adminId;
  req.session.destroy(() => {
    logAudit(adminId, 'logout', 'admin', adminId, null);
    res.json({ success: true });
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// Admin UI routes (protected)
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product', 'product_cms.html'));
});

app.get('/product/product_cms.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product', 'product_cms.html'));
});

// Serve static files
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(uploadsDir));

// Public API routes
app.get('/api/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT id, name, slug, description, banner_title, banner_subtitle, banner_cta_text, banner_cta_url, sort_order, is_active
    FROM categories WHERE is_active = 1 ORDER BY sort_order, name
  `).all();
  res.json({ success: true, categories });
});

app.get('/api/categories/:slug/products', (req, res) => {
  const slug = req.params.slug;
  const category = db.prepare('SELECT * FROM categories WHERE slug = ? AND is_active = 1').get(slug);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.price IS NOT NULL) AS price_min
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.status = 'published' AND p.category_id = ?
    ORDER BY p.created_at DESC
  `).all(category.id);

  const products = rows.map(toProductResponse);
  res.json({ success: true, category, products });
});

app.get('/api/products', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.price IS NOT NULL) AS price_min
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.status = 'published'
    ORDER BY p.created_at DESC
  `).all();
  const products = rows.map(toProductResponse);
  res.json({ success: true, products });
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.price IS NOT NULL) AS price_min
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ? AND p.status = 'published'
  `).get(req.params.id);

  if (!row) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ? AND is_active = 1').all(row.id);
  const product = toProductResponse(row);
  product.variants = variants.map(toVariantResponse);

  res.json({ success: true, product });
});

// Admin API routes
app.use('/api/admin', requireAdmin);

app.get('/api/admin/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT * FROM categories ORDER BY sort_order, name
  `).all();
  res.json({ success: true, categories });
});

app.post('/api/admin/categories', (req, res) => {
  const payload = req.body || {};
  const name = (payload.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Category name is required.' });
  }

  const slug = payload.slug ? slugify(payload.slug) : slugify(name);
  const now = new Date().toISOString();
  try {
    const stmt = db.prepare(`
      INSERT INTO categories (name, slug, description, banner_title, banner_subtitle, banner_cta_text, banner_cta_url, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      name,
      slug,
      payload.description || '',
      payload.banner_title || '',
      payload.banner_subtitle || '',
      payload.banner_cta_text || '',
      payload.banner_cta_url || '',
      Number(payload.sort_order) || 0,
      payload.is_active === false || payload.is_active === 'false' ? 0 : 1,
      now,
      now
    );
    logAudit(req.admin.id, 'create', 'category', info.lastInsertRowid, { name, slug });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/categories/:id', (req, res) => {
  const payload = req.body || {};
  const id = req.params.id;
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!current) {
    return res.status(404).json({ success: false, message: 'Category not found.' });
  }
  const name = payload.name ? payload.name.trim() : current.name;
  const slug = payload.slug ? slugify(payload.slug) : current.slug;
  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE categories
      SET name = ?, slug = ?, description = ?, banner_title = ?, banner_subtitle = ?, banner_cta_text = ?, banner_cta_url = ?,
          sort_order = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      slug,
      payload.description ?? current.description,
      payload.banner_title ?? current.banner_title,
      payload.banner_subtitle ?? current.banner_subtitle,
      payload.banner_cta_text ?? current.banner_cta_text,
      payload.banner_cta_url ?? current.banner_cta_url,
      payload.sort_order !== undefined ? Number(payload.sort_order) : current.sort_order,
      payload.is_active === false || payload.is_active === 'false' ? 0 : 1,
      now,
      id
    );
    logAudit(req.admin.id, 'update', 'category', id, { name, slug });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/categories/:id', (req, res) => {
  const id = req.params.id;
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found.' });
  }
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  logAudit(req.admin.id, 'delete', 'category', id, { name: category.name });
  res.json({ success: true });
});

app.get('/api/admin/products', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id) AS variant_count,
      (SELECT COALESCE(SUM(stock_qty),0) FROM variants v WHERE v.product_id = p.id) AS stock_total
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY p.created_at DESC
  `).all();
  const products = rows.map(row => ({
    ...toProductResponse(row),
    variantCount: row.variant_count,
    stockTotal: row.stock_total
  }));
  res.json({ success: true, products });
});

app.get('/api/admin/products/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!row) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ?').all(row.id);
  const product = toProductResponse(row);
  product.variants = variants.map(toVariantResponse);

  res.json({ success: true, product });
});

app.post('/api/admin/products', upload.single('image'), (req, res) => {
  try {
    const { title, shortDesc, description, categoryId, status, pricing, variants, lowStockThreshold } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Product image is required' });
    }

    const now = new Date().toISOString();
    const pricingJson = pricing ? JSON.stringify(safeJsonParse(pricing, [])) : null;
    const variantList = variants ? safeJsonParse(variants, []) : [];

    const insertProduct = db.prepare(`
      INSERT INTO products (title, short_desc, description, image, category_id, status, low_stock_threshold, pricing_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVariant = db.prepare(`
      INSERT INTO variants (product_id, sku, attributes_json, price, stock_qty, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const info = insertProduct.run(
        title.trim(),
        shortDesc ? shortDesc.trim() : '',
        description.trim(),
        `/uploads/${req.file.filename}`,
        categoryId ? Number(categoryId) : null,
        status || 'draft',
        lowStockThreshold ? Number(lowStockThreshold) : null,
        pricingJson,
        now,
        now
      );

      const productId = info.lastInsertRowid;
      if (Array.isArray(variantList)) {
        variantList.forEach(variant => {
          insertVariant.run(
            productId,
            variant.sku || null,
            JSON.stringify(variant.attributes || {}),
            variant.price !== undefined && variant.price !== '' ? Number(variant.price) : null,
            Number(variant.stockQty) || 0,
            variant.isActive === false ? 0 : 1,
            now,
            now
          );
        });
      }
      return productId;
    });

    const productId = tx();
    logAudit(req.admin.id, 'create', 'product', productId, { title });
    res.json({ success: true, id: productId });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: 'Error creating product' });
  }
});

app.put('/api/admin/products/:id', upload.single('image'), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { title, shortDesc, description, categoryId, status, pricing, variants, lowStockThreshold } = req.body;
    const now = new Date().toISOString();
    const pricingJson = pricing ? JSON.stringify(safeJsonParse(pricing, [])) : existing.pricing_json;
    const variantList = variants ? safeJsonParse(variants, []) : null;

    let imagePath = existing.image;
    if (req.file) {
      // Delete old image if exists
      const oldImagePath = resolveUploadPath(existing.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      imagePath = `/uploads/${req.file.filename}`;
    }

    const updateProduct = db.prepare(`
      UPDATE products
      SET title = ?, short_desc = ?, description = ?, image = ?, category_id = ?, status = ?, low_stock_threshold = ?, pricing_json = ?, updated_at = ?
      WHERE id = ?
    `);

    const insertVariant = db.prepare(`
      INSERT INTO variants (product_id, sku, attributes_json, price, stock_qty, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      updateProduct.run(
        title ? title.trim() : existing.title,
        shortDesc !== undefined ? shortDesc.trim() : existing.short_desc,
        description ? description.trim() : existing.description,
        imagePath,
        categoryId ? Number(categoryId) : null,
        status || existing.status,
        lowStockThreshold !== undefined && lowStockThreshold !== '' ? Number(lowStockThreshold) : existing.low_stock_threshold,
        pricingJson,
        now,
        id
      );

      if (Array.isArray(variantList)) {
        db.prepare('DELETE FROM variants WHERE product_id = ?').run(id);
        variantList.forEach(variant => {
          insertVariant.run(
            id,
            variant.sku || null,
            JSON.stringify(variant.attributes || {}),
            variant.price !== undefined && variant.price !== '' ? Number(variant.price) : null,
            Number(variant.stockQty) || 0,
            variant.isActive === false ? 0 : 1,
            now,
            now
          );
        });
      }
    });

    tx();
    logAudit(req.admin.id, 'update', 'product', id, { title: title || existing.title });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: 'Error updating product' });
  }
});

app.post('/api/admin/products/:id/publish', (req, res) => {
  const id = req.params.id;
  const { status } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }
  const newStatus = status === 'published' ? 'published' : 'draft';
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?')
    .run(newStatus, new Date().toISOString(), id);
  logAudit(req.admin.id, 'publish', 'product', id, { status: newStatus });
  res.json({ success: true, status: newStatus });
});

app.delete('/api/admin/products/:id', (req, res) => {
  try {
    const id = req.params.id;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product.image) {
      const imagePath = resolveUploadPath(product.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    logAudit(req.admin.id, 'delete', 'product', id, { title: product.title });
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Error deleting product' });
  }
});

app.get('/api/admin/variants', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, p.title AS product_title, p.low_stock_threshold
    FROM variants v
    JOIN products p ON v.product_id = p.id
    ORDER BY p.title, v.id
  `).all();
  const variants = rows.map(row => ({
    ...toVariantResponse(row),
    productTitle: row.product_title,
    lowStockThreshold: row.low_stock_threshold
  }));
  res.json({ success: true, variants });
});

app.post('/api/admin/variants', (req, res) => {
  const { productId, sku, attributes, price, stockQty, isActive } = req.body || {};
  if (!productId) {
    return res.status(400).json({ success: false, message: 'Product ID is required.' });
  }
  const now = new Date().toISOString();
  try {
    const info = db.prepare(`
      INSERT INTO variants (product_id, sku, attributes_json, price, stock_qty, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(productId),
      sku || null,
      JSON.stringify(attributes || {}),
      price !== undefined && price !== '' ? Number(price) : null,
      Number(stockQty) || 0,
      isActive === false ? 0 : 1,
      now,
      now
    );
    logAudit(req.admin.id, 'create', 'variant', info.lastInsertRowid, { productId });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/variants/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Variant not found' });
  }
  const payload = req.body || {};
  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE variants
      SET sku = ?, attributes_json = ?, price = ?, stock_qty = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.sku ?? existing.sku,
      JSON.stringify(payload.attributes || safeJsonParse(existing.attributes_json, {})),
      payload.price !== undefined && payload.price !== '' ? Number(payload.price) : existing.price,
      payload.stockQty !== undefined ? Number(payload.stockQty) : existing.stock_qty,
      payload.isActive === false ? 0 : 1,
      now,
      id
    );
    logAudit(req.admin.id, 'update', 'variant', id, { sku: payload.sku });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/variants/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Variant not found' });
  }
  db.prepare('DELETE FROM variants WHERE id = ?').run(id);
  logAudit(req.admin.id, 'delete', 'variant', id, { sku: existing.sku });
  res.json({ success: true });
});

app.post('/api/admin/variants/:id/adjust-stock', (req, res) => {
  const id = req.params.id;
  const { delta, reason } = req.body || {};
  const deltaQty = Number(delta);
  if (Number.isNaN(deltaQty) || deltaQty === 0) {
    return res.status(400).json({ success: false, message: 'Delta quantity is required.' });
  }

  const variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(id);
  if (!variant) {
    return res.status(404).json({ success: false, message: 'Variant not found' });
  }

  const newQty = Math.max(0, (variant.stock_qty || 0) + deltaQty);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare('UPDATE variants SET stock_qty = ?, updated_at = ? WHERE id = ?')
      .run(newQty, now, id);
    db.prepare(`
      INSERT INTO inventory_adjustments (variant_id, delta_qty, reason, performed_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, deltaQty, reason || '', req.admin.id, now);
  });
  tx();
  logAudit(req.admin.id, 'adjust_stock', 'variant', id, { delta: deltaQty, reason });
  res.json({ success: true, stockQty: newQty });
});

app.get('/api/admin/inventory-adjustments', (req, res) => {
  const rows = db.prepare(`
    SELECT ia.*, v.sku, p.title AS product_title
    FROM inventory_adjustments ia
    JOIN variants v ON ia.variant_id = v.id
    JOIN products p ON v.product_id = p.id
    ORDER BY ia.created_at DESC
    LIMIT 200
  `).all();
  res.json({ success: true, adjustments: rows });
});

app.get('/api/admin/audit', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, ad.email AS admin_email
    FROM audit_log a
    LEFT JOIN admins ad ON a.admin_id = ad.id
    ORDER BY a.created_at DESC
    LIMIT 200
  `).all();
  res.json({ success: true, entries: rows });
});

app.get('/api/admin/admins', (req, res) => {
  const admins = db.prepare('SELECT id, email, name, role, created_at FROM admins ORDER BY created_at DESC').all();
  res.json({ success: true, admins });
});

app.post('/api/admin/admins', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare(`
      INSERT INTO admins (email, password_hash, name, role, created_at)
      VALUES (?, ?, ?, 'admin', ?)
    `).run(email, hash, name || '', new Date().toISOString());
    logAudit(req.admin.id, 'create', 'admin', info.lastInsertRowid, { email });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/admins/:id', (req, res) => {
  const id = req.params.id;
  if (String(req.admin.id) === String(id)) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  logAudit(req.admin.id, 'delete', 'admin', id, null);
  res.json({ success: true });
});

app.get('/api/admin/export', (req, res) => {
  const format = (req.query.format || 'json').toLowerCase();
  const type = (req.query.type || 'full').toLowerCase();

  const categories = db.prepare('SELECT * FROM categories').all();
  const products = db.prepare('SELECT * FROM products').all();
  const variants = db.prepare('SELECT * FROM variants').all();
  const inventory = db.prepare('SELECT * FROM inventory_adjustments').all();

  if (format === 'csv') {
    let rows = [];
    if (type === 'products') {
      rows = products.map(p => ({
        id: p.id,
        title: p.title,
        short_desc: p.short_desc,
        description: p.description,
        image: p.image,
        category_id: p.category_id,
        status: p.status,
        low_stock_threshold: p.low_stock_threshold,
        pricing_json: p.pricing_json
      }));
    } else if (type === 'variants') {
      rows = variants.map(v => ({
        id: v.id,
        product_id: v.product_id,
        sku: v.sku,
        attributes_json: v.attributes_json,
        price: v.price,
        stock_qty: v.stock_qty,
        is_active: v.is_active
      }));
    } else if (type === 'inventory') {
      rows = inventory.map(i => ({
        id: i.id,
        variant_id: i.variant_id,
        delta_qty: i.delta_qty,
        reason: i.reason,
        performed_by: i.performed_by,
        created_at: i.created_at
      }));
    } else {
      rows = categories.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        banner_title: c.banner_title,
        banner_subtitle: c.banner_subtitle,
        banner_cta_text: c.banner_cta_text,
        banner_cta_url: c.banner_cta_url,
        sort_order: c.sort_order,
        is_active: c.is_active
      }));
    }

    const csv = Papa.unparse(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=export-${type}.csv`);
    return res.send(csv);
  }

  const data = { categories, products, variants, inventory };
  res.json({ success: true, data });
});

app.post('/api/admin/import', importUpload.single('file'), (req, res) => {
  const format = (req.query.format || 'json').toLowerCase();
  const type = (req.query.type || 'products').toLowerCase();

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Import file is required.' });
  }

  const raw = req.file.buffer.toString('utf-8');
  const now = new Date().toISOString();

  try {
    if (format === 'csv') {
      const parsed = Papa.parse(raw, { header: true });
      if (parsed.errors && parsed.errors.length) {
        return res.status(400).json({ success: false, message: parsed.errors[0].message });
      }
      const rows = parsed.data || [];

      if (type === 'products') {
        const insert = db.prepare(`
          INSERT INTO products (title, short_desc, description, image, category_id, status, low_stock_threshold, pricing_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const categoryMap = db.prepare('SELECT id, slug FROM categories').all();
        const slugToId = new Map(categoryMap.map(c => [c.slug, c.id]));

        const tx = db.transaction(() => {
          rows.forEach(row => {
            if (!row.title) return;
            const catId = row.category_slug ? slugToId.get(row.category_slug) : null;
            insert.run(
              row.title,
              row.short_desc || '',
              row.description || '',
              row.image || '',
              catId || null,
              row.status || 'draft',
              row.low_stock_threshold ? Number(row.low_stock_threshold) : null,
              row.pricing_json || null,
              now,
              now
            );
          });
        });
        tx();
        logAudit(req.admin.id, 'import', 'product', null, { format: 'csv' });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, message: 'CSV import supports products only.' });
    }

    const data = JSON.parse(raw);
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const products = Array.isArray(data.products) ? data.products : [];
    const variants = Array.isArray(data.variants) ? data.variants : [];

    const categoryIdMap = new Map();
    const productIdMap = new Map();

    const tx = db.transaction(() => {
      const insertCategory = db.prepare(`
        INSERT INTO categories (name, slug, description, banner_title, banner_subtitle, banner_cta_text, banner_cta_url, sort_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      categories.forEach(cat => {
        if (!cat.name || !cat.slug) return;
        const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(cat.slug);
        if (existing) {
          categoryIdMap.set(cat.id, existing.id);
          return;
        }
        const info = insertCategory.run(
          cat.name,
          cat.slug,
          cat.description || '',
          cat.banner_title || '',
          cat.banner_subtitle || '',
          cat.banner_cta_text || '',
          cat.banner_cta_url || '',
          Number(cat.sort_order) || 0,
          cat.is_active === 0 ? 0 : 1,
          now,
          now
        );
        categoryIdMap.set(cat.id, info.lastInsertRowid);
      });

      const insertProduct = db.prepare(`
        INSERT INTO products (title, short_desc, description, image, category_id, status, low_stock_threshold, pricing_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      products.forEach(prod => {
        if (!prod.title) return;
        const catId = prod.category_id ? categoryIdMap.get(prod.category_id) : null;
        const info = insertProduct.run(
          prod.title,
          prod.short_desc || '',
          prod.description || '',
          prod.image || '',
          catId || null,
          prod.status || 'draft',
          prod.low_stock_threshold ? Number(prod.low_stock_threshold) : null,
          prod.pricing_json || null,
          now,
          now
        );
        productIdMap.set(prod.id, info.lastInsertRowid);
      });

      const insertVariant = db.prepare(`
        INSERT INTO variants (product_id, sku, attributes_json, price, stock_qty, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      variants.forEach(variant => {
        const newProductId = productIdMap.get(variant.product_id);
        if (!newProductId) return;
        insertVariant.run(
          newProductId,
          variant.sku || null,
          variant.attributes_json || JSON.stringify(variant.attributes || {}),
          variant.price !== undefined && variant.price !== '' ? Number(variant.price) : null,
          Number(variant.stock_qty || variant.stockQty || 0),
          variant.is_active === 0 ? 0 : 1,
          now,
          now
        );
      });
    });

    tx();
    logAudit(req.admin.id, 'import', 'database', null, { format: 'json' });
    res.json({ success: true });
  } catch (err) {
    console.error('Import error:', err);
    res.status(400).json({ success: false, message: 'Invalid import file.' });
  }
});

// Frontend routes
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/product/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product', 'detail.html'));
});

// Basic health check
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Start server
startServer();
