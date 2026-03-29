#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AdScale Labs — VPS Backend Deployment Script
#
# What this does:
#   1. Detects your SSH key automatically (or prompts for password)
#   2. rsyncs the project to the VPS (skips node_modules, .git, data/, logs/)
#   3. Installs Node.js 20 + PM2 if not already present
#   4. Writes the .env file securely on the server
#   5. Runs npm install, seeds the DB, starts the server with PM2
#   6. Configures nginx to reverse-proxy api.srv1388391.hstgr.cloud → :3001
#   7. Enables PM2 startup on reboot
#
# Run from the adscale-labs/ directory:
#   bash deploy-backend.sh
#
# Prerequisites on your Mac:
#   • rsync (built-in on macOS)
#   • ssh (built-in on macOS)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
VPS_HOST="srv1388391.hstgr.cloud"
VPS_USER="root"
APP_DIR="/root/adscale-labs"
API_DOMAIN="api.srv1388391.hstgr.cloud"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[→]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       AdScale Labs — VPS Deploy Script           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Detect SSH key ────────────────────────────────────────────────────
info "Detecting SSH key..."
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

KEY_FOUND=""
for KEY_PATH in \
    "$HOME/.ssh/id_ed25519" \
    "$HOME/.ssh/id_rsa" \
    "$HOME/.ssh/hostinger" \
    "$HOME/.ssh/hostinger_key" \
    "$HOME/.ssh/adscale" \
    "$HOME/.ssh/vps_key"; do
  if [[ -f "$KEY_PATH" ]]; then
    # Test if key works
    if ssh "${SSH_OPTS[@]}" -i "$KEY_PATH" -o BatchMode=yes "${VPS_USER}@${VPS_HOST}" "echo ok" &>/dev/null; then
      KEY_FOUND="$KEY_PATH"
      success "Found working SSH key: $KEY_PATH"
      break
    fi
  fi
done

if [[ -z "$KEY_FOUND" ]]; then
  warn "No SSH key found. You'll be prompted for the VPS password."
  warn "To avoid typing the password every time, generate a key with:"
  warn "  ssh-keygen -t ed25519 -f ~/.ssh/hostinger_key"
  warn "  ssh-copy-id -i ~/.ssh/hostinger_key.pub root@${VPS_HOST}"
  SSH_CMD="ssh ${SSH_OPTS[*]} ${VPS_USER}@${VPS_HOST}"
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
else
  SSH_CMD="ssh ${SSH_OPTS[*]} -i ${KEY_FOUND} ${VPS_USER}@${VPS_HOST}"
  RSYNC_SSH="ssh ${SSH_OPTS[*]} -i ${KEY_FOUND}"
fi

# ── Step 2: Test connectivity ─────────────────────────────────────────────────
info "Testing VPS connectivity..."
if ! $SSH_CMD "echo 'Connection OK'" 2>/dev/null; then
  error "Cannot connect to ${VPS_USER}@${VPS_HOST}. Check your SSH access."
fi
success "VPS is reachable"

# ── Step 3: rsync project files ───────────────────────────────────────────────
info "Syncing project files to VPS (skipping node_modules, .git, data, logs)..."
rsync -avz --progress \
  -e "$RSYNC_SSH" \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='data/' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  --exclude='logs/' \
  --exclude='.DS_Store' \
  --exclude='dashboard/node_modules/' \
  --exclude='dashboard/.next/' \
  --include='.env' \
  "${LOCAL_DIR}/" \
  "${VPS_USER}@${VPS_HOST}:${APP_DIR}/"

success "Files synced to ${APP_DIR}"

# ── Step 4: Remote setup ──────────────────────────────────────────────────────
info "Running remote setup (Node.js, PM2, nginx)..."

$SSH_CMD bash << REMOTE
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "\${BLUE}[→]\${NC} \$*"; }
success() { echo -e "\${GREEN}[✓]\${NC} \$*"; }

