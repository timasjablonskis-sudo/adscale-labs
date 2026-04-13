/**
 * agents/scripter.js
 * "Scripter" — Content Generation Agent
 *
 * Runs daily at 7 AM (1 hour after Scout).
 * Reads Scout's latest research output and yesterday's top-performing script,
 * then uses Claude to generate 5 new reel scripts (3 MOF + 2 TOF).
 *
 * Key behaviors:
 * - If there is a top performer from yesterday, creates 3 variations of it + 2 new ideas
 * - If no top performer, creates 3 MOF + 2 TOF based on Scout research
 * - Monthly: pulls top 10 outlier reels and feeds them into context (on the 1st of each month)
 *
 * Output: 5 rows inserted into content_scripts table, status logged to agent_logs.
 *
 * Usage:
 *   node agents/scripter.js           → full run
 *   node agents/scripter.js --dry-run → generates and logs but does not write to DB
 */

'use strict';

require('dotenv').config();
const { db, logAgentRun, getKB } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────
// Get Yesterday's Top Performer
// Scripter uses the top performer to create variations.
// "Replicating what works" is the core content strategy.
// ─────────────────────────────────────────────

function getTopPerformer() {
  // Look for a top performer flagged in the last 3 days
  const performer = db.prepare(`
    SELECT * FROM content_scripts
    WHERE is_top_performer = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  return performer ? {
    ...performer,
    body: JSON.parse(performer.body || '[]'),
  } : null;
}

// ─────────────────────────────────────────────
// Get Monthly Outlier Context (runs on the 1st of each month)
// The top 10 all-time performers feed into this month's scripting context.
// ─────────────────────────────────────────────

function getMonthlyOutliers() {
  const today = new Date();
  if (today.getDate() !== 1) return []; // Only on the 1st

  const outliers = db.prepare(`
    SELECT hook, body, cta, format, angle, saves, views
    FROM content_scripts
    WHERE saves > 0
    ORDER BY (saves * 40 + shares * 30 + likes * 20 + views * 10) DESC
    LIMIT 10
  `).all();

  return outliers.map(o => ({ ...o, body: JSON.parse(o.body || '[]') }));
}

// ─────────────────────────────────────────────
// Generate Scripts with Claude
// Passes Scout's research, top performer data, and brand context.
// Returns 5 script objects in the defined schema.
// ─────────────────────────────────────────────

async function generateScripts(scoutData, topPerformer, brandVoice, outliers) {
  const systemPrompt = getKB('prompts', 'scripter_generate') ||
    'You are Scripter, content generation agent for AdScale Labs. Generate 5 Instagram Reel scripts.';

  const topPerformerContext = topPerformer
    ? `YESTERDAY'S TOP PERFORMER (replicate the angle/format for 3 of the 5 scripts):
Hook: ${topPerformer.hook}
Body: ${topPerformer.body.join(' | ')}
CTA: ${topPerformer.cta}
Format: ${topPerformer.format}
Angle: ${topPerformer.angle}
Performance: ${topPerformer.saves} saves, ${topPerformer.views} views`
    : 'No top performer data available — generate 5 original scripts.';

  const outlierContext = outliers.length > 0
    ? `\nMONTHLY TOP PERFORMERS (use these as strategic context for the month):
${outliers.map(o => `- Hook: "${o.hook}" | ${o.saves} saves, ${o.views} views`).join('\n')}`
    : '';

  const userMessage = `Generate 5 Instagram Reel scripts for AdScale Labs.

BRAND VOICE:
${typeof brandVoice === 'string' ? brandVoice : JSON.stringify(brandVoice)}

${topPerformerContext}
${outlierContext}

TODAY'S RESEARCH FROM SCOUT:
Trending topics: ${(scoutData?.trending_topics || []).join(', ')}
Recommended content ideas:
${(scoutData?.recommended_content_ideas || []).slice(0, 5).map(i =>
  `- ${i.hook_suggestion || i.topic} (angle: ${i.angle})`
).join('\n')}

Script mix required:
- 3 MIDDLE-OF-FUNNEL (specific results, case studies, how-tos, for people already considering AI)
- 2 TOP-OF-FUNNEL (broad pain points, curiosity, for people who have never heard of AI automation)

Return the JSON array of 5 scripts.`;

  const response = await callClaude(systemPrompt, userMessage, {
    promptKey: 'scripter_generate',
    maxTokens: 4000,
  });

  return parseJSON(response);
}

// ─────────────────────────────────────────────
// Main Run Function
// ─────────────────────────────────────────────

async function run() {
  console.log(`[scripter] Starting${isDryRun ? ' (DRY RUN)' : ''}...`);
  const startTime = Date.now();

  // 1. Read Scout's latest research from knowledge base
  const scoutDataRaw = getKB('scout', 'latest_ideas');
  let scoutData = {};
  if (scoutDataRaw) {
    try {
      scoutData = JSON.parse(scoutDataRaw);
    } catch {
      console.warn('[scripter] Could not parse Scout data from KB — proceeding with empty context');
    }
  } else {
    console.warn('[scripter] No Scout data found in KB — has Scout run today?');
  }

  // 2. Get yesterday's top performer
  const topPerformer = getTopPerformer();
  if (topPerformer) {
    console.log(`[scripter] Top performer found: "${topPerformer.hook.substring(0, 60)}..."`);
  } else {
    console.log('[scripter] No top performer — generating fresh scripts');
  }

  // 3. Get brand voice from KB
  const brandVoiceRaw = getKB('config', 'brand_voice');
  const brandVoice = brandVoiceRaw ? JSON.parse(brandVoiceRaw) : { voice: 'Direct and results-focused' };

  // 4. Get monthly outliers (only on the 1st of each month)
  const outliers = getMonthlyOutliers();
  if (outliers.length > 0) {
    console.log(`[scripter] Monthly outlier context loaded: ${outliers.length} top performers`);
  }

  // 5. Generate scripts with Claude
  let scripts;
  try {
    scripts = await generateScripts(scoutData, topPerformer, brandVoice, outliers);
  } catch (err) {
    const summary = `Script generation failed: ${err.message}`;
    console.error(`[scripter] ${summary}`);
    logAgentRun('scripter', 'error', summary);
    return;
  }

  // Claude sometimes wraps the array in an object (e.g. {"scripts": [...]})
  if (!Array.isArray(scripts)) {
    const wrapped = scripts?.scripts || scripts?.data || Object.values(scripts || {}).find(v => Array.isArray(v));
    if (Array.isArray(wrapped)) {
      scripts = wrapped;
    } else {
      const summary = `Claude returned no scripts (got: ${JSON.stringify(scripts).substring(0, 100)})`;
      console.error(`[scripter] ${summary}`);
      logAgentRun('scripter', 'error', summary);
      return;
    }
  }

  if (scripts.length === 0) {
    const summary = 'Claude returned an empty scripts array';
    console.error(`[scripter] ${summary}`);
    logAgentRun('scripter', 'error', summary);
    return;
  }

  // 6. Store scripts in database
  if (!isDryRun) {
    const today = new Date().toISOString().split('T')[0];
    const insertScript = db.prepare(`
      INSERT INTO content_scripts (type, hook, body, cta, format, angle, predicted_audience, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((scripts) => {
      for (const script of scripts) {
        insertScript.run(
          script.type || 'middle_of_funnel',
          script.hook || '',
          JSON.stringify(Array.isArray(script.body) ? script.body : [script.body]),
          script.cta || '',
          script.format_suggestion || script.format || 'talking_head',
          script.angle || '',
          script.predicted_audience || '',
          today
        );
      }
    });

    insertAll(scripts);
    console.log(`[scripter] Stored ${scripts.length} scripts for ${today}`);
  } else {
    console.log('[DRY RUN] Generated scripts:');
    scripts.forEach((s, i) => {
      console.log(`\nScript ${i + 1} (${s.type}):`);
      console.log(`  Hook: ${s.hook}`);
      console.log(`  CTA: ${s.cta}`);
    });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = `Generated ${scripts.length} scripts in ${duration}s. Mix: ${scripts.filter(s => s.type === 'top_of_funnel').length} TOF, ${scripts.filter(s => s.type === 'middle_of_funnel').length} MOF.`;

  if (!isDryRun) {
    logAgentRun('scripter', 'success', summary);
  }
  console.log(`[scripter] ${summary}`);
}

// Run if called directly
if (require.main === module) {
  run().catch(err => {
    console.error('[scripter] Fatal error:', err);
    logAgentRun('scripter', 'error', err.message);
    process.exit(1);
  });
}

module.exports = { run };
