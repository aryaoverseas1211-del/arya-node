# Deployment Guide for Hostinger

## ✅ Pre-Deployment Checklist

- [x] Server listens on `0.0.0.0` (fixed in server.js)
- [x] package.json has correct start script
- [x] All dependencies listed in package.json

## 📦 How to Create Deployment ZIP

1. **Open the `arya-node/` folder**
2. **Zip the contents inside `arya-node/`** (so `server.js` is at the ZIP root)
3. **Exclude these from ZIP:**
   - `node_modules/` (Hostinger will install)
   - `.DS_Store` files
   - Any `.zip` files
   - `package-lock.json` (optional, but cleaner)

## 🚀 Hostinger Deployment Settings

In hPanel → **Websites → Node.js → Your App**:

- **Framework**: `Express`
- **Root directory**: `./`
- **Entry file**: `server.js`
- **Node version**: `18.x` or `20.x`
- **Install command**: `npm install`
- **Start command**: `npm start` (or leave empty if not required)

## 🔐 Environment Variables (Required)

Set these in Hostinger → Node.js app → Environment Variables:

- `SESSION_SECRET` (long random string)
- `ADMIN_EMAIL` (admin login email)
- `ADMIN_PASSWORD` (admin login password)
- `ADMIN_NAME` (display name)

## 📁 Expected File Structure in ZIP

```
arya-node/
├── package.json
├── .gitignore
├── server.js
├── public/
│   ├── index.html
│   ├── product/
│   ├── categories/
│   └── ...
├── data/
│   └── app.db (SQLite database, auto-created)
└── uploads/ (will be created automatically)
```

## ✅ After Deployment

1. Wait 30-60 seconds after deployment
2. Check app status in Hostinger (should show "Running")
3. Visit your domain - should show homepage
4. Test `/admin` - should show CMS panel
5. Test `/api/products` - should return JSON

## 🔧 Troubleshooting

### 503 Error
- Verify entry file is `server.js`
- Check that server.js listens on `0.0.0.0`
- Ensure root directory is `./`

### Build Fails
- Check package.json is in the root directory
- Verify all dependencies are listed
- Check Node version (use 18.x or 20.x)

### Files Not Found
- Verify ZIP structure (no double nesting)
- Check that `public/` exists
- Ensure `assets/veom-logo.png` is in `public/assets/`
