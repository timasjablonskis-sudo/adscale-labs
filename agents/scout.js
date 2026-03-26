/**
 * agents/scout.js
 * "Scout" — Research Agent
 *
 * Runs daily at 6 AM (before Scripter).
 * Scrapes trending AI content from Twitter/X (via Nitter RSS proxies)
 * and competitor Instagram accounts (via Apify), then uses Claude to
 * extract content ideas for AdScale Labs' own content strategy.
 *
 * Output is stored in:
 * - content_ideas table (each idea as a row)
 * - knowledge_base: category='scout', key='latest_ideas' (JSON summary for Scripter)
 *
 * Nitter instances are unreliable — Scout tries each in sequence and continues
 * with Apify data if all fail (no crash on Nitter failure).
 *
 * Usage:
 *   node agents/scout.js           → full run
 *   node agents/scout.js --dry-run → analyzes but does not write to DB
 */

'use strict';

require('dotenv').config();
const axios = require('axios');
const xml2js = require('xml2js');
const { db, setKB, logAgentRun, getKB } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────
// Fetch RSS from a Nitter instance
// Nitter is a privacy-respecting Twitter frontend that exposes RSS feeds.
// We use it to get trending tweets without Twitter's API costs.
// ─────────────────────────────────────────────

async function fetchNitterRSS(baseUrl, username) {
  const rssUrl = `${baseUrl}/${username}/rss`;
  try {
    const response = await axios.get(rssUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'AdScale Labs Scout/1.0' },
    });

    // Parse XML RSS feed to JSON
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(response.data);
    const items = parsed?.rss?.channel?.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.map(item => ({
      title: item.title || '',
      description: (item.description || '').replace(/<[^>]+>/g, ''), // Strip HTML
      pubDate: item.pubDate || '',
      link: item.link || '',
    }));
  } catch {
    return null; // Return null to signal failure (caller tries next instance)
  }
}

// ─────────────────────────────────────────────
// Scrape Twitter trends via Nitter RSS
// Tries each configured Nitter instance in order.
// Stops at the first successful fetch.
// ─────────────────────────────────────────────

async function scrapeTrends() {
  // Get Nitter instances and Twitter accounts to monitor from knowledge base
  const nitterInstances = JSON.parse(getKB('config', 'nitter_instances') || '[]');
  const twitterAccounts = JSON.parse(getKB('config', 'twitter_accounts') || '["AnthropicAI","sama"]');

  if (nitterInstances.length === 0) {
    console.warn('[scout] No Nitter instances configured in KB. Skipping Twitter scrape.');
    return [];
  }

  const allTweets = [];

  for (const account of twitterAccounts.slice(0, 5)) { // Max 5 accounts
    let fetched = false;

    for (const instance of nitterInstances) {
      const tweets = await fetchNitterRSS(instance, account);
      if (tweets !== null) {
        // Take the 5 most recent tweets from each account
        allTweets.push(...tweets.slice(0, 5).map(t => ({ ...t, account })));
        fetched = true;
        break; // Move to next account once we have a successful fetch
      }
    }

    if (!fetched) {
      console.warn(`[scout] All Nitter instances failed for @${account} — skipping`);
    }
  }

  console.log(`[scout] Fetched ${allTweets.length} tweets from ${twitterAccounts.length} accounts`);
  return allTweets;
}

// ─────────────────────────────────────────────
// Scrape Competitor Instagram via Apify
// Uses the apify/instagram-scraper actor to get recent posts
// from competitor accounts stored in the knowledge base.
// ─────────────────────────────────────────────

