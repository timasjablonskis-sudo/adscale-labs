/**
 * lib/pdf-generator.js
 * Generates the client-facing Brand Document PDF.
 *
 * Uses Puppeteer to render a styled HTML template and export to PDF.
 * Falls back to saving an HTML file if Puppeteer isn't available — the
 * HTML can be opened in any browser and printed to PDF.
 *
 * Output: ./data/pdfs/{clientId}-brand-doc.pdf (or .html as fallback)
 * Returns: the server-relative URL path to the generated file.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PDF_DIR = path.join(__dirname, '..', 'data', 'pdfs');

// Ensure output directory exists
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// ─────────────────────────────────────────────
// HTML Template
// ─────────────────────────────────────────────

function buildHtml(client, doc) {
  const profile    = doc.client_profile    || {};
  const blueprint  = doc.system_blueprint  || {};
  const personality = doc.ai_personality   || {};
  const tkb        = doc.treatment_knowledge_base || {};
  const roi        = doc.roi_projections   || {};
  const comp       = doc.competitive_positioning  || {};

  const engines  = (blueprint.engines_activated  || []).join(', ') || 'Not specified';
  const addons   = (blueprint.addons_activated   || []);
  const repEng   = blueprint.reputation_engine ? 'Yes' : 'No';
  const priority = blueprint.priority_launch_channel || 'Not specified';

  const rollout  = blueprint.channel_rollout_plan || {};
  const rolloutRows = Object.entries(rollout).map(([week, channels]) =>
    `<tr><td>${week.replace('_', ' ')}</td><td>${(channels || []).join(', ')}</td></tr>`
  ).join('');

  const topTreatments = (tkb.top_treatments || []).map(t =>
    `<li>${typeof t === 'string' ? t : t.name || JSON.stringify(t)}</li>`
  ).join('');

  const neverSay = (personality.never_say || []).map(s => `<span class="tag tag-red">${s}</span>`).join('');
  const vocab    = (personality.brand_vocabulary || []).map(s => `<span class="tag tag-blue">${s}</span>`).join('');

  const competitors = (comp.competitors || []).map(c => `<li>${c}</li>`).join('');
  const advantages  = (comp.client_unique_advantages || []).map(a => `<li>${a}</li>`).join('');

  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Front Desk Blueprint — ${profile.business_name || client.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #fff;
      color: #1a1a2e;
      font-size: 13px;
      line-height: 1.6;
    }
    .page { max-width: 860px; margin: 0 auto; padding: 48px 56px; }

    /* HEADER */
    .header {
      border-bottom: 3px solid #6366f1;
      padding-bottom: 28px;
      margin-bottom: 36px;
    }
    .header-logo {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #6366f1;
      margin-bottom: 12px;
    }
    .header h1 {
      font-size: 26px;
      font-weight: 800;
      color: #1a1a2e;
      line-height: 1.2;
    }
    .header .subtitle {
      font-size: 14px;
      color: #64748b;
      margin-top: 6px;
    }
    .header .meta {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 10px;
    }

    /* SECTIONS */
    .section {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #6366f1;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 14px;
    }

    /* EXEC SUMMARY */
    .exec-summary {
      background: #f8faff;
      border-left: 4px solid #6366f1;
      padding: 18px 22px;
      border-radius: 0 8px 8px 0;
      font-size: 13.5px;
      color: #334155;
      line-height: 1.7;
    }

    /* ENGINES GRID */
    .engines-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .engine-card {
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px 18px;
    }
    .engine-card.active {
      border-color: #6366f1;
      background: #f5f3ff;
    }
    .engine-card .engine-name {
      font-weight: 700;
      font-size: 13px;
      color: #1a1a2e;
      margin-bottom: 4px;
    }
    .engine-card .engine-desc {
      font-size: 11.5px;
      color: #64748b;
    }
    .engine-card .status-dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      margin-right: 5px;
    }
    .dot-active { background: #22c55e; }
    .dot-inactive { background: #cbd5e1; }

    /* ADDONS */
    .addons-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    /* TAGS */
    .tag {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 500;
    }
    .tag-purple { background: #ede9fe; color: #6d28d9; }
    .tag-green  { background: #dcfce7; color: #166534; }
    .tag-blue   { background: #dbeafe; color: #1e40af; }
    .tag-red    { background: #fee2e2; color: #991b1b; }
    .tag-gray   { background: #f1f5f9; color: #475569; }

    /* ROLLOUT TABLE */
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12.5px; }
    th { font-weight: 600; color: #475569; background: #f8faff; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; }

    /* PERSONALITY PREVIEW */
    .speech-bubble {
      background: #f8faff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 12px;
      font-size: 13px;
      color: #334155;
      line-height: 1.7;
      font-style: italic;
    }
    .speech-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 6px;
    }

    /* ROI */
    .roi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    .roi-card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .roi-number {
      font-size: 22px;
      font-weight: 800;
      color: #6366f1;
      line-height: 1;
      margin-bottom: 4px;
    }
    .roi-label {
      font-size: 11px;
      color: #64748b;
    }

    /* NEXT STEPS */
    .steps-list {
      counter-reset: step;
      list-style: none;
      padding: 0;
    }
    .steps-list li {
      counter-increment: step;
      padding: 10px 0 10px 44px;
      position: relative;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
      color: #334155;
    }
    .steps-list li:last-child { border-bottom: none; }
    .steps-list li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 10px;
      width: 26px; height: 26px;
      background: #6366f1;
      color: #fff;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 26px;
      text-align: center;
    }

    /* UL */
    ul.doc-list { padding-left: 18px; }
    ul.doc-list li { margin-bottom: 5px; color: #334155; }

    /* FOOTER */
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer .brand { font-size: 11px; font-weight: 700; color: #6366f1; letter-spacing: 0.1em; }
    .footer .date  { font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-logo">AdScale Labs</div>
    <h1>Your Custom AI Front Desk Blueprint</h1>
    <div class="subtitle">${profile.business_name || client.name}</div>
    <div class="meta">Prepared ${now} &nbsp;·&nbsp; Confidential</div>
  </div>

  <!-- EXECUTIVE SUMMARY -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="exec-summary">
      We're building a <strong>Med Spa Native AI Front Desk</strong> for ${profile.business_name || client.name} —
      a done-for-you automation system that captures and converts leads 24/7 across every channel you use.
      Based on your intake, we're activating <strong>${engines}</strong> with a priority launch on
      <strong>${priority}</strong> within 48 hours. This system is designed to address your primary challenge:
      <em>${profile.primary_pain_point || 'missed leads and slow follow-up'}</em> — and is projected to recover
      <strong>${roi.projected_monthly_revenue_recovery || 'significant'}</strong> in monthly revenue by recapturing
      leads that currently fall through the cracks.
    </div>
  </div>

  <!-- SYSTEM OVERVIEW -->
  <div class="section">
    <div class="section-title">System Overview</div>
    <div class="engines-grid">
      <div class="engine-card ${(blueprint.engines_activated || []).includes('Engine A') ? 'active' : ''}">
        <div class="engine-name">
          <span class="status-dot ${(blueprint.engines_activated || []).includes('Engine A') ? 'dot-active' : 'dot-inactive'}"></span>
          Engine A: Omni-Channel Concierge
        </div>
        <div class="engine-desc">Unified inbox — IG, FB, Website Chat, Email, SMS. 748 triggers.</div>
      </div>
      <div class="engine-card ${(blueprint.engines_activated || []).includes('Engine B') ? 'active' : ''}">
        <div class="engine-name">
          <span class="status-dot ${(blueprint.engines_activated || []).includes('Engine B') ? 'dot-active' : 'dot-inactive'}"></span>
          Engine B: Omni Voice Receptionist
        </div>
        <div class="engine-desc">24/7 voice AI for inbound calls. Books appointments in-call. 132 triggers.</div>
      </div>
    </div>
    ${addons.length > 0 ? `
    <div style="margin-bottom:10px;"><strong style="font-size:12px;">Active Add-ons</strong></div>
    <div class="addons-list">
      ${addons.map(a => `<span class="tag tag-purple">${a}</span>`).join('')}
    </div>
    ` : ''}
    ${blueprint.reputation_engine ? `
    <div style="margin-top:12px;">
      <span class="tag tag-green">+ Reputation Response Engine (Google Reviews)</span>
    </div>
    ` : ''}
  </div>

  <!-- AI PERSONALITY PREVIEW -->
  <div class="section">
    <div class="section-title">AI Personality Preview</div>
    <div><strong style="font-size:12px;">Tone:</strong> <span style="color:#6366f1;">${personality.tone || 'Not specified'}</span></div>
    <div style="margin:8px 0 14px;"><strong style="font-size:12px;">Style:</strong> ${personality.voice_style || ''}</div>
    ${personality.greeting_template ? `
    <div class="speech-label">Sample Greeting</div>
    <div class="speech-bubble">"${personality.greeting_template}"</div>
    ` : ''}
    ${personality.closing_template ? `
    <div class="speech-label">Sample Closing</div>
    <div class="speech-bubble">"${personality.closing_template}"</div>
    ` : ''}
    ${vocab ? `<div style="margin-top:12px;"><strong style="font-size:12px;">Brand vocabulary:</strong></div><div style="margin-top:6px;">${vocab}</div>` : ''}
    ${neverSay ? `<div style="margin-top:12px;"><strong style="font-size:12px;">Never say:</strong></div><div style="margin-top:6px;">${neverSay}</div>` : ''}
  </div>

  <!-- TOP TREATMENTS -->
  ${topTreatments ? `
  <div class="section">
    <div class="section-title">Top Revenue-Driving Treatments</div>
    <ul class="doc-list">${topTreatments}</ul>
  </div>
  ` : ''}

  <!-- CHANNEL ROLLOUT -->
  ${rolloutRows ? `
  <div class="section">
    <div class="section-title">Channel Rollout Timeline</div>
    <table>
      <thead><tr><th>Timeline</th><th>Channels Going Live</th></tr></thead>
      <tbody>${rolloutRows}</tbody>
    </table>
  </div>
  ` : ''}

  <!-- COMPETITIVE POSITIONING -->
  ${advantages || competitors ? `
  <div class="section">
    <div class="section-title">Competitive Positioning</div>
    ${competitors ? `<div style="margin-bottom:10px;"><strong style="font-size:12px;">Monitoring competitors:</strong><ul class="doc-list" style="margin-top:6px;">${competitors}</ul></div>` : ''}
    ${advantages ? `<div><strong style="font-size:12px;">Your unique advantages the AI will highlight:</strong><ul class="doc-list" style="margin-top:6px;">${advantages}</ul></div>` : ''}
    ${comp.differentiators_for_ai_responses ? `<div style="margin-top:10px; font-size:12.5px; color:#334155;">${comp.differentiators_for_ai_responses}</div>` : ''}
  </div>
  ` : ''}

  <!-- ROI PROJECTIONS -->
  <div class="section">
    <div class="section-title">ROI Projections</div>
    <div class="roi-grid">
      <div class="roi-card">
        <div class="roi-number">${roi.projected_lead_recovery_rate || '30–50%'}</div>
        <div class="roi-label">Missed lead recovery rate</div>
      </div>
      <div class="roi-card">
        <div class="roi-number">${roi.projected_no_show_reduction || '50–70%'}</div>
        <div class="roi-label">No-show reduction</div>
      </div>
      <div class="roi-card">
        <div class="roi-number">${roi.projected_monthly_revenue_recovery || 'Est. $3K–$12K'}</div>
        <div class="roi-label">Projected monthly revenue recovery</div>
      </div>
    </div>
    ${roi.months_to_roi ? `<div style="margin-top:14px;font-size:12.5px;color:#64748b;">Estimated time to full ROI: <strong style="color:#1a1a2e;">${roi.months_to_roi}</strong></div>` : ''}
    <div style="margin-top:8px;font-size:11px;color:#94a3b8;">${roi.calculation_methodology || 'Based on industry benchmarks: 62% of med spa leads never receive follow-up, 44-hour avg response time, 80% conversion loss after 5-minute window.'}</div>
  </div>

  <!-- WHAT HAPPENS NEXT -->
  <div class="section">
    <div class="section-title">What Happens Next — 48-Hour Go-Live Plan</div>
    <ol class="steps-list">
      <li><strong>Now:</strong> Your Brand Document is confirmed. Our build team reviews your system configuration.</li>
      <li><strong>Within 4 hours:</strong> We connect your ${priority || 'priority channel'} and load your treatment knowledge base into the AI.</li>
      <li><strong>Within 24 hours:</strong> AI personality is configured and tested with sample lead scenarios specific to your top treatments.</li>
      <li><strong>48 hours:</strong> ${priority || 'Priority channel'} goes live. You'll receive a notification with a test conversation link.</li>
      <li><strong>Week 1–2:</strong> Remaining channels rolled out per the timeline above. You receive a performance summary at the end of week 2.</li>
    </ol>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="brand">ADSCALE LABS</div>
    <div class="date">Generated ${now} &nbsp;·&nbsp; Confidential — for ${profile.business_name || client.name} only</div>
  </div>

</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────

/**
 * Generate the Brand Document PDF (or HTML fallback) for a client.
 * @param {object} client  - client DB row { id, name, email, ... }
 * @param {object} brandDoc - parsed brand document JSON
 * @returns {Promise<string>} server-relative URL path, e.g. '/data/pdfs/3-brand-doc.pdf'
 */
async function generateBrandDocPDF(client, brandDoc) {
  const html     = buildHtml(client, brandDoc);
  const baseName = `${client.id}-brand-doc`;
  const htmlPath = path.join(PDF_DIR, `${baseName}.html`);
  const pdfPath  = path.join(PDF_DIR, `${baseName}.pdf`);

  // Always write the HTML (used as fallback and for debugging)
  fs.writeFileSync(htmlPath, html, 'utf8');

  // Attempt PDF generation via Puppeteer
  try {
    const puppeteer = require('puppeteer');
    const browser   = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page      = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path:   pdfPath,
      format: 'Letter',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });

    await browser.close();
    console.log(`[pdf] Generated PDF: ${pdfPath}`);
    return `/data/pdfs/${baseName}.pdf`;

  } catch (err) {
    // Puppeteer not installed or failed — return HTML fallback
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('[pdf] Puppeteer not installed — serving HTML fallback. Run: npm install puppeteer');
    } else {
      console.error(`[pdf] Puppeteer error — falling back to HTML: ${err.message}`);
    }
    return `/data/pdfs/${baseName}.html`;
  }
}

module.exports = { generateBrandDocPDF };
