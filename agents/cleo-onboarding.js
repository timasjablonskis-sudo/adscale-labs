/**
 * agents/cleo-onboarding.js
 * "Cleo" — Client Onboarding Agent
 *
 * Triggered by two events:
 * 1. Stripe payment webhook → creates client record + sends onboarding form
 * 2. Tally onboarding form submission → generates Brand Document
 *
 * Cleo's value goes beyond just onboarding clients — she extracts marketing
 * insights from each new client and feeds them back into AdScale's own
 * content strategy (new reel angles, ad copy hooks, objection handling).
 *
 * The onboarding form has 28 questions covering:
 * - Business type, revenue, lead volume, team size
 * - Current marketing, biggest pain, why they bought
 * - Fears, objections, what almost stopped them
 * - Competitor intel, content style preferences
 *
 * Usage:
 *   node agents/cleo-onboarding.js --dry-run → logs actions without sending emails
 */

'use strict';

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const { db, setKB, logAgentRun, getKB } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────
// Email helpers (same pattern as Larry)
// ─────────────────────────────────────────────

let emailTransport;

function getEmailTransport() {
  if (emailTransport) return emailTransport;
  emailTransport = nodemailer.createTransport(
    process.env.SENDGRID_API_KEY
      ? { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } }
      : { host: process.env.SMTP_HOST || 'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT || '587'), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  );
  return emailTransport;
}

// ─────────────────────────────────────────────
// Scrape Instagram account via RapidAPI (FREE tier)
// Same API used by Scout — free tier: 500 req/month.
// Cleo scrapes client + up to 3 competitors on each onboarding = ~4 calls per client.
// At ~10 new clients/month that's 40 calls — well within the 500 free limit.
//
// Previous: Apify ($49/month). Now: RapidAPI free tier ($0/month).
// ─────────────────────────────────────────────

async function scrapeInstagramAccount(username) {
  if (!process.env.RAPIDAPI_KEY) {
    console.warn('[cleo] RAPIDAPI_KEY not set — skipping IG scrape');
    return [];
  }

  try {
    const host = process.env.RAPIDAPI_IG_HOST;
    const url  = process.env.RAPIDAPI_IG_URL;

    if (!host || !url) {
      console.warn('[cleo] RAPIDAPI_IG_HOST/URL not set — skipping IG scrape for', username);
      return [];
    }

    const response = await axios.get(url, {
      params: { username_or_id_or_url: username.replace('@', ''), username: username.replace('@', '') },
      headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': host },
      timeout: 10000,
    });

    const body = response.data;
    const items = body?.data?.items || body?.items || body?.data || body?.result || body?.posts || [];

    if (!Array.isArray(items)) return [];

    return items.slice(0, 12).map(post => ({
      caption: (post.caption?.text || post.caption || post.text || '').toString().substring(0, 400),
      likes: post.like_count || post.likes || post.likesCount || 0,
      comments: post.comment_count || post.comments || post.commentsCount || 0,
      type: (post.media_type === 2 || post.type === 'Video') ? 'Video' : 'Post',
      url: post.url || (post.code ? `https://instagram.com/p/${post.code}` : ''),
    }));

  } catch (err) {
    console.error(`[cleo] RapidAPI error for @${username}: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────
// Generate Brand Document via Claude
// Analyzes onboarding answers + IG content to produce a strategic brand doc.
// ─────────────────────────────────────────────

async function generateBrandDocument(client, onboardingAnswers, clientPosts, competitorPosts) {
  const systemPrompt = getKB('prompts', 'cleo_brand_analysis') ||
    'You are Cleo, onboarding agent for AdScale Labs. Generate a Brand Document for a new client.';

  const userMessage = `New client: ${client.name} (${client.email})
Payment tier: ${client.payment_tier}

ONBOARDING QUESTIONNAIRE ANSWERS:
${JSON.stringify(onboardingAnswers, null, 2)}

CLIENT'S INSTAGRAM CONTENT (${clientPosts.length} recent posts):
${clientPosts.slice(0, 8).map(p => `${p.likes} likes: ${p.caption}`).join('\n---\n')}

COMPETITOR INSTAGRAM CONTENT (${competitorPosts.length} posts across competitors):
${competitorPosts.slice(0, 10).map(p => `${p.likes} likes: ${p.caption}`).join('\n---\n')}

Generate the Brand Document JSON.`;

  const response = await callClaude(systemPrompt, userMessage, {
    promptKey: 'cleo_brand_analysis',
    maxTokens: 3000,
  });

  return parseJSON(response);
}

// ─────────────────────────────────────────────
// Handle Stripe Payment Event
// Called when a new payment comes in. Creates the client record
// and sends the onboarding form link.
// ─────────────────────────────────────────────

async function handleStripeEvent(paymentData, eventType) {
  console.log(`[cleo] Handling Stripe event: ${eventType}`);

  // Extract client info from the Stripe payment data
  const clientEmail = paymentData.customer_email || paymentData.receipt_email || '';
  const clientName = paymentData.customer_details?.name || paymentData.billing_details?.name || 'New Client';
  const amount = paymentData.amount || paymentData.amount_total || 0;

  // Determine payment tier by amount (in cents)
  let paymentTier = 'Starter';
  if (amount >= 250000) paymentTier = 'Scale ($2,500/mo)';
  else if (amount >= 150000) paymentTier = 'Growth ($1,500/mo)';
  else if (amount >= 75000) paymentTier = 'Launch ($750/mo)';

  if (!clientEmail) {
    console.warn('[cleo] No email in Stripe payment data — cannot create client record');
    return;
  }

  // Check if client already exists (avoid duplicates from Stripe retries)
  const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(clientEmail);
  if (existing) {
    console.log(`[cleo] Client ${clientEmail} already exists (ID: ${existing.id}) — skipping`);
    return;
  }

  // Create client record
  const result = db.prepare(`
    INSERT INTO clients (name, email, payment_tier)
    VALUES (?, ?, ?)
  `).run(clientName, clientEmail, paymentTier);

  const clientId = result.lastInsertRowid;
  console.log(`[cleo] Created client record: ${clientName} (ID: ${clientId})`);

  // Send onboarding form link
  const onboardingFormUrl = process.env.TALLY_ONBOARDING_FORM_URL ||
    'https://tally.so/r/your_onboarding_form_id';

  const emailBody = `Hi ${clientName.split(' ')[0]},

Welcome to AdScale Labs! We are excited to get started on your AI automation system.

To kick things off, please complete our onboarding questionnaire. It takes about 10-15 minutes and gives us everything we need to build your system the right way:

👉 ${onboardingFormUrl}?client_id=${clientId}

Once you submit the form:
✓ We will generate your Brand Document within 24 hours
✓ You will receive a kickoff call invite
✓ Your AI system setup begins immediately

Any questions? Reply to this email directly.

Excited to build something great together,
The AdScale Labs Team`;

  if (!isDryRun) {
    const transport = getEmailTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: clientEmail,
      subject: 'Welcome to AdScale Labs — Complete Your Onboarding (10 min)',
      text: emailBody,
    });
    console.log(`[cleo] Onboarding email sent to ${clientEmail}`);
  } else {
    console.log(`[DRY RUN] Would send onboarding email to ${clientEmail}`);
  }

  logAgentRun('cleo-onboarding', isDryRun ? 'dry_run' : 'success',
    `New client created: ${clientName} (${paymentTier}). Onboarding form sent.`);
}

// ─────────────────────────────────────────────
// Handle Onboarding Form Submission
// Called when the client submits the 28-question Tally form.
// Triggers the full brand analysis pipeline.
// ─────────────────────────────────────────────

async function handleOnboardingSubmission(fields, payload) {
  console.log('[cleo] Processing onboarding form submission...');

  // Find the client by email or client_id query param
  const email = fields['email'] || fields['Email'] || '';
  const clientId = fields['client_id'];

  let client = null;
  if (clientId) {
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(parseInt(clientId));
  }
  if (!client && email) {
    client = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  }

  if (!client) {
    // Create client from form if they are not in DB yet (edge case: form submitted before Stripe webhook)
    const name = fields['full_name'] || fields['name'] || fields['Name'] || 'Unknown';
    const result = db.prepare('INSERT INTO clients (name, email, payment_tier) VALUES (?, ?, ?)').run(name, email, 'Unknown');
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[cleo] Created client from form submission: ${name}`);
  }

  // Extract Instagram handles for scraping
  const clientIGHandle = fields['instagram'] || fields['Instagram handle'] || fields['ig_handle'] || '';
  const competitor1 = fields['competitor_1'] || fields['Competitor 1 Instagram'] || '';
  const competitor2 = fields['competitor_2'] || fields['Competitor 2 Instagram'] || '';
  const competitor3 = fields['competitor_3'] || fields['Competitor 3 Instagram'] || '';

  const competitors = [competitor1, competitor2, competitor3].filter(Boolean);

  console.log(`[cleo] Scraping IG for @${clientIGHandle} and ${competitors.length} competitors...`);

  // Scrape client + competitor Instagram accounts
  let clientPosts = [];
  let competitorPosts = [];

  if (!isDryRun && clientIGHandle) {
    clientPosts = await scrapeInstagramAccount(clientIGHandle);
    console.log(`[cleo] Scraped ${clientPosts.length} posts from client's IG`);

    for (const competitor of competitors) {
      const posts = await scrapeInstagramAccount(competitor);
      competitorPosts.push(...posts);
      console.log(`[cleo] Scraped ${posts.length} posts from competitor @${competitor}`);
    }
  }

  // Generate brand document with Claude
  console.log('[cleo] Generating Brand Document with Claude...');
  let brandDoc = null;
  try {
    brandDoc = await generateBrandDocument(client, fields, clientPosts, competitorPosts);
  } catch (err) {
    console.error(`[cleo] Brand doc generation failed: ${err.message}`);
    brandDoc = { error: 'Generation failed', raw_answers: fields };
  }

  // Update client record with all data
  if (!isDryRun) {
    db.prepare(`
      UPDATE clients SET
        brand_doc = ?,
        social_accounts = ?,
        onboarding_answers = ?,
        objections = ?,
        why_bought = ?,
        sold_at_point = ?,
        fears = ?
      WHERE id = ?
    `).run(
      JSON.stringify(brandDoc),
      JSON.stringify({ instagram: clientIGHandle, competitors }),
      JSON.stringify(fields),
      brandDoc?.objections || '',
      brandDoc?.whyBought || '',
      brandDoc?.soldAtPoint || '',
      brandDoc?.fears || '',
      client.id
    );

    // ── Feed insights back to AdScale's marketing knowledge base ──
    // This is the hidden value of Cleo: every client onboarding enriches
    // AdScale's OWN content strategy with new angles and objection handling.
    if (brandDoc?.reelAngles && Array.isArray(brandDoc.reelAngles)) {
      const existingAngles = JSON.parse(getKB('marketing', 'reel_angles') || '[]');
      const newAngles = [...existingAngles, ...brandDoc.reelAngles.map(a => ({
        angle: a, niche: fields['business_type'] || 'unknown', source_client: client.name, date: new Date().toISOString()
      }))];
      setKB('marketing', 'reel_angles', JSON.stringify(newAngles));
    }

    if (brandDoc?.adCopyHooks && Array.isArray(brandDoc.adCopyHooks)) {
      const existingHooks = JSON.parse(getKB('marketing', 'ad_copy_hooks') || '[]');
      const newHooks = [...existingHooks, ...brandDoc.adCopyHooks.map(h => ({
        hook: h, niche: fields['business_type'] || 'unknown', source_client: client.name, date: new Date().toISOString()
      }))];
      setKB('marketing', 'ad_copy_hooks', JSON.stringify(newHooks));
    }

    console.log(`[cleo] Brand Document stored for ${client.name}`);
    console.log(`[cleo] Fed ${(brandDoc?.reelAngles || []).length} new reel angles back to AdScale KB`);
  }

  const summary = `Onboarding complete for ${client.name}. Brand doc generated. ${(brandDoc?.contentPillars || []).length} content pillars. ${(brandDoc?.reelAngles || []).length} new reel angles fed to AdScale KB.`;
  logAgentRun('cleo-onboarding', isDryRun ? 'dry_run' : 'success', summary);
  console.log(`[cleo] ${summary}`);

  return { clientId: client.id, brandDoc };
}

// Run if called directly (dry-run test mode)
if (require.main === module) {
  if (!isDryRun) {
    console.log('Cleo is triggered by webhooks. Use --dry-run for testing, or POST to /webhooks/stripe and /webhooks/onboarding.');
    process.exit(0);
  }

  console.log('[cleo] Dry run test...');
  handleOnboardingSubmission({
    name: 'Test Client', email: 'test@example.com',
    business_type: 'Plumbing company',
    instagram: '@testplumbing',
    biggest_pain: 'Missing calls when on jobs',
  }, {}).then(() => {
    console.log('[cleo] Dry run complete');
  }).catch(err => {
    console.error('[cleo] Dry run error:', err);
    process.exit(1);
  });
}

module.exports = { handleStripeEvent, handleOnboardingSubmission };
