#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AdScale Labs — Vercel Dashboard Deploy Script
#
# What this does:
#   1. Checks for Vercel CLI (installs if missing)
#   2. Sets NEXT_PUBLIC_API_BASE in Vercel to point to your VPS
#   3. Deploys the dashboard/ directory to Vercel (production)
#
# Run from the adscale-labs/ directory:
#   bash deploy-dashboard.sh
#
# Note: You'll be asked to log into Vercel the first time (browser opens)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[→]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   AdScale Labs — Vercel Dashboard Deploy         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"
API_URL="http://api.srv1388391.hstgr.cloud"
TEAM_ID="team_BcFcFVATPB2sAxXako5ovD0w"
PROJECT_ID="prj_SvLpLisRBXBAjqI0uMOC19sgCWge"

# ── Step 1: Check / install Vercel CLI ───────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  info "Installing Vercel CLI..."
  npm install -g vercel
fi
success "Vercel CLI $(vercel --version 2>/dev/null | head -1) ready"

# ── Step 2: Log in if needed ─────────────────────────────────────────────────
if ! vercel whoami &>/dev/null 2>&1; then
  warn "Not logged into Vercel. Opening browser for login..."
  vercel login
fi
success "Logged in as: $(vercel whoami)"

# ── Step 3: Set NEXT_PUBLIC_API_BASE env var on Vercel ───────────────────────
info "Setting NEXT_PUBLIC_API_BASE=$API_URL on Vercel (production)..."

# Remove existing first (ignore error if not set)
vercel env rm NEXT_PUBLIC_API_BASE production \
  --token "$(cat ~/.vercel/auth.json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || echo "")" \
  --scope "$TEAM_ID" \
  --yes 2>/dev/null || true

# Add the production env var
echo "$API_URL" | vercel env add NEXT_PUBLIC_API_BASE production \
  --scope "$TEAM_ID" 2>/dev/null || \
  warn "Could not set env var automatically — set it manually in Vercel Dashboard:"
  warn "  Settings → Environment Variables → NEXT_PUBLIC_API_BASE = $API_URL"

# ── Step 4: Deploy to Vercel production ──────────────────────────────────────
info "Deploying dashboard to Vercel (production)..."
cd "$DASHBOARD_DIR"

vercel deploy --prod \
  --scope "$TEAM_ID" \
  --yes 2>&1 | tee /tmp/vercel-deploy.log

DEPLOY_URL=$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' /tmp/vercel-deploy.log | tail -1 || echo "https://adscale-labs.vercel.app")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 2 DONE — Dashboard deployed to Vercel${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Dashboard URL:   https://adscale-labs.vercel.app"
echo "  API it calls:    $API_URL"
echo ""
echo -e "${YELLOW}IMPORTANT — After this runs:${NC}"
echo "  SSH into your VPS and update DASHBOARD_ORIGIN to allow Vercel:"
echo ""
echo "  ssh root@srv1388391.hstgr.cloud"
echo "  nano ~/adscale-labs/.env"
echo "  # Add https://adscale-labs.vercel.app to DASHBOARD_ORIGIN"
echo "  pm2 restart adscale-server"
echo ""
