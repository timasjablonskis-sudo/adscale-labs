# AdScale Labs — Go-Live Deployment Guide

> **Goal:** Express backend on VPS (PM2 + nginx) → Next.js dashboard on Vercel → Tally webhook → Larry SDR fires automatically on every new lead.

---

## Prerequisites — Get Your SSH Password

1. Go to [Hostinger hPanel](https://hpanel.hostinger.com)
2. Click **VPS** → your server → **Overview**
3. The root password is shown there (or reset it if you've forgotten it)

---

## Step 1 — Deploy the Express Backend to VPS

Open **Terminal** on your Mac, `cd` into the project folder, and run:

```bash
cd ~/Desktop/The\ board\ of\ directors/adscale-labs
bash deploy-backend.sh
```

The script will:
- Detect or ask for your SSH credentials
- rsync all project files to `/root/adscale-labs` on the VPS
- Install Node.js 20 + PM2 + nginx (if not already there)
- Run `npm install`, seed the database
- Start the server with PM2 (auto-restarts on crash, survives reboots)
- Configure nginx at `http://api.srv1388391.hstgr.cloud` → port 3001

**Verify it worked:**
```bash
curl http://api.srv1388391.hstgr.cloud/health
# Should return: {"status":"ok","agents":6,...}
```

**If SSH fails (wrong password / no key):**
The script will print `Cannot connect`. In that case:
```bash
# Option A — Use password (script will prompt you)
# Just run it again; it will ask for the password

# Option B — Copy your SSH key first
ssh-copy-id root@srv1388391.hstgr.cloud
# Then run deploy-backend.sh again
```

---

## Step 2 — Deploy the Next.js Dashboard to Vercel

```bash
cd ~/Desktop/The\ board\ of\ directors/adscale-labs
bash deploy-dashboard.sh
```

The script will:
- Install Vercel CLI (if needed)
- Log you in (browser opens once)
- Set `NEXT_PUBLIC_API_BASE=http://api.srv1388391.hstgr.cloud` in Vercel
- Deploy `dashboard/` to production

**Result:** `https://adscale-labs.vercel.app`

### After deploy — allow CORS on the VPS

```bash
ssh root@srv1388391.hstgr.cloud
nano ~/adscale-labs/.env
```

Find `DASHBOARD_ORIGIN` and confirm it includes your Vercel URL:
```
DASHBOARD_ORIGIN=http://localhost:3000,http://localhost:3002,https://srv1388391.hstgr.cloud,https://adscale-labs.vercel.app
```

Then restart:
```bash
pm2 restart adscale-server
```

---

## Step 3 — Connect Tally → Larry SDR (The Money Step)

### Your webhook URL:
```
http://api.srv1388391.hstgr.cloud/webhooks/lead
```

### How to configure Tally:

1. Open your Tally form → **Integrations** tab → **Webhooks**
2. Click **+ Add endpoint**
3. Paste the webhook URL above
4. Set the **signing secret** to: `adscale_tally_2026`
5. Click **Save**

### What happens when someone submits the form:
```
Tally form submit
  → POST http://api.srv1388391.hstgr.cloud/webhooks/lead
  → Larry SDR wakes up
  → Sends personalised email (Gmail SMTP ✓)
  → Sends Instagram DM via ManyChat (once API key added)
  → Books Calendly call (once API key added)
  → Lead logged to SQLite → visible in dashboard
```

### Test it manually:
```bash
curl -X POST http://api.srv1388391.hstgr.cloud/webhooks/lead \
  -H "Content-Type: application/json" \
  -H "tally-signature: adscale_tally_2026" \
  -d '{
    "data": {
      "fields": [
        {"label": "Name",    "value": "Test Lead"},
        {"label": "Email",   "value": "timasjablonskis@gmail.com"},
        {"label": "Company", "value": "Test Co"},
        {"label": "Budget",  "value": "$5,000/mo"}
      ]
    }
  }'
```

---

## Step 4 (Optional) — ManyChat for Instagram DMs

1. Go to [ManyChat](https://manychat.com) → **Settings** → **API**
2. Generate an API key
3. SSH into VPS: `ssh root@srv1388391.hstgr.cloud`
4. `nano ~/adscale-labs/.env`
5. Set `MANYCHAT_API_KEY=your_key_here`
6. `pm2 restart adscale-server`

---

## Useful Commands (Once Live)

```bash
# View live logs
ssh root@srv1388391.hstgr.cloud 'pm2 logs adscale-server'

# Restart server
ssh root@srv1388391.hstgr.cloud 'pm2 restart adscale-server'

# Re-deploy after code changes
cd ~/Desktop/The\ board\ of\ directors/adscale-labs
bash deploy-backend.sh   # pushes latest code to VPS

# Check PM2 status
ssh root@srv1388391.hstgr.cloud 'pm2 status'
```

---

## Architecture Summary

```
Tally Form Submit
      │
      ▼
http://api.srv1388391.hstgr.cloud   (nginx → PM2 → Express :3001)
      │                              VPS: srv1388391.hstgr.cloud
      │
      ├── /webhooks/lead        → Larry SDR (email + IG DM + Calendly)
      ├── /webhooks/stripe      → Cleo Onboarding
      ├── /run-agent/:name      → n8n triggers (protected by INTERNAL_TOKEN)
      └── /health               → monitoring

n8n.srv1388391.hstgr.cloud     (already running on VPS)
      │
      └── Calls /run-agent/* on schedule

https://adscale-labs.vercel.app    (Next.js dashboard)
      │
      └── Reads from Express API (not SQLite directly)
```

---

## URLs

| Service         | URL                                          |
|-----------------|----------------------------------------------|
| API / backend   | http://api.srv1388391.hstgr.cloud            |
| Health check    | http://api.srv1388391.hstgr.cloud/health     |
| Lead webhook    | http://api.srv1388391.hstgr.cloud/webhooks/lead |
| n8n             | https://n8n.srv1388391.hstgr.cloud           |
| Dashboard       | https://adscale-labs.vercel.app              |
