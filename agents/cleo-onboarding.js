/**
 * agents/cleo-onboarding.js
 * "Cleo" — Client Onboarding Agent (v2)
 *
 * Triggered by two events:
 * 1. Stripe payment webhook → creates client record + sends onboarding form link
 * 2. Intake form submission  → generates System Build Blueprint (Brand Document)
 *
 * The Brand Document is a SYSTEM CONFIGURATION blueprint, not a content strategy.
 * It answers: what do we build, which engines/add-ons, how do we configure the AI,
 * what does the AI know about treatments, and what's the ROI case for this client.
 *
 * Form structure (26 questions, 4 categories):
 *   A. Business Context  (Q1–Q7)
 *   B. Services & Pricing (Q8–Q12)
 *   C. Technical Access  (Q13–Q22)
 *   D. System Scoping    (Q23–Q26)
 *
 * Usage:
 *   node agents/cleo-onboarding.js --dry-run
 */

'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');
const { db, setKB, logAgentRun, getKB } = require('../lib/database');
const { callClaude, parseJSON } = require('../lib/anthropic');
const { generateBrandDocPDF } = require('../lib/pdf-generator');

const isDryRun = process.argv.includes('--dry-run');

// ─────────────────────────────────────────────
// Email Transport
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
// Channel Rollout Plan Auto-Generator
// Distributes active channels across weeks based on priority.
// ─────────────────────────────────────────────

function buildChannelRollout(enginesActivated, activeChannels, priorityChannel) {
  const textChannels = ['Instagram DMs', 'Facebook Messenger', 'Website Chat', 'SMS', 'Email'];
  const voiceChannel = 'Phone/Voice AI';

  // Build the ordered channel list
  const available = [];
  if (enginesActivated.includes('Engine A')) {
    for (const ch of textChannels) {
      if (activeChannels.includes(ch)) available.push(ch);
    }
  }
  if (enginesActivated.includes('Engine B')) {
    available.push(voiceChannel);
  }

  // Put priority channel first
  const ordered = [
    ...(priorityChannel && available.includes(priorityChannel) ? [priorityChannel] : []),
    ...available.filter(c => c !== priorityChannel),
  ];

  return {
    week_1: ordered.slice(0, 2),
    week_2: ordered.slice(2, 4),
    week_3: ordered.slice(4),
  };
}

// ─────────────────────────────────────────────
// ROI Projection Calculator
// Uses client's reported numbers + industry benchmarks.
// ─────────────────────────────────────────────

function calculateROI(monthlyLeadVolume, monthlyRevenueRange, addonsActivated) {
  // Parse lead volume — might be "~150", "100-200", "around 80", etc.
  const leadMatch = String(monthlyLeadVolume).match(/(\d+)/);
  const leads     = leadMatch ? parseInt(leadMatch[1]) : 100;

  // Parse revenue — use midpoint of range
  const revStr   = String(monthlyRevenueRange).replace(/[^0-9\-kKmM]/g, '');
  let revMid     = 75000; // default $75K/mo
  if (/k/i.test(monthlyRevenueRange)) {
    const nums = monthlyRevenueRange.match(/(\d+)/g);
    if (nums && nums.length >= 2) revMid = (parseInt(nums[0]) + parseInt(nums[1])) / 2 * 1000;
    else if (nums) revMid = parseInt(nums[0]) * 1000;
  } else {
    const nums = monthlyRevenueRange.match(/(\d+)/g);
    if (nums && nums.length >= 2) revMid = (parseInt(nums[0]) + parseInt(nums[1])) / 2;
    else if (nums) revMid = parseInt(nums[0]);
  }

  // Avg treatment value estimate: ~$300 for a mid-tier med spa
  const avgTreatmentValue = 300;

  // 62% of leads never get follow-up; of those, assume 15% would book with AI
  const missedLeads  = Math.round(leads * 0.62);
  const recoveredLow = Math.round(missedLeads * 0.30);
  const recoveredHigh = Math.round(missedLeads * 0.50);
  const revenueRecoveryLow  = recoveredLow  * avgTreatmentValue;
  const revenueRecoveryHigh = recoveredHigh * avgTreatmentValue;

  // No-show cost — assume 12% no-show rate, 50% recovery with Smart Reminders
  const noShowRate     = 0.12;
  const monthlyBookings = Math.round(leads * 0.25);  // assume 25% book currently
  const noShows        = Math.round(monthlyBookings * noShowRate);
  const noShowLoss     = noShows * avgTreatmentValue;
  const noShowRecovery = addonsActivated.includes('No-Show Recovery') || addonsActivated.includes('Smart Reminder Suite')
    ? Math.round(noShowLoss * 0.60) : 0;

  const totalLow  = revenueRecoveryLow  + noShowRecovery;
  const totalHigh = revenueRecoveryHigh + noShowRecovery;

  const formatMoney = n => `$${n.toLocaleString()}`;
  const monthlyRate = 297; // conservative — system pays for itself with 1-2 bookings
  const monthsToROI = totalLow > 0 ? Math.max(1, Math.ceil(monthlyRate / (totalLow / 12))) : 'N/A';

  return {
    current_estimated_monthly_missed_leads: missedLeads,
    current_estimated_no_show_rate:         `~${Math.round(noShowRate * 100)}% of appointments`,
    current_estimated_no_show_revenue_loss: formatMoney(noShowLoss),
    projected_lead_recovery_rate:           '30–50%',
    projected_no_show_reduction:            '50–70%',
    projected_monthly_revenue_recovery:     `${formatMoney(totalLow)}–${formatMoney(totalHigh)}`,
    months_to_roi:                          typeof monthsToROI === 'number' ? `${monthsToROI} month${monthsToROI === 1 ? '' : 's'}` : monthsToROI,
    calculation_methodology:
      'Based on industry benchmarks: 62% of med spa leads never receive follow-up, 44-hour avg response time, ' +
      '80% conversion loss after 5-minute window. Revenue recovery calculated at conservative $300 avg treatment value. ' +
      'Projections are estimates — actual results will vary.',
  };
}

