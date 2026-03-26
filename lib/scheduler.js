/**
 * lib/scheduler.js
 * Cron job manager for AdScale Labs.
 *
 * Registers all recurring agent jobs using node-cron.
 * Called by server.js at startup.
 *
 * Schedule overview:
 * - 6:00 AM daily    → Scout (research + competitor analysis)
 * - 7:00 AM daily    → Scripter (generate today's 5 scripts — after Scout)
 * - 8:00 PM daily    → Analyst (pull Instagram metrics for posted content)
 * - 9:00 AM daily    → Larry follow-ups (first daily touch window)
 * - 5:00 PM daily    → Larry follow-ups (second daily touch window)
 * - Sunday midnight  → Optimizer (weekly self-improvement run)
 *
 * All agents are run as forked child processes using child_process.fork().
 * Fork is preferred over exec() because:
 * - Shares the same Node.js installation
 * - Can send IPC messages if needed
 * - Process is fully isolated (a crash does not kill the server)
 *
 * Each fork is wrapped in error handling and logged to agent_logs.
 */

'use strict';

const cron = require('node-cron');
const { fork } = require('child_process');
const path = require('path');
const { logAgentRun } = require('./database');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');

/**
 * Fork an agent script as a child process.
 * @param {string} agentFile - filename within agents/ directory (e.g. 'scout.js')
 * @param {string[]} args - additional CLI arguments (e.g. ['--mode=followup'])
 */
function forkAgent(agentFile, args = []) {
  const agentPath = path.join(AGENTS_DIR, agentFile);
  const agentName = agentFile.replace('.js', '');

  console.log(`[scheduler] Starting ${agentName}...`);

  const child = fork(agentPath, args, {
    // Pass the parent's environment variables to the child process
    env: process.env,
    // Detached: false — we want to wait for the child, not daemonize it
    detached: false,
  });

  // Handle child process errors (e.g. script file not found)
  child.on('error', (err) => {
    console.error(`[scheduler] Failed to start ${agentName}: ${err.message}`);
    logAgentRun(agentName, 'error', `Process start failed: ${err.message}`);
  });

  // Log when the agent finishes
  child.on('exit', (code, signal) => {
    if (code === 0) {
      console.log(`[scheduler] ${agentName} completed successfully`);
    } else if (signal) {
      console.warn(`[scheduler] ${agentName} killed by signal ${signal}`);
      logAgentRun(agentName, 'error', `Process killed by signal: ${signal}`);
    } else {
      console.error(`[scheduler] ${agentName} exited with code ${code}`);
      logAgentRun(agentName, 'error', `Process exited with code ${code}`);
    }
  });

  return child;
}

/**
 * Register all cron jobs.
 * Call this once at server startup.
 */
function registerJobs() {
  console.log('[scheduler] Registering cron jobs...');

  // ── Scout: 6:00 AM daily ──────────────────────────
  // Scrapes Twitter trends and competitor Instagram content.
  // Must run before Scripter so scripts are based on fresh research.
  cron.schedule('0 6 * * *', () => {
    forkAgent('scout.js');
  }, { timezone: 'America/New_York' });

  // ── Scripter: 7:00 AM daily ───────────────────────
  // Generates 5 reel scripts using Scout's output.
  // 1-hour gap after Scout gives it time to finish.
  cron.schedule('0 7 * * *', () => {
    forkAgent('scripter.js');
  }, { timezone: 'America/New_York' });

  // ── Analyst: 8:00 PM daily ────────────────────────
  // Pulls Instagram metrics for all content posted today/recently.
  // Runs in the evening when daily posting is done.
  cron.schedule('0 20 * * *', () => {
    forkAgent('analyst.js');
  }, { timezone: 'America/New_York' });

  // ── Larry Follow-ups: 9:00 AM daily ──────────────
  // First touch window — catches leads from the night before.
  cron.schedule('0 9 * * *', () => {
    forkAgent('larry-sdr.js', ['--mode=followup']);
  }, { timezone: 'America/New_York' });

  // ── Larry Follow-ups: 5:00 PM daily ──────────────
  // Second touch window — catches leads from the workday.
  cron.schedule('0 17 * * *', () => {
    forkAgent('larry-sdr.js', ['--mode=followup']);
  }, { timezone: 'America/New_York' });

  // ── Optimizer: Sunday 12:00 AM weekly ────────────
  // Reviews all performance data, rewrites prompts, generates SOPs and weekly report.
  cron.schedule('0 0 * * 0', () => {
    forkAgent('optimizer.js');
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] All cron jobs registered:');
  console.log('  - Scout:      6:00 AM daily (ET)');
  console.log('  - Scripter:   7:00 AM daily (ET)');
  console.log('  - Analyst:    8:00 PM daily (ET)');
  console.log('  - Larry FU:   9:00 AM + 5:00 PM daily (ET)');
  console.log('  - Optimizer:  Sunday midnight (ET)');
}

module.exports = { registerJobs, forkAgent };
