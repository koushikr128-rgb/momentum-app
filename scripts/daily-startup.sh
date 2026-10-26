#!/bin/bash
# =============================================================================
# Daily Startup Script — Run this at the start of each day
# =============================================================================
# This script fixes everything that gets wiped during sandbox resets:
#   1. Reinstalls yfinance + dependencies
#   2. Recreates .env.local with Kite credentials
#   3. Restarts the dev server
#
# Usage:
#   bash /home/z/my-project/scripts/daily-startup.sh
# Or just:
#   bash scripts/daily-startup.sh
# =============================================================================

set -e
cd /home/z/my-project

echo "=========================================="
echo "  Daily Startup — Fixing Everything"
echo "=========================================="

# --- Step 1: Install Python dependencies ---
echo "→ Installing yfinance + dependencies..."
pip3 install -q yfinance curl_cffi multitasking peewee protobuf pandas numpy 2>&1 | tail -1
/home/z/.venv/bin/python3 -m pip install -q yfinance curl_cffi multitasking peewee protobuf pandas numpy 2>&1 | tail -1
echo "✅ Python dependencies installed"

# --- Step 2: Recreate .env.local ---
echo "→ Creating .env.local..."
cat > .env.local << 'EOF'
KITE_API_KEY=mrotfrt78mmjv00p
KITE_API_SECRET=7rqlb307keo1wj5fgl5io3s1wbziyrsk
KITE_REDIRECT_URI=https://preview-1fd75aa3-09a0-4ed0-80d6-1be7478b89a2.space-z.ai/zerodha-callback.html
EOF
echo "✅ .env.local created"

# --- Step 3: Check if Position History + Publish to Live code exists ---
echo "→ Checking page.tsx for custom features..."
if ! grep -q "Position History" src/app/page.tsx; then
    echo "⚠ Position History code missing — need to restore from git"
    # Restore page.tsx from the latest git commit (which has all features)
    git checkout HEAD -- src/app/page.tsx 2>/dev/null || echo "  (git restore skipped — no commits with the code)"
fi

if ! grep -q "publishToLive\|Publish to Live" src/app/page.tsx; then
    echo "⚠ Publish to Live code missing — need to restore from git"
    git checkout HEAD -- src/app/page.tsx 2>/dev/null || echo "  (git restore skipped)"
fi

# --- Step 4: Restart dev server ---
echo "→ Restarting dev server..."
pkill -9 -f "next" 2>/dev/null || true
sleep 2
rm -rf .next/dev/lock 2>/dev/null || true
nohup setsid -f npm run dev > dev.log 2>&1 < /dev/null
sleep 5

# --- Step 5: Verify ---
echo "→ Verifying..."
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ | grep -q "200"; then
    echo "✅ Dev server running"
else
    echo "❌ Dev server failed to start — check dev.log"
fi

if python3 -c "import yfinance" 2>/dev/null; then
    echo "✅ yfinance installed"
else
    echo "❌ yfinance still missing"
fi

if [ -f .env.local ]; then
    echo "✅ .env.local exists"
else
    echo "❌ .env.local missing"
fi

if grep -q "Position History" src/app/page.tsx 2>/dev/null; then
    echo "✅ Position History code present"
else
    echo "⚠ Position History code missing (needs manual restore)"
fi

if grep -q "Publish to Live" src/app/page.tsx 2>/dev/null; then
    echo "✅ Publish to Live code present"
else
    echo "⚠ Publish to Live code missing (needs manual restore)"
fi

echo ""
echo "=========================================="
echo "  ✅ Startup Complete!"
echo "=========================================="
echo ""
echo "  App URL: https://preview-1fd75aa3-09a0-4ed0-80d6-1be7478b89a2.space-z.ai/"
echo ""
echo "  If Position History / Publish to Live are missing,"
echo "  tell the AI: 'restore position history and publish to live'"
echo ""
echo "=========================================="
