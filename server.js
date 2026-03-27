/**
 * server.js
 * Express server — the main runtime entry point for AdScale Labs.
 *
 * Responsibilities:
 * 1. Serves webhook routes for Tally (leads), Stripe (payments), and onboarding forms
 * 2. Exposes /run-agent/:name endpoint so n8n can trigger agents via HTTP
 * 3. Starts all cron jobs via lib/scheduler.js
 * 4. Provides /health endpoint for monitoring
 *
 * CRITICAL ORDER NOTE:
 * The Stripe webhook route is registered with express.raw() BEFORE app.use(express.json()).
 * Stripe requires the raw request body bytes to verify the webhook signature.
 * If express.json() runs first, it consumes the buffer and Stripe's SDK will always
 * throw a signature verification error. This ordering is not optional.
 *
 * Start: npm start (production) or npm run dev (nodemon, auto-restart)
 */

'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { fork } = require('child_process');
const path = require('path');

const { handleLeadWebhook, handleStripeWebhook, handleOnboardingWebhook, handleLeadResponse } = require('./lib/webhooks');
const { registerJobs } = require('./lib/scheduler');
const { db, logAgentRun } = require('./lib/database');

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
// Security Middleware
// helmet() sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
// cors() allows the Next.js dashboard (on a different port) to fetch from this server.
// ─────────────────────────────────────────────
app.use(helmet());
const allowedOrigins = process.env.DASHBOARD_ORIGIN
  ? process.env.DASHBOARD_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3002'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));

// ─────────────────────────────────────────────
// STRIPE WEBHOOK — Register BEFORE express.json()
// Uses express.raw() to preserve the raw body bytes for signature verification.
// This must come before app.use(express.json()) or Stripe verification will fail.
// ─────────────────────────────────────────────
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

// ─────────────────────────────────────────────
// Standard JSON middleware for all other routes
// ─────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Health Check
// Used by monitoring tools and n8n to verify the server is alive.
// Returns the status of the DB and the last run time of each agent.
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  try {
    // Check DB is reachable
    db.prepare('SELECT 1').get();

    // Get last run for each agent
    const agentStatuses = db.prepare(`
      SELECT agent_name, run_at, status
      FROM agent_logs
      WHERE id IN (
        SELECT MAX(id) FROM agent_logs GROUP BY agent_name
      )
      ORDER BY run_at DESC
    `).all();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
      agents: agentStatuses,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// Webhook Routes
// ─────────────────────────────────────────────
app.post('/webhooks/lead', handleLeadWebhook);
app.post('/webhooks/onboarding', handleOnboardingWebhook);
app.post('/webhooks/lead-response', handleLeadResponse);

// ─────────────────────────────────────────────
// Agent Runner Endpoint
// n8n workflows POST to /run-agent/:name to trigger an agent.
// Protected by INTERNAL_TOKEN header to prevent unauthorized triggering.
//
// This allows n8n to be the cron trigger while keeping all business logic
// in this Node.js server (not n8n's function nodes).
// ─────────────────────────────────────────────

const AGENT_FILES = {
  scout: 'scout.js',
  scripter: 'scripter.js',
  larry: 'larry-sdr.js',
  analyst: 'analyst.js',
  cleo: 'cleo-onboarding.js',
  optimizer: 'optimizer.js',
};

app.post('/run-agent/:name', (req, res) => {
  // Verify internal auth token
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.INTERNAL_TOKEN}`;

  if (!process.env.INTERNAL_TOKEN || authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const agentName = req.params.name.toLowerCase();
  const agentFile = AGENT_FILES[agentName];

  if (!agentFile) {
    return res.status(404).json({
      error: `Unknown agent: ${agentName}`,
      available: Object.keys(AGENT_FILES),
    });
  }

  const args = req.body.args || [];
  const agentPath = path.join(__dirname, 'agents', agentFile);

  // Respond immediately — agent runs in background
  res.json({ status: 'started', agent: agentName, startedAt: new Date().toISOString() });

  // Fork the agent process
  const child = fork(agentPath, args, { env: process.env, detached: false });

  child.on('error', (err) => {
    console.error(`[server] Failed to start ${agentName}: ${err.message}`);
    logAgentRun(agentName, 'error', `Triggered via /run-agent, start failed: ${err.message}`);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[server] Agent ${agentName} exited with code ${code}`);
    }
  });

  console.log(`[server] Agent ${agentName} triggered via /run-agent`);
});

