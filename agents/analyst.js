/**
 * agents/analyst.js
 * "Analyst" — Content Performance Agent
 *
 * Runs daily at 8 PM.
 * Pulls Instagram Reel metrics for posted content, identifies the top performer,
 * updates the knowledge base, and flags the top performer so Scripter
 * knows what to replicate tomorrow.
 *
 * Requires: IG_ACCESS_TOKEN and IG_USER_ID environment variables.
 * Without these, Analyst runs in simulation mode using DB data only.
 *
 * Usage:
 *   node agents/analyst.js           → full run
 *   node agents/analyst.js --dry-run → reads + analyzes but does not write to DB
 */

'use strict';

require('dotenv').config();
const axios = require('axios');
const { db, setKB, logAgentRun, getKB } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');

const IG_API_BASE = 'https://graph.instagram.com';

// ─────────────────────────────────────────────
// Fetch Metrics from Instagram Basic Display API
// Returns metrics for all media the account has posted.
// Filters to only Reels (VIDEO type).
// ─────────────────────────────────────────────

async function fetchInstagramMetrics() {
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    console.warn('[analyst] IG_ACCESS_TOKEN or IG_USER_ID not set — using simulation mode');
    return null;
  }

  try {
    // Get the list of media from the account
    const mediaResp = await axios.get(`${IG_API_BASE}/${process.env.IG_USER_ID}/media`, {
      params: {
        fields: 'id,media_type,timestamp,permalink',
        access_token: process.env.IG_ACCESS_TOKEN,
        limit: 20,
      },
      timeout: 10000,
    });

    const mediaItems = mediaResp.data?.data || [];
    const reels = mediaItems.filter(m => m.media_type === 'VIDEO');

    if (reels.length === 0) {
      console.log('[analyst] No video/reel content found in account');
      return [];
    }

    // Fetch insights for each reel
    const metrics = [];
    for (const reel of reels.slice(0, 10)) { // Max 10 reels per run to stay within rate limits
      try {
        const insightsResp = await axios.get(`${IG_API_BASE}/${reel.id}/insights`, {
          params: {
            metric: 'impressions,reach,likes,comments,saved,shares',
            access_token: process.env.IG_ACCESS_TOKEN,
          },
          timeout: 8000,
        });

        const data = insightsResp.data?.data || [];
        const metricMap = {};
        data.forEach(m => { metricMap[m.name] = m.values?.[0]?.value || 0; });

        metrics.push({
          ig_media_id: reel.id,
          permalink: reel.permalink,
          timestamp: reel.timestamp,
          views: metricMap.impressions || metricMap.reach || 0,
          likes: metricMap.likes || 0,
          saves: metricMap.saved || 0,
          shares: metricMap.shares || 0,
          comments: metricMap.comments || 0,
        });
      } catch (err) {
        console.warn(`[analyst] Could not fetch insights for reel ${reel.id}: ${err.message}`);
      }
    }

    console.log(`[analyst] Fetched metrics for ${metrics.length} reels`);
    return metrics;

  } catch (err) {
    console.error(`[analyst] Instagram API error: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// Match Instagram metrics to content_scripts rows
// Matches by reel_url (permalink) or by date proximity.
// ─────────────────────────────────────────────

function matchMetricsToScripts(igMetrics) {
  if (!igMetrics || igMetrics.length === 0) return [];

  const matches = [];
  for (const metric of igMetrics) {
    // Try to match by permalink stored in reel_url
    let script = null;
    if (metric.permalink) {
      script = db.prepare('SELECT * FROM content_scripts WHERE reel_url = ?').get(metric.permalink);
    }

    // If no match by URL, try matching by date (same day as IG post timestamp)
    if (!script && metric.timestamp) {
      const postDate = metric.timestamp.split('T')[0];
      script = db.prepare('SELECT * FROM content_scripts WHERE date = ? AND reel_url IS NULL LIMIT 1').get(postDate);
    }

    if (script) {
      matches.push({ script, metric });
    }
  }

  return matches;
}

// ─────────────────────────────────────────────
// Flag Top Performer
// Uses a weighted score: saves (40%) + shares (30%) + likes (20%) + views (10%)
// The top performer gets is_top_performer = 1.
// All others get is_top_performer = 0 (reset daily).
// ─────────────────────────────────────────────

function scoreScript(script) {
  return (script.saves * 40) + (script.shares * 30) + (script.likes * 20) + (script.views * 10);
}

async function identifyAndFlagTopPerformer() {
  // Get all scripts with at least some metrics from the last 30 days
  const scripts = db.prepare(`
    SELECT * FROM content_scripts
    WHERE views > 0 AND date >= date('now', '-30 days')
    ORDER BY created_at DESC
  `).all();

  if (scripts.length === 0) {
    console.log('[analyst] No scripts with metrics to evaluate');
    return null;
  }

  // Score all scripts
  const scored = scripts.map(s => ({ ...s, score: scoreScript(s) }));
  scored.sort((a, b) => b.score - a.score);

  const topPerformer = scored[0];

  // Ask Claude to explain WHY it outperformed (stored in KB for Scripter context)
  let whyAnalysis = null;
  try {
    const systemPrompt = getKB('prompts', 'analyst_flagging') ||
      'You are Analyst. Identify the top performing content and explain why it worked.';

    const response = await callClaude(systemPrompt, JSON.stringify({
      top_performer: { hook: topPerformer.hook, body: JSON.parse(topPerformer.body || '[]'), format: topPerformer.format, saves: topPerformer.saves, views: topPerformer.views },
      all_performers: scored.slice(0, 5).map(s => ({ hook: s.hook, saves: s.saves, views: s.views })),
    }), { promptKey: 'analyst_flagging', maxTokens: 500 });

    whyAnalysis = parseJSON(response);
  } catch (err) {
    console.warn(`[analyst] Could not get Claude analysis: ${err.message}`);
  }

  if (!isDryRun) {
    // Reset all top performer flags
    db.prepare('UPDATE content_scripts SET is_top_performer = 0').run();
    // Set the new top performer
    db.prepare('UPDATE content_scripts SET is_top_performer = 1 WHERE id = ?').run(topPerformer.id);

    // Store top performer details in KB so Scripter can read it
    setKB('performance', 'top_performer', JSON.stringify({
      id: topPerformer.id,
      hook: topPerformer.hook,
      body: JSON.parse(topPerformer.body || '[]'),
      cta: topPerformer.cta,
      format: topPerformer.format,
      angle: topPerformer.angle,
      score: topPerformer.score,
      saves: topPerformer.saves,
      views: topPerformer.views,
      why_it_worked: whyAnalysis?.why_it_worked || '',
      replicate_elements: whyAnalysis?.replicate_elements || [],
    }));
  }

  return topPerformer;
}

// ─────────────────────────────────────────────
// Generate Monthly Outlier Report
// Runs on the last day of each month.
// Top 10 reels by weighted score, stored in KB for Scripter's monthly context.
// ─────────────────────────────────────────────

function generateMonthlyReport() {
  const today = new Date();
  // Run on the last day of the month
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (tomorrow.getMonth() === today.getMonth()) return; // Not the last day

  const outliers = db.prepare(`
    SELECT id, hook, body, cta, format, angle, saves, views, likes, shares, date
    FROM content_scripts
    WHERE saves > 0
    ORDER BY (saves * 40 + shares * 30 + likes * 20 + views * 10) DESC
    LIMIT 10
  `).all();

  if (outliers.length === 0) return;

  const report = {
    generated_at: today.toISOString(),
    month: today.toISOString().substring(0, 7),
    top_10_outliers: outliers.map(o => ({
      hook: o.hook,
      angle: o.angle,
      format: o.format,
      saves: o.saves,
      views: o.views,
      score: scoreScript(o),
    })),
  };

  if (!isDryRun) {
    setKB('reports', `monthly_outliers_${report.month}`, JSON.stringify(report));
    console.log(`[analyst] Monthly outlier report stored for ${report.month}`);
  }
}

// ─────────────────────────────────────────────
// Main Run Function
// ─────────────────────────────────────────────

async function run() {
  console.log(`[analyst] Starting${isDryRun ? ' (DRY RUN)' : ''}...`);
  const startTime = Date.now();

  // 1. Fetch Instagram metrics
  const igMetrics = await fetchInstagramMetrics();

  // 2. If we got real IG metrics, update the DB
  if (igMetrics && igMetrics.length > 0) {
    const matches = matchMetricsToScripts(igMetrics);
    console.log(`[analyst] Matched ${matches.length} IG posts to content_scripts`);

    if (!isDryRun) {
      const updateScript = db.prepare(`
        UPDATE content_scripts
        SET views = ?, likes = ?, saves = ?, shares = ?, reel_url = ?
        WHERE id = ?
      `);

      const updateAll = db.transaction((matches) => {
        for (const { script, metric } of matches) {
          updateScript.run(metric.views, metric.likes, metric.saves, metric.shares, metric.permalink, script.id);
        }
      });

      updateAll(matches);
    }
  } else {
    // Simulation mode: use whatever data is already in DB
    console.log('[analyst] Using existing DB metrics (no live IG data)');
  }

  // 3. Identify and flag top performer
  const topPerformer = await identifyAndFlagTopPerformer();

  // 4. Generate monthly report if applicable
  generateMonthlyReport();

  // 5. Update last run timestamp in KB
  if (!isDryRun) {
    setKB('performance', 'last_analyst_run', new Date().toISOString());
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = topPerformer
    ? `Analyst run in ${duration}s. Top performer flagged: "${topPerformer.hook?.substring(0, 60)}..." (${topPerformer.saves} saves, ${topPerformer.views} views)`
    : `Analyst run in ${duration}s. No top performer identified (insufficient metrics).`;

  if (!isDryRun) {
    logAgentRun('analyst', 'success', summary);
  }
  console.log(`[analyst] ${summary}`);
}

// Run if called directly
if (require.main === module) {
  run().catch(err => {
    console.error('[analyst] Fatal error:', err);
    logAgentRun('analyst', 'error', err.message);
    process.exit(1);
  });
}

module.exports = { run };