// ─────────────────────────────────────────────
// Generate Brand Document via Claude
// Claude handles: ai_personality, competitive_positioning,
// and treatment_knowledge_base structuring.
// Everything else is derived from the form data directly.
// ─────────────────────────────────────────────

async function generateBrandDocument(client, fields, partialDoc) {
  const systemPrompt = getKB('prompts', 'cleo_brand_analysis') || `
You are Cleo, the onboarding agent for AdScale Labs. You build AI Front Desk systems for med spas.

Your job: analyze the client's intake form data and generate the strategic sections of their Brand Document JSON.

You will be given:
- The client's business context (name, location, team, revenue, pain points)
- Their treatment/service menu
- Their selected AI tone preference
- Their custom restrictions (what the AI should never say)
- Competitor names they provided
- Their system configuration (which engines and add-ons)

Generate ONLY this JSON structure — no explanation, no markdown, just raw JSON:

{
  "ai_personality": {
    "tone": "<copy from intake or refine>",
    "voice_style": "<1 sentence describing HOW the AI sounds — not what it is, how it sounds>",
    "brand_vocabulary": ["<5-8 specific words/phrases this AI should use naturally>"],
    "never_say": ["<their restrictions + standard compliance + competitor names>"],
    "greeting_template": "<realistic opening message the AI sends when a new lead reaches out — 2-3 sentences, natural, not robotic, matches their tone>",
    "closing_template": "<realistic closing message after a booking is confirmed — warm, specific to med spa context>"
  },
  "competitive_positioning": {
    "competitors": ["<competitor names from intake>"],
    "client_unique_advantages": ["<3-5 specific advantages this med spa has based on their answers>"],
    "differentiators_for_ai_responses": "<1 paragraph: how the AI should position this client vs competitors without naming competitors>"
  },
  "treatment_knowledge_base": {
    "full_menu": [
      { "name": "<treatment>", "price": "<price or range>", "description": "<1 sentence>" }
    ],
    "top_treatments": ["<top 3 by revenue from intake>"],
    "active_promotions": ["<any promos mentioned>"],
    "consultation_required": ["<treatments requiring consult>"],
    "screening_questions": {
      "<treatment_name>": ["<screening question 1>", "<screening question 2>"]
    },
    "treatment_durations": { "<treatment>": "<duration>" },
    "recovery_timelines": { "<treatment>": "<downtime>" }
  }
}

Rules:
- greeting_template and closing_template must sound like a real person at that specific med spa — not generic
- never_say must include: their custom restrictions, "guarantee results", "cure", "fix", "cheap", and any competitor names listed
- brand_vocabulary should feel natural for their chosen tone (luxury = "aesthetic goals", "complimentary consultation"; clinical = "treatment protocol", "evidence-based")
- For screening_questions, only include treatments where the client said consultation is required or that have obvious medical considerations (pregnancy, blood thinners, prior treatments)
- If treatment menu is sparse, make reasonable inferences for a med spa offering those services
- Return ONLY valid JSON — no backticks, no commentary
`.trim();

  const userMessage = `
CLIENT: ${client.name} (${client.email})

BUSINESS CONTEXT:
- Location(s): ${fields.business_address || 'Not specified'}
- Team: ${fields.team_structure || 'Not specified'}
- Monthly lead volume: ${fields.monthly_lead_volume || 'Not specified'}
- Monthly revenue range: ${fields.monthly_revenue_range || 'Not specified'}
- Biggest pain point: ${fields.biggest_pain || 'Not specified'}
- Why they signed up: ${fields.why_signed_up || 'Not specified'}

SERVICES:
- Treatment menu (raw): ${fields.treatment_menu || 'See uploaded file or not provided'}
- Top 3 treatments: ${fields.top_treatments || 'Not specified'}
- Current promotions: ${fields.active_promotions || 'None mentioned'}
- Treatments requiring consultation: ${fields.consultation_required_treatments || 'Not specified'}
- Screening notes: ${fields.screening_questions_text || 'None'}

SYSTEM CONFIG:
- Engines: ${(partialDoc.system_blueprint.engines_activated || []).join(', ')}
- Add-ons: ${(partialDoc.system_blueprint.addons_activated || []).join(', ') || 'None'}
- Reputation engine: ${partialDoc.system_blueprint.reputation_engine ? 'Yes' : 'No'}

AI PREFERENCES:
- Desired tone: ${fields.ai_tone || 'Warm & friendly'}
- Restrictions / never say: ${fields.ai_restrictions || 'None specified'}

COMPETITORS (2-3 local competitors named):
${fields.competitor_names || 'None provided'}
`.trim();

  const response = await callClaude(systemPrompt, userMessage, {
    promptKey: 'cleo_brand_analysis',
    maxTokens: 4000,
  });

  return parseJSON(response);
}

