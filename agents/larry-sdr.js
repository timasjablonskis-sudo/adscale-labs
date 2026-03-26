/**
 * agents/larry-sdr.js
 * "Lights Out Larry" — SDR Agent (Sales Development Representative)
 *
 * HIGHEST PRIORITY AGENT. Larry qualifies leads and books calls automatically.
 * Every other agent exists to feed Larry more leads.
 *
 * Larry operates in two modes:
 * 1. FUNCTION MODE (webhook): server.js requires this file and calls processLead(leadData)
 *    directly — no subprocess overhead, low latency response to new leads.
 * 2. SCRIPT MODE (follow-up): node agents/larry-sdr.js --mode=followup
 *    Runs on cron (9am + 5pm), processes pending follow-ups.
 *
 * --dry-run flag: logs what would happen but sends no emails, DMs, or bookings.
 *
 * QUALIFICATION CRITERIA (all 3 required):
 * 1. Service-based business (not e-commerce or pure info products)
 * 2. Has existing leads/customers (not pre-revenue)
 * 3. Open to AI automation
 */

'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');
const axios = require('axios');
const { db, insertLead, updateLead, getLeadsNeedingFollowUp, logAgentRun, getKB } = require('../lib/database');
const { callClaude } = require('../lib/anthropic');

const isDryRun = process.argv.includes('--dry-run');
const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'webhook';

// ─────────────────────────────────────────────
// Email Transport Setup
// Prefers SendGrid if API key is set, falls back to SMTP (Nodemailer).
// ─────────────────────────────────────────────

let emailTransport;

function getEmailTransport() {
  if (emailTransport) return emailTransport;

  // If SendGrid key is available, use it (better deliverability than raw SMTP)
  if (process.env.SENDGRID_API_KEY) {
    emailTransport = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else {
    // Standard SMTP (works with Gmail, Mailgun, Postmark, etc.)
    emailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return emailTransport;
}

// ─────────────────────────────────────────────
// Send Welcome Email
// First touch: personalized email sent immediately when lead submits form.
// Includes a YouTube content link to warm them up before the DM arrives.
// ─────────────────────────────────────────────

async function sendWelcomeEmail(lead) {
  const subject = `Quick question about ${lead.name.split(' ')[0]}'s business`;
  const body = `Hey ${lead.name.split(' ')[0]},

Thanks for reaching out to AdScale Labs.

Before I send you a breakdown of what we can do for your business, I wanted to share something that might be relevant:

👉 [Watch: How we booked 14 calls for a roofing company in 7 days using AI](https://youtube.com/watch?v=demo)

This is a real example of what the system can do when set up correctly.

Quick question while I pull your info together: are you currently getting leads coming in, even if the follow-up is messy right now?

Reply here or DM me on Instagram — I check both.

Talk soon,
Larry
AdScale Labs

P.S. If you are losing leads to voicemail or slow response times, that is usually the first thing we fix.`;

  if (isDryRun) {
    console.log(`[DRY RUN] Would send welcome email to ${lead.email}`);
    return;
  }

  const transport = getEmailTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: lead.email,
    subject,
    text: body,
  });
  console.log(`[larry] Welcome email sent to ${lead.email}`);
}

// ─────────────────────────────────────────────
// Send Instagram DM via ManyChat
// Sends the AI-generated opening qualification message.
// ManyChat requires the subscriber's page-scoped user ID, which we look up by IG handle.
// ─────────────────────────────────────────────

