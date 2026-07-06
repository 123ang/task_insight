#!/usr/bin/env bash
#
# DMS Deploy Script - Run on VPS after code changes
# Usage: ./deploy.sh [--pull] [--backend-only] [--frontend-only]
#
# Prerequisites: Node.js, npm, PM2, (optional) sudo for frontend deploy
#

set -e

# --- Configuration (adjust if your paths differ) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${DMS_PROJECT_ROOT:-$SCRIPT_DIR}"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
WEB_ROOT="${DMS_WEB_ROOT:-/var/www/taskinsight.my}"
PM2_APP_NAME="${DMS_PM2_APP:-dms-backend}"

# Flags
DO_PULL=false
BACKEND_ONLY=false
FRONTEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --pull)        DO_PULL=true ;;
    --backend-only)  BACKEND_ONLY=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    -h|--help)
      echo "Usage: $0 [--pull] [--backend-only] [--frontend-only]"
      echo "  --pull          Run 'git pull' before deploy (if in a git repo)"
      echo "  --backend-only  Only install backend deps and restart PM2"
      echo "  --frontend-only Only build frontend and copy to web root"
      exit 0
      ;;
  esac
done

echo "=============================================="
echo "  DMS Deploy - $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="
echo "  Project root: $PROJECT_ROOT"
echo "  Web root:     $WEB_ROOT"
echo "  PM2 app:     $PM2_APP_NAME"
echo "=============================================="

# Optional: pull latest code
if [ "$DO_PULL" = true ]; then
  echo ""
  echo ">>> Pulling latest code..."
  if [ -d "$PROJECT_ROOT/.git" ]; then
    (cd "$PROJECT_ROOT" && git pull)
  else
    echo "    Not a git repo, skipping pull."
  fi
fi

deploy_backend() {
  echo ""
  echo ">>> Backend: install dependencies..."
  cd "$BACKEND_DIR"
  npm install --production
  if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.migrate ? 0 : 1)" >/dev/null 2>&1; then
    echo ""
    echo ">>> Backend: running migrations..."
    npm run migrate
  fi
  echo ""
  echo ">>> Backend: restarting PM2 app '$PM2_APP_NAME'..."
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_APP_NAME"
    echo "    Restarted."
  else
    if [ -f "ecosystem.config.js" ]; then
      pm2 start ecosystem.config.js
    else
      pm2 start server.js --name "$PM2_APP_NAME"
    fi
    echo "    Started."
  fi
  pm2 save
}

deploy_frontend() {
  echo ""
  echo ">>> Frontend: install dependencies..."
  cd "$FRONTEND_DIR"
  npm install
  echo ""
  echo ">>> Frontend: building production bundle..."
  npm run build

  if [ -d "dist" ]; then
    FRONTEND_BUILD_DIR="dist"
  elif [ -d "build" ]; then
    FRONTEND_BUILD_DIR="build"
  else
    echo "    ERROR: neither dist/ nor build/ found after npm run build"
    exit 1
  fi

  echo ""
  echo ">>> Frontend: deploying $FRONTEND_BUILD_DIR/ to $WEB_ROOT..."
  sudo mkdir -p "$WEB_ROOT"
  sudo rm -rf "$WEB_ROOT"/*
  sudo cp -r "$FRONTEND_BUILD_DIR"/. "$WEB_ROOT"/
  sudo chown -R www-data:www-data "$WEB_ROOT"
  sudo chmod -R 755 "$WEB_ROOT"
  echo "    Done."
}

# Run deployments
if [ "$FRONTEND_ONLY" = true ]; then
  deploy_frontend
elif [ "$BACKEND_ONLY" = true ]; then
  deploy_backend
else
  deploy_backend
  deploy_frontend
fi

# Health check
echo ""
echo ">>> Health check..."
sleep 2
if curl -sf "http://127.0.0.1:5000/health" >/dev/null 2>&1; then
  echo "    Backend health OK (http://127.0.0.1:5000/health)"
else
  echo "    WARNING: Backend health check failed. Run: pm2 logs $PM2_APP_NAME"
fi

echo ""
echo "=============================================="
echo "  Deploy finished."
echo "  Site: https://taskinsight.my"
echo "  Logs: pm2 logs $PM2_APP_NAME"
echo "=============================================="