async function scrapeCompetitorInstagram() {
  if (!process.env.APIFY_API_KEY) {
    console.warn('[scout] APIFY_API_KEY not set — skipping Instagram scrape');
    return [];
  }

  const competitors = JSON.parse(getKB('config', 'competitor_accounts') || '[]');
  if (competitors.length === 0) {
    console.warn('[scout] No competitor accounts configured in KB');
    return [];
  }

  const usernames = competitors.map(c => c.replace('@', ''));

  try {
    // Start the Apify Instagram scraper actor
    const runResp = await axios.post(
      'https://api.apify.com/v2/acts/apify~instagram-scraper/runs',
      {
        usernames,
        resultsLimit: 5, // 5 posts per competitor (weekly: 10 is fine for trends)
        scrapeType: 'posts',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.APIFY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const runId = runResp.data?.data?.id;
    if (!runId) throw new Error('No run ID returned from Apify');

    console.log(`[scout] Apify run started: ${runId}. Waiting for completion...`);

    // Poll for completion (Apify runs are async — typically 30-120 seconds)
    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds between polls
      const statusResp = await axios.get(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        { headers: { Authorization: `Bearer ${process.env.APIFY_API_KEY}` } }
      );
      status = statusResp.data?.data?.status;
      attempts++;
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run did not succeed (status: ${status})`);
    }

    // Fetch the results
    const resultsResp = await axios.get(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items`,
      {
        headers: { Authorization: `Bearer ${process.env.APIFY_API_KEY}` },
        params: { limit: 50 },
      }
    );

    const posts = resultsResp.data || [];
    console.log(`[scout] Apify returned ${posts.length} Instagram posts`);

    // Format posts for Claude analysis
    return posts.map(post => ({
      username: post.ownerUsername || post.username,
      caption: (post.caption || post.text || '').substring(0, 500),
      likes: post.likesCount || 0,
      comments: post.commentsCount || 0,
      timestamp: post.timestamp,
      url: post.url,
      type: post.type || 'Post',
    }));

  } catch (err) {
    console.error(`[scout] Apify scrape error: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────
// Analyze with Claude
// Sends all raw data to Claude and gets back structured content ideas.
// Uses the prompt stored in knowledge_base so Optimizer can improve it.
// ─────────────────────────────────────────────

async function analyzeWithClaude(tweets, igPosts) {
  const systemPrompt = getKB('prompts', 'scout_analysis') ||
    'You are Scout, research agent for AdScale Labs. Analyze content and extract ideas.';

  const userMessage = `Here is today's research data:

TWITTER/X TRENDS (${tweets.length} posts):
${tweets.slice(0, 20).map(t => `@${t.account}: ${t.title}\n${t.description}`).join('\n---\n')}

COMPETITOR INSTAGRAM POSTS (${igPosts.length} posts):
${igPosts.slice(0, 15).map(p => `@${p.username} (${p.likes} likes): ${p.caption}`).join('\n---\n')}

Analyze this data and return the structured JSON with trending_topics, competitor_analysis, viral_angles_from_other_niches, and recommended_content_ideas.`;

  const response = await callClaude(systemPrompt, userMessage, {
    promptKey: 'scout_analysis',
    maxTokens: 3000,
  });

  return parseJSON(response);
}

// ─────────────────────────────────────────────
// Main Run Function
// ─────────────────────────────────────────────

async function run() {
  console.log(`[scout] Starting${isDryRun ? ' (DRY RUN)' : ''}...`);
  const startTime = Date.now();

  let tweets = [];
  let igPosts = [];

  // 1. Fetch Twitter trends via Nitter
  try {
    tweets = await scrapeTrends();
  } catch (err) {
    console.error(`[scout] Twitter scrape failed: ${err.message}`);
    // Continue without Twitter data
  }

  // 2. Fetch competitor Instagram posts via Apify
  try {
    igPosts = await scrapeCompetitorInstagram();
  } catch (err) {
    console.error(`[scout] Instagram scrape failed: ${err.message}`);
    // Continue without Instagram data
  }

  if (tweets.length === 0 && igPosts.length === 0) {
    const summary = 'No data fetched from either source — check Nitter instances and Apify key';
    console.warn(`[scout] ${summary}`);
    logAgentRun('scout', 'error', summary);
    return;
  }

  // 3. Analyze with Claude
  let analysis;
  try {
    analysis = await analyzeWithClaude(tweets, igPosts);
  } catch (err) {
    const summary = `Claude analysis failed: ${err.message}`;
    console.error(`[scout] ${summary}`);
    logAgentRun('scout', 'error', summary);
    return;
  }

  // 4. Store results in database
  if (!isDryRun) {
    const today = new Date().toISOString().split('T')[0];
    const insertIdea = db.prepare(`
      INSERT INTO content_ideas (source, topic, angle, niche_origin, date)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Insert each content idea as a separate row
    const ideas = analysis.recommended_content_ideas || [];
    const insertMany = db.transaction((ideas) => {
      for (const idea of ideas) {
        insertIdea.run(
          'scout_daily',
          idea.topic || idea.hook_suggestion || '',
          idea.angle || '',
          idea.niche_origin || 'ai_automation',
          today
        );
      }
    });
    insertMany(ideas);

    // Store the full analysis in knowledge base for Scripter to read
    setKB('scout', 'latest_ideas', JSON.stringify(analysis));

    console.log(`[scout] Stored ${ideas.length} content ideas in DB`);
  } else {
    console.log('[DRY RUN] Analysis result:');
    console.log(JSON.stringify(analysis, null, 2).substring(0, 1000) + '...');
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = `Scout run complete in ${duration}s. ${tweets.length} tweets, ${igPosts.length} IG posts analyzed. ${(analysis.recommended_content_ideas || []).length} ideas generated.`;

  if (!isDryRun) {
    logAgentRun('scout', 'success', summary);
  }
  console.log(`[scout] ${summary}`);
}

// Run if called directly
if (require.main === module) {
  run().catch(err => {
    console.error('[scout] Fatal error:', err);
    logAgentRun('scout', 'error', err.message);
    process.exit(1);
  });
}

module.exports = { run };