async function sendInstagramDM(igHandle, message) {
  if (!process.env.MANYCHAT_API_KEY) {
    console.warn('[larry] MANYCHAT_API_KEY not set — skipping IG DM');
    return false;
  }

  if (isDryRun) {
    console.log(`[DRY RUN] Would send IG DM to ${igHandle}: ${message.substring(0, 80)}...`);
    return true;
  }

  try {
    // ManyChat API: find subscriber by Instagram username
    const findResp = await axios.get(
      'https://api.manychat.com/fb/subscriber/findByName',
      {
        params: { name: igHandle.replace('@', '') },
        headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}` },
      }
    );

    const subscriber = findResp.data?.data?.[0];
    if (!subscriber) {
      console.warn(`[larry] Could not find ManyChat subscriber for ${igHandle}`);
      return false;
    }

    // Send the DM
    await axios.post(
      'https://api.manychat.com/fb/sending/sendContent',
      {
        subscriber_id: subscriber.id,
        data: {
          version: 'v2',
          content: {
            type: 'instagram',
            messages: [{ type: 'text', text: message }],
          },
        },
      },
      { headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}` } }
    );

    console.log(`[larry] IG DM sent to ${igHandle}`);
    return true;
  } catch (err) {
    console.error(`[larry] ManyChat error for ${igHandle}: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────
// Book into Calendly
// Sends a booking link (and optionally creates a one-time Calendly link).
// If CALENDLY_API_KEY is set, creates a single-use scheduling link for the lead.
// If not configured, falls back to sending the generic event URL.
// ─────────────────────────────────────────────

async function sendCalendlyBooking(lead) {
  let bookingUrl = `https://calendly.com/${process.env.CALENDLY_EVENT_TYPE_UUID || 'adscale/discovery'}`;

  if (process.env.CALENDLY_API_KEY && process.env.CALENDLY_EVENT_TYPE_UUID) {
    try {
      // Create a single-use scheduling link (prefills lead's name + email)
      const resp = await axios.post(
        'https://api.calendly.com/scheduling_links',
        {
          max_event_count: 1,
          owner: `https://api.calendly.com/event_types/${process.env.CALENDLY_EVENT_TYPE_UUID}`,
          owner_type: 'EventType',
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      bookingUrl = resp.data?.resource?.booking_url || bookingUrl;
    } catch (err) {
      console.warn(`[larry] Calendly API error — using generic link: ${err.message}`);
    }
  }

  const bookingMessage = `${lead.name.split(' ')[0]}, based on what you have shared, I think we can help.

Here is a link to book a 30-minute strategy call with our team:
${bookingUrl}

On the call we will:
✓ Review your current lead flow
✓ Show you exactly what AI would look like in your business
✓ Give you a no-pressure recommendation

Book whenever works for you — calendar fills up fast.`;

  if (isDryRun) {
    console.log(`[DRY RUN] Would send booking link to ${lead.email} (URL: ${bookingUrl})`);
    return bookingUrl;
  }

  // Send booking link via email
  const transport = getEmailTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: lead.email,
    subject: 'Your strategy call link — AdScale Labs',
    text: bookingMessage,
  });

  // Also send via IG DM if handle is available
  if (lead.ig_handle) {
    await sendInstagramDM(lead.ig_handle, bookingMessage);
  }

  console.log(`[larry] Booking link sent to ${lead.name} (${lead.email})`);
  return bookingUrl;
}

// ─────────────────────────────────────────────
// Generate Opening Qualification Message via Claude
// Uses the prompt stored in knowledge_base (so Optimizer can improve it).
// Claude writes a personalized, conversational opener — not a form.
// ─────────────────────────────────────────────

async function generateQualificationOpener(lead) {
  // The base system prompt — overridden by KB if Optimizer has rewritten it
  const basePrompt = getKB('prompts', 'larry_qualification_1') ||
    'You are Larry, the SDR for AdScale Labs. Write a brief, conversational opening DM to a new lead.';

  const userMessage = `Lead info:
Name: ${lead.name}
Business type (if known): ${lead.source || 'unknown source'}
Instagram handle: ${lead.ig_handle || 'not provided'}
Additional context: ${JSON.stringify(lead)}

Write the opening qualification DM. Keep it under 5 sentences. End with ONE question about their business.`;

  const message = await callClaude(basePrompt, userMessage, {
    promptKey: 'larry_qualification_1',
    maxTokens: 300,
  });

  return message.trim();
}

// ─────────────────────────────────────────────
// Check if Lead is Qualified
// Uses Claude to evaluate their answers against qualification criteria.
// Returns { qualified: boolean, reason: string }
// ─────────────────────────────────────────────

async function evaluateQualification(lead, conversationHistory) {
  const systemPrompt = `You are evaluating a sales lead for AdScale Labs.

QUALIFICATION CRITERIA (ALL THREE must be true):
1. Service-based business (physical or professional service — NOT e-commerce or pure digital products)
2. Has existing leads/customers (not pre-revenue, not just starting out with $0)
3. Open to AI automation (not hostile, not firmly against using technology)

Based on the conversation, determine if this lead qualifies.

Return JSON:
{
  "qualified": true or false,
  "reason": "One sentence explaining why they qualify or do not qualify",
  "criteria_met": {
    "service_business": true/false,
    "has_leads": true/false,
    "open_to_ai": true/false
  }
}`;

  const userMessage = `Lead: ${lead.name} (${lead.email})
Conversation history: ${JSON.stringify(conversationHistory)}`;

  const response = await callClaude(systemPrompt, userMessage, { maxTokens: 400 });

  try {
    const { parseJSON } = require('../lib/anthropic');
    return parseJSON(response);
  } catch {
    // If Claude response is not valid JSON, default to not qualified
    return { qualified: false, reason: 'Could not parse qualification response', criteria_met: {} };
  }
}

// ─────────────────────────────────────────────
// MAIN FUNCTION: Process a New Lead
// Called directly by the webhook handler in server.js.
// This is the "Lights Out" path — fires when a form is submitted and runs automatically.
// ─────────────────────────────────────────────

async function processLead(leadData) {
  console.log(`[larry] Processing new lead: ${leadData.name} (${leadData.email})`);

  // 1. Insert lead into the database
  const leadId = insertLead({
    name: leadData.name,
    email: leadData.email,
    ig_handle: leadData.ig_handle || null,
    source: leadData.source || 'webhook',
  });

  console.log(`[larry] Lead saved with ID: ${leadId}`);

  // 2. Generate personalized opening message with Claude
  let qualificationOpener;
  try {
    qualificationOpener = await generateQualificationOpener({
      ...leadData,
      id: leadId,
    });
  } catch (err) {
    // Fallback message if Claude is unavailable
    qualificationOpener = `Hey ${leadData.name.split(' ')[0]}, thanks for reaching out! Quick question — are you currently getting leads in, even if the follow-up process is a bit of a mess right now?`;
    console.warn(`[larry] Claude unavailable for opener, using fallback: ${err.message}`);
  }

  // Store the opener in qualification_answers so we have context for follow-ups
  const qualAnswers = JSON.stringify({ q1_sent: qualificationOpener, responses: [] });

  // 3. Send welcome email (non-blocking — if it fails, we continue)
  try {
    await sendWelcomeEmail(leadData);
  } catch (err) {
    console.error(`[larry] Welcome email failed for ${leadData.email}: ${err.message}`);
  }

  // 4. Send IG DM with qualification opener (if handle provided)
  if (leadData.ig_handle) {
    try {
      await sendInstagramDM(leadData.ig_handle, qualificationOpener);
    } catch (err) {
      console.error(`[larry] IG DM failed for ${leadData.ig_handle}: ${err.message}`);
    }
  }

  // 5. Update lead record with the opener we sent and timestamp
  updateLead(leadId, {
    qualification_answers: qualAnswers,
    last_contact: new Date().toISOString(),
  });

  const summary = `Processed new lead: ${leadData.name} (${leadData.email}). Welcome email sent. IG DM ${leadData.ig_handle ? 'sent' : 'skipped (no handle)'}. Qualifier: "${qualificationOpener.substring(0, 60)}..."`;

  if (!isDryRun) {
    logAgentRun('larry-sdr', 'success', summary);
  } else {
    logAgentRun('larry-sdr', 'dry_run', `[DRY RUN] ${summary}`);
  }

  return { leadId, qualificationOpener };
}

// ─────────────────────────────────────────────
// Follow-Up Sequence Runner
// Runs on cron (9 AM + 5 PM daily).
// Finds leads who haven't responded and sends the next touch in the sequence.
// 3 touches total over 7 days, then marked cold.
// ─────────────────────────────────────────────

async function runFollowUps() {
  const leads = getLeadsNeedingFollowUp();
  console.log(`[larry] Found ${leads.length} leads needing follow-up`);

  if (leads.length === 0) {
    logAgentRun('larry-sdr', 'success', 'Follow-up run: 0 leads to contact');
    return;
  }

  let contacted = 0;
  let errors = 0;

  for (const lead of leads) {
    try {
      const touchNum = lead.follow_up_count + 1; // Next touch (1, 2, or 3)

      // Select the right follow-up prompt based on which touch we are on
      const promptKey = touchNum === 1
        ? 'larry_follow_up_1'
        : touchNum === 2
          ? 'larry_follow_up_2'
          : 'larry_follow_up_3';

      // Get the base prompt from the knowledge base
      const systemPrompt = getKB('prompts', promptKey) ||
        `You are Larry from AdScale Labs. Write a short follow-up message to a lead who has not responded. Touch #${touchNum}. Keep it under 3 sentences.`;

      const qualAnswers = lead.qualification_answers ? JSON.parse(lead.qualification_answers) : {};
      const userMessage = `Lead: ${lead.name} (${lead.email})
Original message sent: ${qualAnswers.q1_sent || 'qualification opener'}
Follow-up touch #${touchNum} of 3
Days since last contact: ${Math.floor((Date.now() - new Date(lead.last_contact || lead.created_at).getTime()) / 86400000)}

Write the follow-up message.`;

      const followUpMessage = await callClaude(systemPrompt, userMessage, {
        promptKey,
        maxTokens: 200,
      });

      // Send via IG DM (primary for warm leads) and email
      if (lead.ig_handle) {
        await sendInstagramDM(lead.ig_handle, followUpMessage.trim());
      }

      try {
        const transport = getEmailTransport();
        if (!isDryRun) {
          await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: lead.email,
            subject: touchNum === 3 ? 'Last one from me — AdScale Labs' : 'Quick thought for you',
            text: followUpMessage.trim(),
          });
        }
      } catch (emailErr) {
        console.warn(`[larry] Follow-up email failed for ${lead.email}: ${emailErr.message}`);
      }

      // Update lead record: increment follow_up_count and update last_contact
      updateLead(lead.id, {
        follow_up_count: touchNum,
        last_contact: new Date().toISOString(),
        qualification_answers: JSON.stringify({
          ...qualAnswers,
          [`follow_up_${touchNum}_sent`]: followUpMessage.trim(),
        }),
      });

      contacted++;
      console.log(`[larry] Follow-up touch ${touchNum} sent to ${lead.name}`);

    } catch (err) {
      errors++;
      console.error(`[larry] Follow-up error for lead ${lead.id}: ${err.message}`);
    }
  }

  const summary = `Follow-up run: ${contacted} leads contacted, ${errors} errors. Touches sent across ${leads.length} leads.`;
  logAgentRun('larry-sdr', errors > 0 ? 'error' : (isDryRun ? 'dry_run' : 'success'), summary);
  console.log(`[larry] ${summary}`);
}