// ─────────────────────────────────────────────
// Handle Stripe Payment Event
// Creates client record and sends intake form link.
// ─────────────────────────────────────────────

async function handleStripeEvent(paymentData, eventType) {
  console.log(`[cleo] Handling Stripe event: ${eventType}`);

  const clientEmail = paymentData.customer_email || paymentData.receipt_email || '';
  const clientName  = paymentData.customer_details?.name || paymentData.billing_details?.name || 'New Client';
  const amount      = paymentData.amount || paymentData.amount_total || 0;

  // payment_tier stays as a free-text pricing descriptor
  // monthly_rate and setup_fee stored in cents — these can be updated manually later
  let paymentTier = 'Custom';
  if (amount >= 250000) paymentTier = 'Scale';
  else if (amount >= 150000) paymentTier = 'Growth';
  else if (amount >= 75000) paymentTier = 'Launch';
  else if (amount > 0) paymentTier = 'Starter';

  if (!clientEmail) {
    console.warn('[cleo] No email in Stripe payment — cannot create client record');
    return;
  }

  // Prevent duplicate records from Stripe retries
  const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(clientEmail);
  if (existing) {
    console.log(`[cleo] Client ${clientEmail} already exists (ID: ${existing.id}) — skipping`);
    return;
  }

  const result = db.prepare(`
    INSERT INTO clients (name, email, payment_tier, monthly_rate, setup_fee, onboarding_status)
    VALUES (?, ?, ?, ?, ?, 'form_sent')
  `).run(clientName, clientEmail, paymentTier, amount, 0);

  const clientId = result.lastInsertRowid;
  console.log(`[cleo] Created client: ${clientName} (ID: ${clientId}, tier: ${paymentTier})`);

  const dashboardBase = process.env.DASHBOARD_BASE_URL || 'https://adscale-labs.vercel.app';
  const formUrl = `${dashboardBase}/onboard?client_id=${clientId}`;

  const emailBody = `Hi ${clientName.split(' ')[0]},

Welcome to AdScale Labs. Your payment is confirmed — let's get your AI Front Desk built.

Complete your intake form (15–20 min). This gives us everything we need to configure your system:

${formUrl}

What happens next:
  1. You submit the form
  2. We generate your AI Front Desk Blueprint within minutes
  3. You receive the blueprint by email — it shows exactly what we're building
  4. We schedule a quick 15-minute kickoff call to confirm the details
  5. Build begins — first channel live within 48 hours

Questions? Reply directly to this email.

The AdScale Labs Team`;

  if (!isDryRun) {
    try {
      await getEmailTransport().sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      clientEmail,
        subject: 'Your AdScale AI system is confirmed — complete your intake (15 min)',
        text:    emailBody,
      });
      console.log(`[cleo] Intake form email sent to ${clientEmail}`);
    } catch (err) {
      console.error(`[cleo] Failed to send intake email: ${err.message}`);
    }
  } else {
    console.log(`[DRY RUN] Would send intake form email to ${clientEmail}`);
  }

  logAgentRun('cleo-onboarding', isDryRun ? 'dry_run' : 'success',
    `New client created: ${clientName} (${paymentTier}). Intake form sent. Status: form_sent.`);
}

