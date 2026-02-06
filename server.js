const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Repo root is the app root; static assets live in public_html/public
const APP_ROOT = process.env.APP_ROOT || __dirname;
const PUBLIC_HTML_DIR = path.join(APP_ROOT, 'public_html');
const PUBLIC_DIR = path.join(PUBLIC_HTML_DIR, 'public');
const uploadsDir = path.join(PUBLIC_HTML_DIR, 'uploads');
const dataDir = path.join(PUBLIC_HTML_DIR, 'data');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Ensure directories exist
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
} catch (err) {
  console.error('Failed to create data/uploads directories:', err);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
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

// Data file path
const productsFile = path.join(dataDir, 'products.json');

function resolveUploadPath(urlPath) {
  const clean = (urlPath || '').replace(/^\/+/, '');
  return path.join(PUBLIC_HTML_DIR, clean);
}

// Helper functions
function readProducts() {
  try {
    if (fs.existsSync(productsFile)) {
      const data = fs.readFileSync(productsFile, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading products:', error);
    return [];
  }
}

function writeProducts(products) {
  try {
    fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing products:', error);
    return false;
  }
}

// API Routes

// Get all products
app.get('/api/products', (req, res) => {
  const products = readProducts();
  res.json({ success: true, products });
});

// Get single product by ID
app.get('/api/products/:id', (req, res) => {
  const products = readProducts();
  const product = products.find(p => p.id === req.params.id);
  if (product) {
    res.json({ success: true, product });
  } else {
    res.status(404).json({ success: false, message: 'Product not found' });
  }
});

// Create new product
app.post('/api/products', upload.single('image'), (req, res) => {
  try {
    const { title, shortDesc, description, pricing } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Product image is required' });
    }

    let pricingTiers = [];
    try {
      pricingTiers = JSON.parse(pricing || '[]');
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid pricing data' });
    }

    if (pricingTiers.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one pricing tier is required' });
    }

    const products = readProducts();
    const newProduct = {
      id: Date.now().toString(),
      title: title.trim(),
      shortDesc: shortDesc ? shortDesc.trim() : '',
      description: description.trim(),
      image: `/uploads/${req.file.filename}`,
      pricing: pricingTiers,
      createdAt: new Date().toISOString()
    };

    products.push(newProduct);
    writeProducts(products);

    res.json({ success: true, product: newProduct });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: 'Error creating product' });
  }
});

// Update product
app.put('/api/products/:id', upload.single('image'), (req, res) => {
  try {
    const products = readProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { title, shortDesc, description, pricing } = req.body;
    let pricingTiers = [];
    try {
      pricingTiers = JSON.parse(pricing || '[]');
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid pricing data' });
    }

    const updatedProduct = {
      ...products[index],
      title: title ? title.trim() : products[index].title,
      shortDesc: shortDesc !== undefined ? shortDesc.trim() : products[index].shortDesc,
      description: description ? description.trim() : products[index].description,
      pricing: pricingTiers.length > 0 ? pricingTiers : products[index].pricing,
      updatedAt: new Date().toISOString()
    };

    if (req.file) {
      // Delete old image if exists
      const oldImagePath = resolveUploadPath(products[index].image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      updatedProduct.image = `/uploads/${req.file.filename}`;
    }

    products[index] = updatedProduct;
    writeProducts(products);

    res.json({ success: true, product: updatedProduct });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: 'Error updating product' });
  }
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
  try {
    const products = readProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Delete associated image
    const imagePath = resolveUploadPath(products[index].image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    products.splice(index, 1);
    writeProducts(products);

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Error deleting product' });
  }
});

// Serve static files from uploads
app.use('/uploads', express.static(uploadsDir));

// Serve frontend routes (must be before static file serving)
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/product/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product', 'detail.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product', 'product_cms.html'));
});

// Serve other static HTML files from public directory
app.get(/\.html$/, (req, res, next) => {
  const filePath = path.join(PUBLIC_DIR, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

// Basic health check for Hostinger
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
});