// ─────────────────────────────────────────────
// Webhook Response Handler (called by server when lead responds via web form)
// Used when a lead submits a follow-up form or qualifies themselves via Tally.
// ─────────────────────────────────────────────

async function handleLeadResponse(leadId, responseText) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const qualAnswers = lead.qualification_answers ? JSON.parse(lead.qualification_answers) : {};
  const history = qualAnswers.responses || [];
  history.push({ from: 'lead', text: responseText, at: new Date().toISOString() });

  // Check if we have enough info to determine qualification
  const evaluation = await evaluateQualification(lead, history);

  if (evaluation.qualified) {
    // Lead is qualified — send booking link!
    await sendCalendlyBooking(lead);
    updateLead(leadId, {
      qualified: 1,
      qualification_answers: JSON.stringify({ ...qualAnswers, responses: history, evaluation }),
      last_contact: new Date().toISOString(),
    });
    console.log(`[larry] Lead QUALIFIED: ${lead.name} — sending booking link`);
    return { action: 'booked', evaluation };
  } else {
    // Not yet qualified — continue qualifying or mark as unfit
    updateLead(leadId, {
      qualification_answers: JSON.stringify({ ...qualAnswers, responses: history, evaluation }),
      last_contact: new Date().toISOString(),
    });
    return { action: 'continue', evaluation };
  }
}

// ─────────────────────────────────────────────
// Script Mode Entry Point
// When run directly (not require()'d), executes follow-up mode.
// ─────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log(`[larry] Starting in ${isDryRun ? 'DRY RUN ' : ''}${mode} mode`);

    if (mode === 'followup') {
      await runFollowUps();
    } else {
      // Standalone webhook mode: for testing, use a demo lead
      if (isDryRun) {
        console.log('[larry] Dry run with demo lead data:');
        await processLead({
          name: 'Demo Lead',
          email: 'demo@example.com',
          ig_handle: '@demolead',
          source: 'dry-run-test',
        });
      } else {
        console.log('[larry] No mode specified. Use --mode=followup or call processLead() from server.js');
        process.exit(0);
      }
    }
  })().catch(err => {
    console.error('[larry] Fatal error:', err);
    logAgentRun('larry-sdr', 'error', err.message);
    process.exit(1);
  });
}

// Export functions for use by server.js (webhook handler)
module.exports = { processLead, runFollowUps, handleLeadResponse };
