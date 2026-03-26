/**
 * agents/optimizer.js
 * "Optimizer" — Self-Improvement Agent
 *
 * Runs weekly on Sunday at midnight.
 * Reviews everything that happened in the past week across all agents,
 * then updates the system to perform better next week.
 *
 * SAFETY CONSTRAINT: The Optimizer uses a hardcoded meta-prompt (not stored in KB).
 * This prevents the system from entering a self-modification loop where bad performance
 * data leads to worse prompts leads to worse data in an uncontrolled spiral.
 * Only Larry, Scout, Scripter, Analyst, and Cleo prompts can be rewritten.
 *
 * "Anything done twice gets an SOP, no exceptions."
 * The Optimizer detects repeated processes from agent logs and writes SOPs.
 *
 * Outputs:
 * - Updated prompts in knowledge_base (category='prompts')
 * - New/updated SOPs in sops table
 * - Weekly performance report in knowledge_base (category='reports')
 *
 * Usage:
 *   node agents/optimizer.js           → full weekly run
 *   node agents/optimizer.js --dry-run → analysis without DB writes
 */

'use strict';

require('dotenv').config();
const { db, setKB, getKB, upsertSOP, logAgentRun } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────
// HARDCODED META-PROMPT
// This prompt is NOT stored in the knowledge_base and CANNOT be rewritten
// by the Optimizer itself. This is a deliberate safety constraint.
// ─────────────────────────────────────────────

const OPTIMIZER_META_PROMPT = `You are the Optimizer agent for AdScale Labs — an AI automation agency.

Your job is to review the past week's performance data and improve the system for next week.

You have access to:
1. Agent run logs (what each agent did, success/error)
2. Content performance data (which scripts performed best)
3. Lead pipeline data (qualification rate, booking rate, close rate)
4. Current prompt templates for all agents

YOUR OUTPUT FORMAT:
Return a JSON object with exactly this structure:
{
  "prompt_updates": [
    {
      "key": "prompt_key_name",
      "new_value": "The complete new system prompt text",
      "reason": "Why this prompt needs to change based on the data"
    }
  ],
  "sop_updates": [
    {
      "process_name": "snake_case_process_name",
      "steps": ["Step 1", "Step 2", "Step 3"],
      "reason": "Why this SOP was created or updated"
    }
  ],
  "weekly_report": "A markdown-formatted weekly performance report",
  "key_learnings": ["Learning 1", "Learning 2", "Learning 3"]
}

RULES:
1. Only suggest prompt updates that are directly supported by the performance data
2. If a metric is improving, do NOT change that prompt — leave what is working alone
3. SOPs should be created for any process that has now occurred 2+ times
4. The weekly_report should be honest about what did NOT work, not just highlights
5. If there is not enough data to make an informed change, say so — do not hallucinate improvements
6. You CANNOT modify the Optimizer's own prompt (it is not in the KB — you simply do not have access to it)

Be specific and data-driven. Vague suggestions like "improve the hook" are not acceptable. Say exactly what should change and why.`;

// ─────────────────────────────────────────────
// Gather Performance Data
// Reads all relevant data from the past 7 days.
// ─────────────────────────────────────────────

