# 🚨 MINIMAL DEPLOYMENT TEST

## 🎯 **Current Strategy**
Deployment gagal dengan konfigurasi lengkap, jadi kita test dengan minimal setup dulu.

## ✅ **Yang Sudah Dilakukan:**
1. **Backup Full Package**: `package-full.json.backup`
2. **Minimal Package**: Hanya Node.js 18.x, tanpa dependencies
3. **Simple Endpoints**: `/api/hello` dan `/api/simple` 
4. **Basic Vercel Config**: Konfigurasi paling sederhana
5. **🔧 HOTFIX**: Fixed runtime error `nodejs18.x` → removed explicit runtime

## 🐛 **Error Yang Sudah Diperbaiki:**
```
Error: Function Runtimes must have a valid version, for example `now-php@1.0.0`.
```
**Solution**: Menggunakan vercel.json minimal tanpa explicit runtime specification.

## 🧪 **Test Endpoints:**

Setelah deployment selesai, test:

### 1. Basic CommonJS Endpoint
```
https://your-app.vercel.app/api/hello
```
Expected: `{"message": "Hello from Vercel!", "status": "success"}`

### 2. ES6 Module Endpoint  
```
https://your-app.vercel.app/api/simple
```
Expected: `{"message": "API Works!"}`

## 📋 **Deployment Checklist:**

- [x] **Runtime Error** fixed (nodejs18.x removed)
- [ ] **Commit 59bf507** deployed to Vercel  
- [ ] **Basic endpoints** accessible without errors
- [ ] **No build/runtime conflicts** in build logs
- [ ] **Function deployment** successful

## 🔄 **Next Steps After Success:**

### Jika Minimal Deployment Berhasil:
```bash
# Restore full functionality
./restore-full-package.sh

# Commit perubahan
git add .
git commit -m "Restore full dependencies after successful basic deployment"
git push origin main
```

### Jika Minimal Deployment Masih Gagal:
Kita akan troubleshoot lebih detail:
1. Check Vercel build logs
2. Coba konfigurasi yang lebih basic lagi
3. Test dengan file statis saja

## 🎲 **Recovery Plan:**

File backup yang tersedia:
- `package-full.json.backup` - Package.json lengkap
- `package-simple.json` - Package.json minimal alternatif

## ⏰ **Timeline:**
- **Step 1**: ✅ Fix runtime error
- **Step 2**: Test minimal deployment (sekarang)
- **Step 3**: Jika berhasil → restore full package
- **Step 4**: Jika gagal → investigate build process

**Current Commit**: `59bf507` - Fixed runtime configuration error