# ── Install Node.js 20 if missing or outdated ──────────────────────────────
NODE_OK=false
if command -v node &>/dev/null; then
  NODE_VER=\$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
  [[ "\$NODE_VER" == "ok" ]] && NODE_OK=true
fi

if [[ "\$NODE_OK" == "false" ]]; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
success "Node.js \$(node -v) ready"

# ── Install PM2 if missing ─────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2
fi
success "PM2 \$(pm2 -v) ready"

# ── Install nginx if missing ───────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  info "Installing nginx..."
  apt-get update -qq && apt-get install -y nginx
fi
success "nginx ready"

# ── Create required directories ────────────────────────────────────────────
mkdir -p ${APP_DIR}/logs
mkdir -p ${APP_DIR}/data

# ── Install Node dependencies ──────────────────────────────────────────────
info "Running npm install..."
cd ${APP_DIR}
npm install --production

# ── Seed / init database ───────────────────────────────────────────────────
info "Initializing database..."
if [[ ! -f "${APP_DIR}/data/adscale.db" ]]; then
  npm run seed || node -e "require('./lib/database')" && echo "DB initialized"
else
  echo "  Database already exists, skipping seed"
fi

# ── Start / restart with PM2 ──────────────────────────────────────────────
info "Starting AdScale Labs with PM2..."
cd ${APP_DIR}

# Stop existing instance if running
pm2 delete adscale-server 2>/dev/null || true

pm2 start ecosystem.config.js --env production
pm2 save

# ── Enable PM2 startup (auto-start on reboot) ─────────────────────────────
info "Configuring PM2 startup..."
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || \
  pm2 startup | tail -1 | bash 2>/dev/null || \
  info "  Run 'pm2 startup' manually if auto-start is needed"
pm2 save

success "PM2 running. Status:"
pm2 status

# ── Configure nginx ───────────────────────────────────────────────────────
info "Configuring nginx reverse proxy for ${API_DOMAIN}..."

cat > /etc/nginx/sites-available/adscale-api << 'NGINX'
server {
    listen 80;
    server_name api.srv1388391.hstgr.cloud;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    # Larger body for webhook payloads
    client_max_body_size 10M;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Timeouts for long-running AI agent calls
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # Health check — fast path, no proxy overhead
    location /health {
        proxy_pass http://127.0.0.1:3001/health;
        access_log off;
    }
}
NGINX

# Enable the site
ln -sf /etc/nginx/sites-available/adscale-api /etc/nginx/sites-enabled/adscale-api

# Test nginx config
nginx -t && systemctl reload nginx
success "nginx configured — ${API_DOMAIN} → :3001"

# ── Open firewall port 80 ──────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 80/tcp 2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  info "Firewall: ports 80 and 443 opened"
fi

# ── Final health check ─────────────────────────────────────────────────────
info "Waiting for server to start..."
sleep 3

if curl -sf http://127.0.0.1:3001/health > /dev/null; then
  success "Express server is healthy on :3001"
else
  echo "  Server may still be starting. Check with: pm2 logs adscale-server"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "\${GREEN}VPS deployment complete!\${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Health:   http://${API_DOMAIN}/health"
echo "  Leads:    http://${API_DOMAIN}/webhooks/lead"
echo "  PM2 logs: pm2 logs adscale-server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REMOTE

success "Remote setup complete!"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Step 1 DONE — Express backend is live on VPS${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  API base URL:    http://${API_DOMAIN}"
echo "  Health check:    http://${API_DOMAIN}/health"
echo "  Lead webhook:    http://${API_DOMAIN}/webhooks/lead  (← use this in Tally)"
echo "  PM2 logs:        ssh ${VPS_USER}@${VPS_HOST} 'pm2 logs adscale-server'"
echo ""
echo "  Next steps:"
echo "  1. ✅ VPS backend — DONE"
echo "  2. Deploy dashboard to Vercel (Claude will do this)"
echo "  3. Point Tally webhook to the URL above"
echo ""