// ─────────────────────────────────────────────
// Handle Intake Form Submission
// Parses the 26-question form, builds the Brand Document JSON,
// generates the PDF, and sends the confirmation email.
// ─────────────────────────────────────────────

async function handleOnboardingSubmission(fields, payload) {
  console.log('[cleo] Processing intake form submission...');

  // ── Field normalizer: supports both new intake form keys AND old Tally form labels/IDs ──
  // New form uses clean keys like 'owner_email', 'business_name'.
  // Old 28-question Tally form uses labels like 'What is your billing email address?' and IDs like 'question_JRdkYK'.
  function f(...keys) {
    for (const k of keys) {
      const v = fields[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  // ── Resolve email and name (works with both form versions) ──
  const email = f(
    'owner_email', 'email', 'Email',
    'What is your billing email address?', 'question_JRdkYK'
  );
  const ownerName = f(
    'owner_name',
    'What is your full name?', 'question_4kBNqA'
  );
  const businessName = f(
    'business_name',
    'What is your business/brand name?', 'question_jMb9pJ'
  );
  const clientId = f('client_id');

  // ── Resolve client record ──
  let client = null;
  if (clientId) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(parseInt(clientId));
  if (!client && email) client = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);

  if (!client) {
    const name = businessName || ownerName || 'Unknown';
    const result = db.prepare(`
      INSERT INTO clients (name, email, payment_tier, onboarding_status)
      VALUES (?, ?, 'Unknown', 'form_submitted')
    `).run(name, email);
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    console.log(`[cleo] Created client from form submission: ${name} (${email})`);
  } else {
    // Update name if we have better data now
    const betterName = businessName || ownerName;
    if (betterName && client.name === 'Unknown') {
      db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(betterName, client.id);
      client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    }
    // Update email if it was missing
    if (email && !client.email) {
      db.prepare('UPDATE clients SET email = ? WHERE id = ?').run(email, client.id);
      client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    }
  }

  // Update status → form_submitted
  if (!isDryRun) {
    db.prepare(`UPDATE clients SET onboarding_status = 'form_submitted' WHERE id = ?`).run(client.id);
  }

  // ── Normalize remaining fields (new keys → old Tally fallbacks) ──
  // These map to the new 26-question form structure, with old form fallbacks where possible.
  fields.business_name        = fields.business_name        || businessName;
  fields.owner_name           = fields.owner_name           || ownerName;
  fields.owner_email          = fields.owner_email          || email;
  fields.owner_phone          = f('owner_phone', 'business_phone_numbers');
  fields.business_address     = f('business_address', 'locations', 'What is your website URL?');
  fields.team_structure       = f('team_structure', 'How many people are on your team?', 'question_7Db9e0');
  fields.monthly_lead_volume  = f('monthly_lead_volume');
  fields.monthly_revenue_range = f('monthly_revenue_range', 'What is your approximate monthly revenue?', 'question_NVDBgO');
  fields.biggest_pain         = f('biggest_pain', 'What are your primary marketing goals?', 'question_6keQ9Y', "What is your #1 priority for the next 90 days?", 'question_vBrxpl');
  fields.why_signed_up        = f('why_signed_up', 'What does success look like for you in 6 months?', 'question_KoeBgX');
  fields.treatment_menu       = f('treatment_menu');
  fields.top_treatments       = f('top_treatments');
  fields.active_promotions    = f('active_promotions');
  fields.consultation_required_treatments = f('consultation_required_treatments');
  fields.booking_system_platform = f('booking_system_platform', 'What CRM or marketing tools are you currently using?', 'question_AJKb0e');
  fields.competitor_names     = f('competitor_names', 'Are there any competitors we should be aware of?', 'question_1Kk2x1');
  fields.ai_tone              = f('ai_tone');
  fields.ai_restrictions      = f('ai_restrictions');
  fields.website_url          = f('website_url', 'What is your website URL?', 'question_2kBxZD');

  // ── Parse system scoping (Category D) ──
  const rawEngines   = fields['engines_selected']  || fields['engines']  || '';
  const rawAddons    = fields['addons_selected']    || fields['addons']   || '';
  const repEngine    = /yes|true|1/i.test(fields['reputation_engine_selected'] || '');
  const priorityCh   = fields['priority_launch_channel'] || fields['priority_channel'] || '';

  // engines_selected may come as comma-separated string or array
  const enginesActivated = Array.isArray(rawEngines)
    ? rawEngines
    : rawEngines.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);

  const addonsActivated = Array.isArray(rawAddons)
    ? rawAddons
    : rawAddons.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);

  // ── Parse active channels (Category C, Q14) ──
  const rawChannels   = fields['active_channels'] || '';
  const activeChannels = Array.isArray(rawChannels)
    ? rawChannels
    : rawChannels.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);

  // ── Parse locations ──
  const locationsRaw = fields['business_address'] || fields['locations'] || '';
  const locations    = Array.isArray(locationsRaw)
    ? locationsRaw
    : [{ address: locationsRaw, hours: fields['business_hours'] || '' }].filter(l => l.address);

  // ── Build the partial Brand Document (non-Claude sections) ──
  const channelRollout = buildChannelRollout(enginesActivated, activeChannels, priorityCh);
  const roiProjections = calculateROI(
    fields['monthly_lead_volume'] || '',
    fields['monthly_revenue_range'] || '',
    addonsActivated
  );

  const partialDoc = {
    client_profile: {
      business_name:       fields['business_name']       || client.name,
      locations,
      owner_contact: {
        name:  fields['owner_name']  || '',
        phone: fields['owner_phone'] || '',
        email: fields['owner_email'] || client.email,
      },
      team_size: {
        description: fields['team_structure'] || '',
      },
      monthly_lead_volume:  fields['monthly_lead_volume']  || '',
      monthly_revenue_range: fields['monthly_revenue_range'] || '',
      primary_pain_point:   fields['biggest_pain']         || '',
      why_they_signed_up:   fields['why_signed_up']        || '',
    },
    system_blueprint: {
      engines_activated:    enginesActivated,
      addons_activated:     addonsActivated,
      reputation_engine:    repEngine,
      priority_launch_channel: priorityCh,
      channel_rollout_plan: channelRollout,
      booking_system: {
        platform:               fields['booking_system_platform'] || '',
        integration_method:     'API',
        special_config_notes:   fields['booking_system_notes']   || '',
      },
    },
    ai_personality:          {}, // filled by Claude
    treatment_knowledge_base: {}, // filled by Claude
    competitive_positioning:  {}, // filled by Claude
    roi_projections:         roiProjections,
    onboarding_metadata: {
      signed_up_at:          client.onboarded_at || new Date().toISOString(),
      form_submitted_at:     new Date().toISOString(),
      brand_doc_generated_at: '',
      system_live_at:        '',
      pricing_tier:          client.payment_tier || '',
      monthly_rate:          client.monthly_rate || 0,
      setup_fee:             client.setup_fee    || 0,
    },
  };

  // ── Claude generates the strategic sections ──
  console.log('[cleo] Calling Claude to generate brand doc strategic sections...');
  let claudeDoc = {};
  try {
    claudeDoc = await generateBrandDocument(client, fields, partialDoc);
  } catch (err) {
    console.error(`[cleo] Claude brand doc generation failed: ${err.message}`);
    claudeDoc = {
      ai_personality:          { tone: fields['ai_tone'] || 'Warm & friendly', brand_vocabulary: [], never_say: [], greeting_template: '', closing_template: '' },
      competitive_positioning:  { competitors: [], client_unique_advantages: [], differentiators_for_ai_responses: '' },
      treatment_knowledge_base: { full_menu: [], top_treatments: [], active_promotions: [], consultation_required: [], screening_questions: {}, treatment_durations: {}, recovery_timelines: {} },
    };
  }

  // ── Merge Claude output into the partial doc ──
  const brandDoc = {
    ...partialDoc,
    ai_personality:           claudeDoc.ai_personality           || partialDoc.ai_personality,
    treatment_knowledge_base: claudeDoc.treatment_knowledge_base || partialDoc.treatment_knowledge_base,
    competitive_positioning:  claudeDoc.competitive_positioning  || partialDoc.competitive_positioning,
    onboarding_metadata: {
      ...partialDoc.onboarding_metadata,
      brand_doc_generated_at: new Date().toISOString(),
    },
  };

  // ── Generate PDF ──
  let pdfUrl = null;
  if (!isDryRun) {
    try {
      pdfUrl = await generateBrandDocPDF(client, brandDoc);
      console.log(`[cleo] Brand doc PDF: ${pdfUrl}`);
    } catch (err) {
      console.error(`[cleo] PDF generation failed: ${err.message}`);
    }
  }

  // ── Persist to database ──
  if (!isDryRun) {
    db.prepare(`
      UPDATE clients SET
        name                   = ?,
        phone                  = ?,
        locations              = ?,
        engines_activated      = ?,
        addons_activated       = ?,
        reputation_engine      = ?,
        priority_launch_channel = ?,
        brand_doc              = ?,
        onboarding_answers     = ?,
        brand_doc_pdf_url      = ?,
        onboarding_status      = 'brand_doc_generated'
      WHERE id = ?
    `).run(
      brandDoc.client_profile.business_name || client.name,
      fields['owner_phone'] || fields['business_phone_numbers'] || null,
      JSON.stringify(locations),
      JSON.stringify(enginesActivated),
      JSON.stringify(addonsActivated),
      repEngine ? 1 : 0,
      priorityCh,
      JSON.stringify(brandDoc),
      JSON.stringify(fields),
      pdfUrl,
      client.id
    );
    console.log(`[cleo] Brand doc stored for ${client.name} (ID: ${client.id})`);
  }

  // ── Send client confirmation email ──
  if (client.email && !isDryRun) {
    const firstName = (brandDoc.client_profile.business_name || client.name || 'there').split(' ')[0];
    const pdfLine   = pdfUrl
      ? `\nYour blueprint PDF: ${process.env.API_BASE_URL || 'http://localhost:3001'}${pdfUrl}\n`
      : '';

    const rollout = brandDoc.system_blueprint.channel_rollout_plan;
    const rolloutText = Object.entries(rollout)
      .filter(([, chs]) => chs.length > 0)
      .map(([week, chs]) => `  ${week.replace('_', ' ').toUpperCase()}: ${chs.join(', ')}`)
      .join('\n');

    const greeting = brandDoc.ai_personality?.greeting_template || "(See your blueprint for your AI's greeting)";

    const confirmBody = `Hi ${firstName},

Your intake form is confirmed and your AI Front Desk Blueprint is ready.
${pdfLine}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR SYSTEM CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Engines activated: ${enginesActivated.join(', ') || 'Core system'}
Add-ons: ${addonsActivated.length > 0 ? addonsActivated.join(', ') : 'None selected'}
Reputation Engine: ${repEngine ? 'Yes — monitoring Google reviews 24/7' : 'Not selected'}
Priority launch channel: ${priorityCh || 'To be confirmed'}

CHANNEL ROLLOUT PLAN:
${rolloutText || '  To be scheduled'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI PERSONALITY PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tone: ${brandDoc.ai_personality?.tone || 'Not specified'}
Voice style: ${brandDoc.ai_personality?.voice_style || ''}

Sample greeting your AI will send:
"${greeting}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROI PROJECTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estimated missed leads per month: ${brandDoc.roi_projections.current_estimated_monthly_missed_leads}
Projected monthly revenue recovery: ${brandDoc.roi_projections.projected_monthly_revenue_recovery}
Estimated time to full ROI: ${brandDoc.roi_projections.months_to_roi}

(Based on industry benchmarks — actual results vary)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What happens next:
  1. We'll reach out to schedule your 15-minute kickoff call
  2. ${priorityCh || 'Your priority channel'} goes live within 48 hours of the call
  3. Remaining channels roll out per the schedule above
  4. You receive a performance summary at end of week 2

Questions? Reply directly to this email.

The AdScale Labs Team`;

    try {
      await getEmailTransport().sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      client.email,
        subject: `Your AI Front Desk Blueprint is ready — ${brandDoc.client_profile.business_name || client.name}`,
        text:    confirmBody,
      });
      console.log(`[cleo] Confirmation email sent to ${client.email}`);
    } catch (err) {
      console.error(`[cleo] Failed to send confirmation email: ${err.message}`);
    }
  } else if (isDryRun) {
    console.log(`[DRY RUN] Would send confirmation email to ${client.email}`);
  }

  // ── Send internal kickoff brief to Timothy ──
  // This is YOUR cheat sheet for the 15-min call before the build starts.
  const internalTo = process.env.INTERNAL_BRIEF_EMAIL || process.env.SMTP_USER;
  if (internalTo && !isDryRun) {
    const biz      = brandDoc.client_profile.business_name || client.name;
    const engines  = enginesActivated.join(', ') || 'None selected';
    const addons   = addonsActivated.length > 0 ? addonsActivated.join(', ') : 'None';
    const top      = (brandDoc.treatment_knowledge_base?.top_treatments || []).join(', ') || fields['top_treatments'] || 'Not specified';
    const tone     = brandDoc.ai_personality?.tone || fields['ai_tone'] || 'Not specified';
    const greeting = brandDoc.ai_personality?.greeting_template || 'Not generated';
    const platform = brandDoc.system_blueprint?.booking_system?.platform || 'Not specified';
    const channels = (brandDoc.system_blueprint?.channel_rollout_plan ? Object.values(brandDoc.system_blueprint.channel_rollout_plan).flat() : []).join(', ') || 'Not specified';

    // Detect gaps — things that were blank or missing
    const gaps = [];
    if (!fields['treatment_menu']?.trim())      gaps.push('Treatment menu was empty — ask for their full price list on the call');
    if (!fields['active_channels']?.trim())     gaps.push('No channels selected — confirm which channels they use on the call');
    if (!fields['booking_system_platform']?.trim()) gaps.push('No booking system specified — ask what they use');
    if (enginesActivated.length === 0)          gaps.push('No engines selected — walk them through the options on the call');
    if (!priorityCh?.trim())                    gaps.push('No priority launch channel set — decide this on the call');
    if (!fields['competitor_names']?.trim())    gaps.push('No competitors listed — ask for 2-3 local competitors');
    if (!fields['instagram_handle']?.trim())    gaps.push('No Instagram handle — needed for Engine A setup');

    // Suggested questions based on their specific answers
    const questions = [];
    if (fields['biggest_pain']) questions.push(`Their pain: "${fields['biggest_pain']}" — ask how long this has been happening and what it's cost them`);
    if (fields['why_signed_up']) questions.push(`They signed up because: "${fields['why_signed_up']}" — reference this when confirming the build plan`);
    if (enginesActivated.includes('Engine B: Omni Voice Receptionist') || enginesActivated.some(e => e.includes('Engine B'))) {
      questions.push('Voice AI selected — confirm they want to forward their main business line or use a new number');
    }
    if (addonsActivated.some(a => a.includes('No-Show'))) {
      questions.push('No-Show Recovery selected — ask what their current no-show rate is so we can set a baseline');
    }
    if (addonsActivated.some(a => a.includes('Botox Clock') || a.includes('Treatment Cycle'))) {
      questions.push('Treatment Cycle Automation selected — confirm recall intervals (standard: 4 weeks, 3 months, 6 months)');
    }
    questions.push(`Confirm the ${priorityCh || 'priority channel'} is the right first channel and they have access credentials ready`);
    questions.push('Ask if there are any upcoming promotions or events in the next 30 days the AI should know about');

    const briefBody = `NEW CLIENT INTAKE — KICKOFF CALL BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${biz.toUpperCase()}
Contact: ${fields['owner_name'] || client.name} | ${client.email} | ${fields['owner_phone'] || fields['business_phone_numbers'] || 'No phone'}
Revenue: ${fields['monthly_revenue_range'] || 'Not specified'} | Leads: ${fields['monthly_lead_volume'] || 'Not specified'}/mo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT WE'RE BUILDING
  Engines:          ${engines}
  Add-ons:          ${addons}
  Reputation Engine: ${repEngine ? 'Yes' : 'No'}
  Priority launch:  ${priorityCh || 'Not set — decide on call'}
  Booking system:   ${platform}
  Channels:         ${channels}
  AI tone:          ${tone}

TOP TREATMENTS
  ${top}

THEIR WORDS (use these on the call)
  Pain point:   "${fields['biggest_pain'] || 'Not answered'}"
  Why they bought: "${fields['why_signed_up'] || 'Not answered'}"

AI GREETING CLAUDE GENERATED
  "${greeting}"

${gaps.length > 0 ? `GAPS TO FILL ON THE CALL (${gaps.length})
${gaps.map(g => `  ⚠ ${g}`).join('\n')}

` : '✓ No major gaps — intake was complete\n\n'}SUGGESTED QUESTIONS FOR THE CALL
${questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dashboard: https://adscale-labs.vercel.app/clients
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
      await getEmailTransport().sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      internalTo,
        subject: `[KICKOFF BRIEF] ${biz} — ${enginesActivated.length > 0 ? engines : 'Engines TBD'} | ${priorityCh || 'Priority TBD'}`,
        text:    briefBody,
      });
      console.log(`[cleo] Internal kickoff brief sent to ${internalTo}`);
    } catch (err) {
      console.error(`[cleo] Failed to send internal brief: ${err.message}`);
    }
  } else if (isDryRun) {
    console.log(`[DRY RUN] Would send internal kickoff brief to ${internalTo || process.env.SMTP_USER}`);
  }

  const summary = `Onboarding complete: ${brandDoc.client_profile.business_name || client.name}. ` +
    `Engines: ${enginesActivated.join(', ') || 'none'}. ` +
    `Add-ons: ${addonsActivated.join(', ') || 'none'}. ` +
    `Priority channel: ${priorityCh || 'unset'}. ` +
    `PDF: ${pdfUrl || 'not generated'}.`;

  logAgentRun('cleo-onboarding', isDryRun ? 'dry_run' : 'success', summary);
  console.log(`[cleo] ${summary}`);

  return { clientId: client.id, brandDoc, pdfUrl };
}

// ─────────────────────────────────────────────
// CLI / Dry-Run Mode
// ─────────────────────────────────────────────

if (require.main === module) {
  if (!isDryRun) {
    console.log('Cleo is triggered by webhooks. Use --dry-run for testing.');
    process.exit(0);
  }

  console.log('[cleo] Dry run — simulating a complete intake form submission...');
  handleOnboardingSubmission({
    client_id:                  '',
    business_name:              'Glow & Grace Med Spa',
    business_address:           '1234 Michigan Ave, Chicago, IL 60601',
    business_hours:             'Mon–Fri 9am–7pm, Sat 10am–5pm',
    owner_name:                 'Sarah Chen',
    owner_phone:                '+1 (312) 555-0100',
    owner_email:                'sarah@glowandgrace.com',
    team_structure:             '2 injectors, 1 esthetician, 1 front desk coordinator',
    monthly_lead_volume:        '~120',
    monthly_revenue_range:      '$80K–$120K/month',
    biggest_pain:               "Missing calls after 6pm — that's when our highest-intent leads reach out",
    why_signed_up:              'The missed call text-back demo converted a $900 Botox appointment in the meeting',
    treatment_menu:             'Botox $12/unit, Juvederm lips $650, HydraFacial $199, Laser hair removal (legs) $299/session, CoolSculpting consult + treatment from $750, IV drip therapy $149',
    top_treatments:             'Botox, Juvederm lips, HydraFacial',
    active_promotions:          'Summer skin package: HydraFacial + LED for $249 (reg $320). First-time Botox 20% off.',
    consultation_required_treatments: 'CoolSculpting, Laser hair removal',
    screening_questions_text:   'Botox: ask about pregnancy, prior reactions. Laser: Fitzpatrick skin type, medications.',
    booking_system_platform:    'Vagaro',
    active_channels:            'Instagram DMs, Website Chat, SMS, Email',
    business_phone_numbers:     '+1 (312) 555-0100',
    instagram_handle:           '@glowandgracespa',
    facebook_page:              'Glow & Grace Med Spa',
    website_url:                'https://glowandgrace.com',
    competitor_names:           'Pure Skin Chicago, The Aesthetic Lounge, Chicago Botox Bar',
    ai_tone:                    'Warm & luxury',
    ai_restrictions:            'Never quote prices without adding "starting at". Never discuss competitors by name. No medical outcome promises.',
    engines_selected:           'Engine A',
    addons_selected:            'No-Show Recovery, Review Generation',
    reputation_engine_selected: 'yes',
    priority_launch_channel:    'Instagram DMs',
  }, {}).then(result => {
    console.log('[cleo] Dry run complete. Client ID:', result.clientId);
    console.log('[cleo] Brand doc engines:', result.brandDoc?.system_blueprint?.engines_activated);
    console.log('[cleo] PDF URL:', result.pdfUrl);
  }).catch(err => {
    console.error('[cleo] Dry run error:', err);
    process.exit(1);
  });
}

module.exports = { handleStripeEvent, handleOnboardingSubmission };
