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
// Scrape Competitor Instagram via RapidAPI (FREE tier)
// Uses the "Instagram Scraper" API on RapidAPI — free tier gives 500 calls/month.
// At 5 competitors × daily = 150 calls/month, well within the free limit.
//
// Sign up at rapidapi.com → search "Instagram Scraper" → subscribe to free tier.
// Set RAPIDAPI_KEY in .env. If not set, this step is skipped gracefully.
//
// Previous: Apify ($49/month). Now: RapidAPI free tier ($0/month).
// ─────────────────────────────────────────────

async function scrapeInstagramPosts(username) {
  // RapidAPI Instagram scraper — endpoint is configurable via .env so you can
  // swap to any scraper API without touching this code.
  //
  // RAPIDAPI_IG_HOST  = the host header value  (e.g. "instagram-scraper-api2.p.rapidapi.com")
  // RAPIDAPI_IG_URL   = the full endpoint URL   (e.g. "https://instagram-scraper-api2.p.rapidapi.com/v1/posts")
  //
  // The endpoint must accept a username param and return posts with caption/like_count fields.
  // Most RapidAPI Instagram scrapers follow this convention — adjust RAPIDAPI_IG_RESPONSE_PATH
  // if the posts array is nested differently (e.g. "items" vs "data.items" vs "result").

  const host = process.env.RAPIDAPI_IG_HOST;
  const url  = process.env.RAPIDAPI_IG_URL;

  if (!host || !url) {
    throw new Error('RAPIDAPI_IG_HOST and RAPIDAPI_IG_URL must be set in .env');
  }

  const response = await axios.get(url, {
    params: { username_or_id_or_url: username.replace('@', ''), username: username.replace('@', '') },
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': host,
    },
    timeout: 10000,
  });

  // Try common response shapes used by different Instagram scraper APIs on RapidAPI.
  // Most put posts in one of these locations — we try each until we find an array.
  const body = response.data;
  const items = (
    body?.data?.items ||      // instagram-scraper-api2 shape
    body?.items ||            // some scrapers return items at root
    body?.data ||             // some return array directly under "data"
    body?.result ||           // others use "result"
    body?.posts ||            // others use "posts"
    []
  );

  if (!Array.isArray(items)) {
    console.warn(`[scout] Unexpected response shape from ${host} — got:`, JSON.stringify(body).substring(0, 200));
    return [];
  }

  return items.slice(0, 6).map(post => ({
    username,
    // Normalize caption across different API response formats
    caption: (post.caption?.text || post.caption || post.text || post.description || '').toString().substring(0, 500),
    likes: post.like_count || post.likes || post.likesCount || 0,
    comments: post.comment_count || post.comments || post.commentsCount || 0,
    url: post.url || (post.code ? `https://instagram.com/p/${post.code}` : ''),
    type: (post.media_type === 2 || post.type === 'Video') ? 'Video' : 'Post',
  }));
}

async function scrapeCompetitorInstagram() {
  if (!process.env.RAPIDAPI_KEY) {
    console.warn('[scout] RAPIDAPI_KEY not set — skipping Instagram scrape');
    return [];
  }

  const competitors = JSON.parse(getKB('config', 'competitor_accounts') || '[]');
  if (competitors.length === 0) {
    console.warn('[scout] No competitor accounts configured in KB');
    return [];
  }

  const allPosts = [];
  for (const account of competitors.slice(0, 5)) {
    try {
      const posts = await scrapeInstagramPosts(account);
      allPosts.push(...posts);
      console.log(`[scout] Scraped ${posts.length} posts from ${account}`);
    } catch (err) {
      console.warn(`[scout] Could not scrape ${account}: ${err.message}`);
    }
  }

  console.log(`[scout] Total: ${allPosts.length} competitor posts fetched`);
  return allPosts;
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
