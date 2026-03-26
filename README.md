# AdScale Labs — AI Marketing & Sales Automation

Full-stack AI agent system that runs your marketing and sales operations on autopilot.

## System Overview

| Agent | Name | Schedule | Priority |
|-------|------|----------|----------|
| Scout | Research | 6 AM daily | Medium |
| Scripter | Content | 7 AM daily | Medium |
| **Larry SDR** | **Lead Qualification** | **On new lead** | **HIGHEST** |
| Analyst | Performance | 8 PM daily | Medium |
| Cleo | Onboarding | On payment | High |
| Optimizer | Self-improvement | Sunday midnight | Low |

**Larry is the highest priority agent.** Everything else feeds him leads.

---

## Quick Start

### 1. Install

```bash
# Root (agents + server)
npm install

# Dashboard
cd dashboard && npm install && cd ..
```

### 2. Configure

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY (minimum required to run agents)
# All other keys are optional — agents degrade gracefully without them
```

### 3. Seed demo data

```bash
npm run seed
```

### 4. Start

```bash
# Terminal 1: Express server (agents + webhooks + crons)
npm start

# Terminal 2: Next.js dashboard
cd dashboard && npm run dev
```

Dashboard: `http://localhost:3000`
Server: `http://localhost:3001`
Health check: `http://localhost:3001/health`

---

## Agent Reference

### Larry SDR (`agents/larry-sdr.js`)

The most important agent. Fires immediately when a new lead submits your form.

**Flow:**
1. Lead submits Tally/Typeform → webhook fires to `/webhooks/lead`
2. Lead saved to `leads` table
3. Welcome email sent (Nodemailer/SendGrid)
4. IG DM sent via ManyChat API with Claude-written opener
5. If qualified → Calendly booking link sent
6. If no response → 3 follow-up touches over 7 days (9 AM + 5 PM cron)

**Dry run test:**
```bash
npm run agent:larry:dry
```

**Qualification criteria (all 3 required):**
- Service-based business
- Has existing leads/customers (not $0)
- Open to AI automation

### Scout (`agents/scout.js`)

Scrapes Twitter trends (via Nitter RSS) and competitor Instagram (via Apify). Uses Claude to extract content ideas.

```bash
npm run agent:scout:dry
```

### Scripter (`agents/scripter.js`)

Reads Scout's output + yesterday's top performer. Generates 5 reel scripts (3 MOF + 2 TOF).

```bash
npm run agent:scripter:dry
```

### Analyst (`agents/analyst.js`)

Pulls Instagram Reel metrics, flags top performer. Triggers Scripter to replicate it tomorrow.

```bash
npm run agent:analyst:dry
```

### Cleo (`agents/cleo-onboarding.js`)

Triggered by Stripe payment. Sends onboarding form, scrapes client IG, generates Brand Document.

```bash
npm run agent:cleo:dry
```

### Optimizer (`agents/optimizer.js`)

Weekly self-improvement. Reviews all performance data, rewrites prompts, writes SOPs, generates weekly report.

```bash
npm run agent:optimizer:dry
```

---

## Webhook Setup

### Tally (leads + onboarding)

1. In Tally, go to your lead form → Integrations → Webhooks
2. Set webhook URL to: `https://your-domain.com/webhooks/lead`
3. Set the secret key to match `TALLY_WEBHOOK_SECRET` in `.env`
4. Same process for the onboarding form → `/webhooks/onboarding`

### Stripe (new clients)

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-domain.com/webhooks/stripe`
3. Events: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET` in `.env`

> **Critical:** Stripe requires raw body for signature verification. The server registers the Stripe route with `express.raw()` BEFORE `express.json()`. This ordering is intentional — do not change it.

---

## n8n Integration

Import any of the 4 workflow JSON files from `n8n-workflows/` into your n8n instance.

Configure environment variables in n8n:
- `ADSCALE_SERVER_URL` = `http://localhost:3001` (or your public URL)
- `INTERNAL_TOKEN` = value from `.env`

The n8n workflows call `/run-agent/:name` to trigger agents via HTTP. The `INTERNAL_TOKEN` protects this endpoint.

---

## Dashboard Pages

| Page | URL | What It Shows |
|------|-----|---------------|
| Scripts + Agents | `/` | Today's 5 reel scripts + all agent statuses |
| Lead Pipeline | `/leads` | Kanban board, drag to update status |
| Performance | `/performance` | Reel metrics charts (14 days) |
| Knowledge Base | `/knowledge-base` | All prompts + config, inline editable |
| Clients | `/clients` | Client roster with brand docs |

---

## Database

SQLite at `./data/adscale.db`. 7 tables:

- `leads` — all inbound leads
- `content_scripts` — generated reel scripts + performance metrics
- `content_ideas` — raw ideas from Scout
- `clients` — onboarded clients with brand documents
- `knowledge_base` — prompts, config, learnings (agents read/write here)
- `sops` — standard operating procedures (Optimizer writes these)
- `agent_logs` — run history for all agents

Re-seed (clears all data): `npm run seed:force`

---

## Environment Variables

See `.env.example` for full documentation. Minimum required:

```
ANTHROPIC_API_KEY=sk-ant-...  # Required for all agents
```

Everything else degrades gracefully:
- No `SMTP_*` / `SENDGRID_API_KEY` → emails silently skipped
- No `MANYCHAT_API_KEY` → IG DMs skipped
- No `APIFY_API_KEY` → IG scraping skipped, Scout continues with Twitter only
- No `IG_ACCESS_TOKEN` → Analyst uses existing DB data only
- No `CALENDLY_API_KEY` → Generic booking link used instead of single-use link

---

## How Prompts Self-Improve

All Claude prompts are stored in the `knowledge_base` table under `category='prompts'`.

The Optimizer runs every Sunday and:
1. Reads all agent performance data from the past week
2. Identifies what's working and what isn't
3. Rewrites underperforming prompts
4. Stores updated prompts back in `knowledge_base`

Next time any agent calls `callClaude(..., { promptKey: 'scout_analysis' })`, it automatically uses the updated prompt — no code changes needed.

You can also manually edit any prompt in the dashboard → Knowledge Base → `prompts` category.

---

## Tech Stack

- **Runtime:** Node.js 18+ (CommonJS)
- **AI:** Anthropic Claude (`claude-sonnet-4-6`)
- **Database:** SQLite via `better-sqlite3`
- **Server:** Express.js
- **Scheduler:** node-cron
- **Email:** Nodemailer / SendGrid
- **Dashboard:** Next.js 14 (App Router, TypeScript, Tailwind)
- **Charts:** Recharts
- **Drag-drop:** @hello-pangea/dnd
- **Automation:** n8n (self-hosted)
