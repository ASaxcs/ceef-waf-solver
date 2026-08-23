#!/bin/bash

# ── 1. Install npm dependencies if node_modules missing ──
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies..."
  npm install
  echo "✅ Dependencies installed"
fi

# ── 2. Auto-install Chromium if missing (Pterodactyl egg Node.js = no apt-get) ──
CHROME_DIR="${PUPPETEER_CACHE_DIR:-$HOME/.cache/puppeteer}"
if [ ! -d "$CHROME_DIR" ] || [ -z "$(ls -A "$CHROME_DIR" 2>/dev/null)" ]; then
  if [ ! -d "./browsers" ] || [ -z "$(ls -A "./browsers" 2>/dev/null)" ]; then
    echo "📦 Chromium not found in system or cache. Installing via @puppeteer/browsers..."
    npx @puppeteer/browsers install chrome@stable --path ./browsers
  fi
fi

# ── 3. Auto-detect and set CHROME_PATH ──
CHROME_BIN=$(find /usr/bin -name "chromium" -o -name "google-chrome" 2>/dev/null | head -1)
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN=$(find ./browsers -type f -name "chrome" -o -name "chromium" -o -name "chrome-headless-shell" 2>/dev/null | head -1)
fi
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN=$(find "$CHROME_DIR" -type f -name "chrome" -o -name "chromium" -o -name "chrome-headless-shell" 2>/dev/null | head -1)
fi
if [ -n "$CHROME_BIN" ]; then
  export CHROME_BIN="$CHROME_BIN"
  export CHROME_PATH="$CHROME_BIN"
  echo "✅ Detected Chrome at: $CHROME_BIN"
fi

# ── 4. Virtual Display / Xvfb Check ──
if command -v Xvfb >/dev/null 2>&1; then
  echo "🖥️ System Xvfb detected. Starting virtual display on :99..."
  Xvfb :99 -screen 0 1280x1024x24 -ac &
  export DISPLAY=:99
  sleep 2
else
  echo "ℹ️ System Xvfb not found. CEEF xvfbManager will automatically download and extract rootless Xvfb + required shared libraries on startup."
fi

echo "🚀 Starting CEEF WAF Solver..."
exec node src/index.js

