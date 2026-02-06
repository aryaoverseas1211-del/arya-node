# Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm install
```

This will install:
- Express (web server)
- Multer (file upload handling)
- CORS (cross-origin resource sharing)
- Body-parser (request parsing)
- express-session (admin sessions)
- bcryptjs (password hashing)
- sql.js (SQLite database, pure JS/WASM)
- papaparse (CSV import/export)

## Step 2: Start the Server

```bash
npm start
```

The server will start on **http://localhost:3000**

## Step 3: Access the Application

- **Homepage**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin
- **API**: http://localhost:3000/api/products

## Step 3.1: Admin Credentials (Required)

Set these environment variables before starting:

```bash
export SESSION_SECRET="your-long-random-secret"
export ADMIN_EMAIL="admin@example.com"
export ADMIN_PASSWORD="strong-password"
export ADMIN_NAME="Admin"
```

## Step 4: Add Your First Product

1. Go to http://localhost:3000/admin
2. Fill in the product form
3. Upload an image (max 5MB)
4. Add at least one pricing tier
5. Click "Save Product"

## Troubleshooting

### Error: Port 3000 already in use

Change the port:
```bash
PORT=8080 npm start
```

### Images not displaying

- Check that the `uploads/` folder exists
- Verify file permissions
- Check browser console for 404 errors

### Products not saving

- Check that the `data/` folder exists
- Verify write permissions
- Check server console for errors

### Admin login not working

- Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set
- Restart the server after setting env variables

## Development Mode

For auto-reload during development:
```bash
npm run dev
```

(Requires nodemon: `npm install -g nodemon`)

## Production Deployment

1. Set environment to production:
   ```bash
   NODE_ENV=production npm start
   ```

2. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name arya-cms
   ```

3. Configure reverse proxy (nginx/Apache) if needed

## File Structure

After first run, these directories will be created:
- `uploads/` - Product images
- `data/` - SQLite database file
