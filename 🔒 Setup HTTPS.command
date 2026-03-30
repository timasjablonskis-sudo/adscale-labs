#!/usr/bin/env bash
# Double-click this to add HTTPS (free Let's Encrypt cert) to the API
# Run AFTER "🚀 Deploy to VPS.command" has completed

set -euo pipefail

VPS_HOST="srv1388391.hstgr.cloud"
VPS_USER="root"
API_DOMAIN="api.srv1388391.hstgr.cloud"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      AdScale Labs — HTTPS Setup                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
KEY_OPT=""
for KEY in ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/hostinger ~/.ssh/hostinger_key; do
  if [[ -f "$KEY" ]] && ssh "${SSH_OPTS[@]}" -i "$KEY" -o BatchMode=yes "${VPS_USER}@${VPS_HOST}" "echo ok" &>/dev/null; then
    KEY_OPT="-i $KEY"; break
  fi
done
[[ -z "$KEY_OPT" ]] && echo -e "${YELLOW}[!]${NC} Enter your VPS root password when prompted."

SSH="ssh ${SSH_OPTS[*]} $KEY_OPT ${VPS_USER}@${VPS_HOST}"

echo -e "${BLUE}[→]${NC} Connecting..."
$SSH "echo connected" >/dev/null && echo -e "${GREEN}[✓]${NC} Connected!"

$SSH bash << REMOTE
set -e

echo ""
echo "=== Installing certbot ==="
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y certbot python3-certbot-nginx
fi
echo "  certbot: \$(certbot --version 2>&1)"

echo ""
echo "=== Getting SSL certificate for ${API_DOMAIN} ==="
certbot --nginx -d ${API_DOMAIN} --non-interactive --agree-tos -m timasjablonskis@gmail.com --redirect
echo "  Certificate issued OK"

echo ""
echo "=== Testing nginx ==="
nginx -t && systemctl reload nginx
echo "  nginx reloaded with HTTPS"

echo ""
echo "=== HTTPS Health check ==="
sleep 2
curl -sf https://${API_DOMAIN}/health && echo "  HTTPS SERVER IS HEALTHY" || echo "  Checking HTTP instead..."
curl -sf http://${API_DOMAIN}/health && echo "  HTTP also works" || true

REMOTE

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  HTTPS CONFIGURED!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  API (HTTPS):   https://api.srv1388391.hstgr.cloud"
echo "  Health:        https://api.srv1388391.hstgr.cloud/health"
echo "  Lead webhook:  https://api.srv1388391.hstgr.cloud/webhooks/lead"
echo ""
echo "  Press any key to close..."
read -n1
