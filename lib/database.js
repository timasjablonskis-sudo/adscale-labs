/**
 * lib/database.js
 * Central database module for AdScale Labs.
 * Uses better-sqlite3 — all operations are synchronous (no async/await needed).
 * Opens the database, creates all 7 tables if they don't exist, and enables WAL mode.
 *
 * WAL (Write-Ahead Logging) mode allows the Next.js dashboard to read the DB
 * even while an agent is writing, preventing lock errors.
 *
 * Exports: db (raw connection) + helper functions used by all agents.
 */

'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Resolve database path from env, defaulting to ./data/adscale.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'adscale.db');

// Ensure the data directory exists before opening the database
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Open (or create) the SQLite database file
const db = new Database(DB_PATH);

// Enable WAL mode for concurrent read access from the dashboard
db.pragma('journal_mode = WAL');
// Enable foreign key enforcement
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────
// Schema: create all 7 tables if they don't exist
// ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    ig_handle TEXT,
    source TEXT,
    qualified INTEGER DEFAULT 0,
    booked INTEGER DEFAULT 0,
    call_date TEXT,
    outcome TEXT,
    qualification_answers TEXT,
    follow_up_count INTEGER DEFAULT 0,
    last_contact TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('top_of_funnel', 'middle_of_funnel')),
    hook TEXT NOT NULL,
    body TEXT NOT NULL,
    cta TEXT,
    format TEXT,
    angle TEXT,
    predicted_audience TEXT,
    date TEXT,
    reel_url TEXT,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    is_top_performer INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    topic TEXT,
    angle TEXT,
    niche_origin TEXT,
    date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    payment_tier TEXT,
    brand_doc TEXT,
    social_accounts TEXT,
    onboarding_answers TEXT,
    objections TEXT,
    why_bought TEXT,
    sold_at_point TEXT,
    fears TEXT,
    onboarded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE TABLE IF NOT EXISTS sops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_name TEXT NOT NULL UNIQUE,
    steps TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL,
    run_at TEXT DEFAULT (datetime('now')),
    status TEXT CHECK(status IN ('success', 'error', 'dry_run')),
    output_summary TEXT
  );
`);

// ─────────────────────────────────────────────
// Schema Migration: add new columns to clients table
// SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we check
// existing columns via PRAGMA and only add missing ones.
// ─────────────────────────────────────────────
(function runMigrations() {
  const existingCols = db.prepare('PRAGMA table_info(clients)').all().map(c => c.name);

  const newColumns = [
    { name: 'engines_activated',      type: 'TEXT' },
    { name: 'addons_activated',       type: 'TEXT' },
    { name: 'reputation_engine',      type: 'INTEGER DEFAULT 0' },
    { name: 'onboarding_status',      type: "TEXT DEFAULT 'form_sent'" },
    { name: 'brand_doc_pdf_url',      type: 'TEXT' },
    { name: 'monthly_rate',           type: 'INTEGER' },
    { name: 'setup_fee',              type: 'INTEGER' },
    { name: 'phone',                  type: 'TEXT' },
    { name: 'locations',              type: 'TEXT' },
    { name: 'priority_launch_channel', type: 'TEXT' },
  ];

  for (const col of newColumns) {
    if (!existingCols.includes(col.name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${col.name} ${col.type}`);
      console.log(`[db] Migration: added clients.${col.name}`);
    }
  }
})();

// ─────────────────────────────────────────────
// Helper: Knowledge Base
// The knowledge_base table stores all shared config, prompts, and learnings.
// All agents read from and write to it through these two functions.
// ─────────────────────────────────────────────

/**
 * Read a single value from the knowledge base.
 * @param {string} category - e.g. 'prompts', 'config', 'scout'
 * @param {string} key - e.g. 'larry_qualification_1', 'brand_voice'
 * @returns {string|null} The stored value, or null if not found
 */