// ─────────────────────────────────────────────
// Dashboard API Routes
// These endpoints serve data to the Next.js dashboard.
// The dashboard can also read SQLite directly, but these routes
// allow for server-side logic (e.g. filtering, aggregation).
// ─────────────────────────────────────────────

// GET /api/leads — all leads with optional status filter
app.get('/api/leads', (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    let query = 'SELECT * FROM leads';
    const params = [];

    if (status === 'qualified') {
      query += ' WHERE qualified = 1 AND booked = 0';
    } else if (status === 'booked') {
      query += ' WHERE booked = 1';
    } else if (status === 'new') {
      query += ' WHERE qualified = 0';
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const leads = db.prepare(query).all(...params);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id — update lead status (used by dashboard Kanban)
app.patch('/api/leads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['qualified', 'booked', 'outcome', 'call_date'];
    const updates = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE leads SET ${fields} WHERE id = ?`).run(...Object.values(updates), id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scripts — today's scripts and recent top performers
app.get('/api/scripts', (req, res) => {
  try {
    const { date, top_only, limit = 20 } = req.query;
    let query = 'SELECT * FROM content_scripts';
    const params = [];

    if (date) {
      query += ' WHERE date = ?';
      params.push(date);
    } else if (top_only === 'true') {
      query += ' WHERE is_top_performer = 1';
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const scripts = db.prepare(query).all(...params);
    // Parse body JSON for each script
    const parsed = scripts.map(s => ({ ...s, body: JSON.parse(s.body || '[]') }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents — latest run status for all agents
app.get('/api/agents', (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT agent_name, run_at, status, output_summary
      FROM agent_logs
      WHERE id IN (SELECT MAX(id) FROM agent_logs GROUP BY agent_name)
      ORDER BY run_at DESC
    `).all();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients — all clients
app.get('/api/clients', (req, res) => {
  try {
    const clients = db.prepare('SELECT * FROM clients ORDER BY onboarded_at DESC').all();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/knowledge-base — all KB entries, optionally filtered by category
app.get('/api/knowledge-base', (req, res) => {
  try {
    const { category } = req.query;
    const query = category
      ? 'SELECT * FROM knowledge_base WHERE category = ? ORDER BY category, key'
      : 'SELECT * FROM knowledge_base ORDER BY category, key';
    const entries = category
      ? db.prepare(query).all(category)
      : db.prepare(query).all();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/knowledge-base/:id — update a KB entry (used by dashboard KB editor)
app.patch('/api/knowledge-base/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { value } = req.body;
    if (!value) return res.status(400).json({ error: 'value is required' });

    db.prepare(`UPDATE knowledge_base SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/performance — script performance data for charts
app.get('/api/performance', (req, res) => {
  try {
    const { days = 14 } = req.query;
    const data = db.prepare(`
      SELECT date, SUM(views) as views, SUM(likes) as likes, SUM(saves) as saves,
             SUM(shares) as shares, COUNT(*) as script_count,
             MAX(CASE WHEN is_top_performer = 1 THEN hook ELSE NULL END) as top_hook
      FROM content_scripts
      WHERE date >= date('now', ? || ' days')
        AND date IS NOT NULL
      GROUP BY date
      ORDER BY date ASC
    `).all(`-${days}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║       AdScale Labs — Server Up        ║
╠═══════════════════════════════════════╣
║  Port:      ${PORT}                       ║
║  DB:        ${process.env.DB_PATH || './data/adscale.db'}
║  Health:    http://localhost:${PORT}/health
╚═══════════════════════════════════════╝
  `);

  // Start all cron jobs
  registerJobs();
});

module.exports = app; // Export for testing
