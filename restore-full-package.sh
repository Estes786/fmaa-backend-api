#!/bin/bash
# Script to restore full package.json after basic deployment succeeds

echo "🔄 Restoring full package.json..."
cp package-full.json.backup package.json

echo "📦 Installing dependencies..."
npm install

echo "✅ Full package.json restored!"
echo "💡 Now commit and push to deploy with full functionality"

echo ""
echo "Next steps:"
echo "1. git add package.json package-lock.json"
echo "2. git commit -m 'Restore full dependencies after successful basic deployment'"
echo "3. git push origin main"