function gatherWeeklyData() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Agent run logs
  const agentLogs = db.prepare(`
    SELECT agent_name, run_at, status, output_summary
    FROM agent_logs
    WHERE run_at >= ?
    ORDER BY run_at DESC
  `).all(sevenDaysAgo);

  // Content performance
  const contentPerformance = db.prepare(`
    SELECT type, hook, format, angle, views, likes, saves, shares, is_top_performer, date
    FROM content_scripts
    WHERE created_at >= ? AND views > 0
    ORDER BY (saves * 40 + shares * 30 + likes * 20 + views * 10) DESC
  `).all(sevenDaysAgo);

  // Lead pipeline stats
  const leadStats = db.prepare(`
    SELECT
      COUNT(*) as total_leads,
      SUM(qualified) as qualified_count,
      SUM(booked) as booked_count,
      SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END) as lost_count
    FROM leads
    WHERE created_at >= ?
  `).get(sevenDaysAgo);

  // Current prompts
  const prompts = db.prepare(`
    SELECT key, value, updated_at
    FROM knowledge_base
    WHERE category = 'prompts'
    ORDER BY key
  `).all();

  // Error summary
  const errorLogs = agentLogs.filter(l => l.status === 'error');

  return {
    agentLogs,
    contentPerformance,
    leadStats,
    prompts,
    errorLogs,
    weekStart: sevenDaysAgo,
    weekEnd: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Format Data for Claude
// Condenses the raw data into a readable summary for the analysis prompt.
// ─────────────────────────────────────────────

function formatDataForClaude(data) {
  const { agentLogs, contentPerformance, leadStats, prompts, errorLogs } = data;

  // Agent reliability
  const agentSummary = {};
  agentLogs.forEach(log => {
    if (!agentSummary[log.agent_name]) {
      agentSummary[log.agent_name] = { runs: 0, errors: 0, last_status: log.status };
    }
    agentSummary[log.agent_name].runs++;
    if (log.status === 'error') agentSummary[log.agent_name].errors++;
  });

  // Content performance summary
  const topContent = contentPerformance.slice(0, 5).map(s => ({
    hook: s.hook.substring(0, 80),
    type: s.type,
    format: s.format,
    saves: s.saves,
    views: s.views,
    top: s.is_top_performer === 1,
  }));

  const bottomContent = contentPerformance.slice(-3).map(s => ({
    hook: s.hook.substring(0, 80),
    type: s.type,
    saves: s.saves,
    views: s.views,
  }));

  return `WEEKLY PERFORMANCE DATA — ${data.weekStart.split('T')[0]} to ${data.weekEnd.split('T')[0]}

AGENT RELIABILITY:
${Object.entries(agentSummary).map(([name, stats]) =>
  `${name}: ${stats.runs} runs, ${stats.errors} errors (${stats.last_status})`
).join('\n')}

ERRORS THIS WEEK (${errorLogs.length} total):
${errorLogs.slice(0, 5).map(e => `- [${e.agent_name}] ${e.output_summary}`).join('\n') || 'None'}

LEAD PIPELINE (7 days):
- New leads: ${leadStats?.total_leads || 0}
- Qualified: ${leadStats?.qualified_count || 0} (${leadStats?.total_leads ? Math.round(leadStats.qualified_count / leadStats.total_leads * 100) : 0}%)
- Booked: ${leadStats?.booked_count || 0} (${leadStats?.qualified_count ? Math.round(leadStats.booked_count / leadStats.qualified_count * 100) : 0}% of qualified)
- Won: ${leadStats?.won_count || 0}
- Lost: ${leadStats?.lost_count || 0}

CONTENT PERFORMANCE — TOP 5:
${topContent.map((s, i) => `${i + 1}. [${s.type}] "${s.hook}" | ${s.saves} saves, ${s.views} views | Format: ${s.format} ${s.top ? '← TOP' : ''}`).join('\n')}

CONTENT PERFORMANCE — BOTTOM 3:
${bottomContent.map(s => `- [${s.type}] "${s.hook}" | ${s.saves} saves, ${s.views} views`).join('\n') || 'No underperforming content data'}

CURRENT PROMPT KEYS (available to rewrite):
${prompts.map(p => `- ${p.key} (last updated: ${p.updated_at})`).join('\n')}`;
}

// ─────────────────────────────────────────────
// Apply Optimizer Output
// Takes Claude's JSON response and applies all changes to the DB.
// ─────────────────────────────────────────────

function applyOptimizations(optimizerOutput, weekLabel) {
  const { prompt_updates, sop_updates, weekly_report, key_learnings } = optimizerOutput;
  let promptsUpdated = 0;
  let sopsUpdated = 0;

  // Update prompts in knowledge_base
  if (Array.isArray(prompt_updates)) {
    for (const update of prompt_updates) {
      if (update.key && update.new_value) {
        setKB('prompts', update.key, update.new_value);
        console.log(`[optimizer] Updated prompt: ${update.key} — ${update.reason}`);
        promptsUpdated++;
      }
    }
  }

  // Create/update SOPs
  if (Array.isArray(sop_updates)) {
    for (const sop of sop_updates) {
      if (sop.process_name && Array.isArray(sop.steps)) {
        upsertSOP(sop.process_name, sop.steps);
        console.log(`[optimizer] SOP upserted: ${sop.process_name}`);
        sopsUpdated++;
      }
    }
  }

  // Store weekly report
  if (weekly_report) {
    setKB('reports', `weekly_${weekLabel}`, weekly_report);
  }

  // Store key learnings
  if (Array.isArray(key_learnings) && key_learnings.length > 0) {
    const existingLearnings = JSON.parse(getKB('optimizer', 'all_learnings') || '[]');
    const newLearnings = [
      ...existingLearnings,
      ...key_learnings.map(l => ({ learning: l, week: weekLabel, date: new Date().toISOString() })),
    ].slice(-100); // Keep last 100 learnings
    setKB('optimizer', 'all_learnings', JSON.stringify(newLearnings));
  }

  return { promptsUpdated, sopsUpdated };
}

// ─────────────────────────────────────────────
// Main Run Function
// ─────────────────────────────────────────────

async function run() {
  console.log(`[optimizer] Starting weekly optimization run${isDryRun ? ' (DRY RUN)' : ''}...`);
  const startTime = Date.now();

  // 1. Gather all performance data from the past week
  const weeklyData = gatherWeeklyData();
  const formattedData = formatDataForClaude(weeklyData);

  console.log(`[optimizer] Data gathered: ${weeklyData.agentLogs.length} agent logs, ${weeklyData.contentPerformance.length} content items`);

  // 2. Run Claude analysis (using HARDCODED prompt — not from KB)
  let optimizerOutput;
  try {
    const response = await callClaude(
      OPTIMIZER_META_PROMPT, // Hardcoded — cannot be rewritten
      formattedData,
      { maxTokens: 4000 } // No promptKey — Optimizer does not look up its own prompt
    );
    optimizerOutput = parseJSON(response);
  } catch (err) {
    const summary = `Optimizer analysis failed: ${err.message}`;
    console.error(`[optimizer] ${summary}`);
    logAgentRun('optimizer', 'error', summary);
    return;
  }

  // 3. Determine week label for report storage (e.g. "2026-W12")
  const now = new Date();
  const weekNum = Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
  const weekLabel = `${now.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;

  // 4. Apply or preview the changes
  if (!isDryRun) {
    const { promptsUpdated, sopsUpdated } = applyOptimizations(optimizerOutput, weekLabel);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Optimizer run in ${duration}s. ${promptsUpdated} prompts updated, ${sopsUpdated} SOPs upserted. Weekly report stored: ${weekLabel}.`;
    logAgentRun('optimizer', 'success', summary);
    console.log(`[optimizer] ${summary}`);
  } else {
    console.log('[DRY RUN] Optimizer would apply:');
    console.log(`  Prompt updates: ${(optimizerOutput.prompt_updates || []).length}`);
    console.log(`  SOP updates: ${(optimizerOutput.sop_updates || []).length}`);
    console.log('\nWeekly report preview:');
    console.log((optimizerOutput.weekly_report || '').substring(0, 500) + '...');
    console.log('\nKey learnings:');
    (optimizerOutput.key_learnings || []).forEach(l => console.log(`  - ${l}`));
  }
}

// Run if called directly
if (require.main === module) {
  run().catch(err => {
    console.error('[optimizer] Fatal error:', err);
    logAgentRun('optimizer', 'error', err.message);
    process.exit(1);
  });
}

module.exports = { run };
