# Arya Overseas Product CMS

A modern, Node.js-based Product Content Management System with image uploads, MOQ-based pricing, and WhatsApp integration.

## Features

- ✅ **Product Management**: Add, edit, and delete products with images
- ✅ **MOQ-Based Pricing**: Multiple pricing tiers based on quantity
- ✅ **Image Upload**: Secure file upload with validation (max 5MB)
- ✅ **WhatsApp Integration**: Send product inquiries directly via WhatsApp
- ✅ **SEO Optimized**: Meta tags, structured data, and semantic HTML
- ✅ **Responsive Design**: Mobile-friendly UI with Tailwind CSS
- ✅ **RESTful API**: Clean API endpoints for product management

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Access the application:**
   - Homepage: http://localhost:3000
   - Admin Panel: http://localhost:3000/admin
   - API Base: http://localhost:3000/api/products

## Project Structure

```
public_html/
├── server.js              # Express server and API routes
├── package.json           # Dependencies and scripts
├── public/                # Frontend files
│   ├── index.html         # Homepage
│   ├── product/
│   │   ├── product_cms.html  # Admin panel
│   │   └── detail.html        # Product detail page
│   ├── assets/            # Static assets (images, etc.)
│   └── ...                # Other HTML pages
├── uploads/               # Uploaded product images (auto-created)
└── data/                  # JSON data storage (auto-created)
    └── products.json      # Product database
```

## API Endpoints

### GET `/api/products`
Get all products

**Response:**
```json
{
  "success": true,
  "products": [...]
}
```

### GET `/api/products/:id`
Get a single product by ID

**Response:**
```json
{
  "success": true,
  "product": {...}
}
```

### POST `/api/products`
Create a new product

**Request (FormData):**
- `title` (string, required)
- `shortDesc` (string, optional)
- `description` (string, required)
- `image` (file, required, max 5MB)
- `pricing` (JSON string, required)

**Example pricing:**
```json
[
  {"min": 100, "max": 500, "price": 25.00},
  {"min": 500, "max": null, "price": 20.00}
]
```

### DELETE `/api/products/:id`
Delete a product

**Response:**
```json
{
  "success": true,
  "message": "Product deleted"
}
```

## Usage

### Adding a Product

1. Navigate to http://localhost:3000/admin
2. Fill in the product form:
   - Product Title (required)
   - Short Description (for homepage)
   - Full Description (required)
   - Upload Product Image (required, max 5MB)
   - Add MOQ Pricing Tiers:
     - Minimum Quantity
     - Maximum Quantity (optional, leave empty for unlimited)
     - Price per unit
3. Click "Save Product"

### Viewing Products

- Products are automatically displayed on the homepage
- Click any product to view full details with pricing
- Use the "Send Inquiry on WhatsApp" button to contact

## Configuration

### Change WhatsApp Number

Edit the `WHATSAPP_NUMBER` constant in:
- `public/product/detail.html` (line ~30)
- `public/index.html` (update all WhatsApp links)

### Change Port

Set the `PORT` environment variable:
```bash
PORT=8080 npm start
```

Or edit `server.js`:
```javascript
const PORT = process.env.PORT || 3000;
```

## File Storage

- **Images**: Stored in `uploads/` directory
- **Data**: Products stored in `data/products.json`
- Both directories are auto-created on first run

## Security Notes

- File uploads are validated (type and size)
- Images are stored locally (consider cloud storage for production)
- No authentication implemented (add for production use)

## Production Deployment

For production deployment:

1. **Set environment variables:**
   ```bash
   NODE_ENV=production
   PORT=3000
   ```

2. **Use a process manager:**
   ```bash
   npm install -g pm2
   pm2 start server.js --name arya-cms
   ```

3. **Consider adding:**
   - Authentication/Authorization
   - Cloud storage (AWS S3, Cloudinary, etc.)
   - Database (MongoDB, PostgreSQL)
   - Rate limiting
   - HTTPS/SSL

## Troubleshooting

### Port already in use
Change the port in `server.js` or set `PORT` environment variable.

### Images not loading
- Check that `uploads/` directory exists and has write permissions
- Verify image paths in the API response

### Products not saving
- Check that `data/` directory exists and has write permissions
- Check server console for errors

## License

ISC

## Support

For issues or questions, contact via WhatsApp: +91-9667371899