function getKB(category, key) {
  const row = db.prepare(
    'SELECT value FROM knowledge_base WHERE category = ? AND key = ?'
  ).get(category, key);
  return row ? row.value : null;
}

/**
 * Write (insert or update) a value in the knowledge base.
 * Uses INSERT OR REPLACE so it acts as an upsert.
 * @param {string} category - e.g. 'prompts', 'config'
 * @param {string} key - the key name
 * @param {string} value - string value (JSON.stringify objects before passing)
 */
function setKB(category, key, value) {
  db.prepare(`
    INSERT INTO knowledge_base (category, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(category, key, value);
}

// ─────────────────────────────────────────────
// Helper: Agent Logging
// Every agent must call logAgentRun at the end of its execution.
// The dashboard reads agent_logs to show the "Agent Status" panel.
// ─────────────────────────────────────────────

/**
 * Log an agent run to the agent_logs table.
 * @param {string} agentName - e.g. 'scout', 'larry-sdr'
 * @param {'success'|'error'|'dry_run'} status
 * @param {string} summary - short human-readable description of what happened
 */
function logAgentRun(agentName, status, summary) {
  db.prepare(`
    INSERT INTO agent_logs (agent_name, status, output_summary)
    VALUES (?, ?, ?)
  `).run(agentName, status, summary);
}

// ─────────────────────────────────────────────
// Helper: SOPs
// The Optimizer agent creates and updates SOPs.
// "Anything done twice gets an SOP, no exceptions."
// ─────────────────────────────────────────────

/**
 * Get the current SOP for a process.
 * @param {string} processName - e.g. 'lead_qualification'
 * @returns {object|null} { id, process_name, steps (parsed), version } or null
 */
function getSOP(processName) {
  const row = db.prepare('SELECT * FROM sops WHERE process_name = ?').get(processName);
  if (!row) return null;
  return { ...row, steps: JSON.parse(row.steps) };
}

/**
 * Create or update an SOP. Increments version on update.
 * @param {string} processName - unique name for the process
 * @param {string[]} steps - array of step descriptions
 */
function upsertSOP(processName, steps) {
  const existing = db.prepare('SELECT version FROM sops WHERE process_name = ?').get(processName);
  if (existing) {
    db.prepare(`
      UPDATE sops SET steps = ?, version = ?, updated_at = datetime('now')
      WHERE process_name = ?
    `).run(JSON.stringify(steps), existing.version + 1, processName);
  } else {
    db.prepare(`
      INSERT INTO sops (process_name, steps) VALUES (?, ?)
    `).run(processName, JSON.stringify(steps));
  }
}

// ─────────────────────────────────────────────
// Helper: Leads
// ─────────────────────────────────────────────

/**
 * Insert a new lead into the database.
 * @param {object} lead - { name, email, ig_handle, source }
 * @returns {number} The new lead's id
 */
function insertLead(lead) {
  const result = db.prepare(`
    INSERT INTO leads (name, email, ig_handle, source)
    VALUES (?, ?, ?, ?)
  `).run(lead.name, lead.email, lead.ig_handle || null, lead.source || null);
  return result.lastInsertRowid;
}

/**
 * Update a lead's qualification answers and follow-up count.
 * @param {number} id - lead id
 * @param {object} updates - fields to update
 */
function updateLead(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE leads SET ${fields} WHERE id = ?`).run(...values);
}

/**
 * Get leads that need follow-up:
 * not yet qualified, fewer than 3 follow-up touches, and last contact was over 24h ago.
 */
function getLeadsNeedingFollowUp() {
  return db.prepare(`
    SELECT * FROM leads
    WHERE qualified = 0
      AND follow_up_count < 3
      AND (last_contact IS NULL OR last_contact < datetime('now', '-1 day'))
    ORDER BY created_at ASC
  `).all();
}

module.exports = {
  db,
  getKB,
  setKB,
  logAgentRun,
  getSOP,
  upsertSOP,
  insertLead,
  updateLead,
  getLeadsNeedingFollowUp,
};
