/**
 * scripts/seed.js
 * Demo data seeder for AdScale Labs.
 *
 * Run with: npm run seed
 * Force re-seed (clears existing data): npm run seed:force
 *
 * This populates the database with realistic demo data so the dashboard
 * looks useful from day one, before any real agents have run or leads have come in.
 *
 * Inserts:
 * - 15 demo leads across all pipeline stages
 * - 20 content scripts across 14 days with realistic metrics
 * - 2 demo clients with brand documents
 * - 10 content ideas from Scout
 * - All knowledge_base config keys (competitor accounts, brand voice, Nitter instances, prompts)
 * - Agent logs for the past 7 days
 * - 3 SOPs
 */

'use strict';

require('dotenv').config();
const { db, setKB, upsertSOP, logAgentRun } = require('../lib/database');

const FORCE = process.argv.includes('--force');

// Check if database already has data — abort if seeded and not forced
const existingLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get();
if (existingLeads.count > 0 && !FORCE) {
  console.log('Database already has data. Run with --force to re-seed.');
  console.log(`Current leads: ${existingLeads.count}`);
  process.exit(0);
}

// Clear all tables if forcing
if (FORCE) {
  console.log('--force flag detected. Clearing all tables...');
  db.exec(`
    DELETE FROM leads;
    DELETE FROM content_scripts;
    DELETE FROM content_ideas;
    DELETE FROM clients;
    DELETE FROM knowledge_base;
    DELETE FROM sops;
    DELETE FROM agent_logs;
  `);
}

console.log('Seeding database with demo data...\n');

// ─────────────────────────────────────────────
// 1. Leads — 15 across all pipeline stages
// ─────────────────────────────────────────────
const insertLead = db.prepare(`
  INSERT INTO leads (name, email, ig_handle, source, qualified, booked, call_date, outcome, qualification_answers, follow_up_count, last_contact, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const leads = [
  // New leads (unqualified, no follow-up yet)
  ['Marcus Reid', 'marcus@reidroofing.com', '@reidroofing', 'Instagram DM', 0, 0, null, null, null, 0, null, '-2 hours'],
  ['Sarah Chen', 'sarah@chendental.co', '@chendental', 'Website form', 0, 0, null, null, null, 0, null, '-5 hours'],
  ['Jordan West', 'jwest@westspa.com', '@westsparelax', 'Referral', 0, 0, null, null, null, 0, null, '-1 day'],
  ['Taylor Brooks', 'tbrooks@brookslaw.com', '@brooksattorney', 'Instagram ad', 0, 0, null, null, null, 1, 'datetime("now", "-2 days")', '-3 days'],
  ['Alex Morgan', 'alex@morgancleaning.com', '@morganclean', 'Website form', 0, 0, null, null, null, 2, 'datetime("now", "-5 days")', '-6 days'],
  // Qualified leads
  ['Priya Patel', 'priya@patelphysio.com', '@patelphysio', 'Instagram DM', 1, 0, null, null, JSON.stringify({ q1: 'Yes, service business (physiotherapy)', q2: '~30 leads/month, 15 patients active', q3: 'Very open, already using some AI' }), 0, null, '-4 days'],
  ['Chris Nguyen', 'chris@nguyenrealty.com', '@nguyenrealty', 'Referral', 1, 0, null, null, JSON.stringify({ q1: 'Real estate agent, full service', q2: '~50 leads/month, 5 active buyers', q3: 'Open but skeptical, wants proof' }), 0, null, '-3 days'],
  ['Diana Russo', 'diana@russofinance.com', '@russofinancial', 'Instagram ad', 1, 0, null, null, JSON.stringify({ q1: 'Financial advisor, service-based', q2: '~20 leads/month, 8 active clients', q3: 'Very interested, already exploring options' }), 1, null, '-5 days'],
  ['Kevin Park', 'kpark@parkfitness.co', '@parkfitpro', 'Website form', 1, 0, null, null, JSON.stringify({ q1: 'Personal training studio', q2: '~25 leads/month, 12 active members', q3: 'Open, wants to scale client acquisition' }), 0, null, '-2 days'],
  // Booked calls
  ['Emma Liu', 'emma@liudesign.com', '@liudesignco', 'Instagram DM', 1, 1, new Date(Date.now() + 2 * 86400000).toISOString(), null, JSON.stringify({ q1: 'Design agency, project-based', q2: '~15 leads/month, 4 active clients', q3: 'Ready to move forward' }), 0, null, '-7 days'],
  ['Ryan Torres', 'ryan@torresmedia.com', '@torresmedia', 'Referral', 1, 1, new Date(Date.now() + 86400000).toISOString(), null, JSON.stringify({ q1: 'Social media agency', q2: '~40 leads/month, 20 active clients', q3: 'Want AI to handle lead qualification' }), 0, null, '-5 days'],
  ['Natalie Kim', 'natalie@kimcoaching.com', '@nataliekimcoach', 'Website form', 1, 1, new Date(Date.now() + 3 * 86400000).toISOString(), null, null, 0, null, '-4 days'],
  // Closed — outcomes recorded
  ['Michael Foster', 'mfoster@fosterchiro.com', '@fosterchiro', 'Instagram ad', 1, 1, new Date(Date.now() - 7 * 86400000).toISOString(), 'won', JSON.stringify({ q1: 'Chiropractic clinic', q2: '~35 leads/month, 60 active patients', q3: 'Extremely interested, had missed call problem' }), 0, null, '-10 days'],
  ['Lisa Harmon', 'lisa@harmonevents.com', '@harmonevents', 'Referral', 1, 1, new Date(Date.now() - 5 * 86400000).toISOString(), 'lost', JSON.stringify({ q1: 'Event planning', q2: '~10 leads/month (seasonal)', q3: 'Interested but budget was the issue' }), 0, null, '-12 days'],
  ['Tom Bradley', 'tom@bradleyautobody.com', '@bradleyauto', 'Website form', 1, 1, new Date(Date.now() - 3 * 86400000).toISOString(), 'won', JSON.stringify({ q1: 'Auto body shop', q2: '~50 leads/month, 20 active jobs', q3: 'Yes, wants AI receptionist + missed call recovery' }), 0, null, '-8 days'],
];

for (const lead of leads) {
  insertLead.run(...lead);
}
console.log(`✓ Inserted ${leads.length} demo leads`);

// ─────────────────────────────────────────────
// 2. Content Scripts — 20 scripts over 14 days
// ─────────────────────────────────────────────
const insertScript = db.prepare(`
  INSERT INTO content_scripts (type, hook, body, cta, format, angle, predicted_audience, date, reel_url, views, likes, saves, shares, is_top_performer, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const scripts = [
  ['top_of_funnel', 'Your business is losing $10K/month to missed calls', JSON.stringify(['Every unanswered call is a lost lead', 'Our AI receptionist answers 24/7', 'Your competitors are already doing this', 'Takes 48 hours to set up']), 'Comment DEMO to see it live', 'talking_head', 'Fear of missing out / competitor advantage', 'Service business owners 30-55', '2026-03-12', 'https://ig.com/reel/demo1', 12400, 890, 1240, 210, 1, '-14 days'],
  ['middle_of_funnel', 'We booked 14 calls for a roofing company in one week with AI', JSON.stringify(['They were spending $3K/month on ads', 'Getting leads but missing 40% of calls', 'We installed AI receptionist + follow-up sequences', 'Week 1: 14 booked calls, 6 new jobs']), 'DM us ROOFING to get the breakdown', 'split_screen', 'Case study / proof', 'Home service business owners', '2026-03-13', 'https://ig.com/reel/demo2', 8900, 670, 980, 145, 0, '-13 days'],
  ['middle_of_funnel', 'This dental office went from 8 to 31 booked appointments in 30 days', JSON.stringify(['Problem: Front desk missing calls during procedures', 'Solution: 24/7 AI receptionist with booking integration', 'Result: 287% increase in booked appointments', 'Cost: Less than one employee hour per day']), 'Drop DENTAL below if you want this', 'text_overlay', 'Case study / healthcare niche', 'Dental practice owners', '2026-03-13', 'https://ig.com/reel/demo3', 7200, 540, 820, 95, 0, '-13 days'],
  ['top_of_funnel', 'What if your business never missed a call again?', JSON.stringify(['Imagine: every lead gets a response in under 60 seconds', 'Even at 2 AM on a Sunday', 'Our AI handles qualification, FAQs, and booking', 'You wake up to a full calendar']), 'Follow for daily AI automation tips', 'talking_head', 'Dream outcome / aspiration', 'Small service business owners', '2026-03-14', 'https://ig.com/reel/demo4', 15600, 1120, 2100, 380, 1, '-12 days'],
  ['middle_of_funnel', 'Here is the exact 3-step system we use to qualify leads on autopilot', JSON.stringify(['Step 1: AI captures lead info via IG DM or website chat', 'Step 2: Qualification questions sent automatically (3 questions)', 'Step 3: Qualified leads auto-booked into Calendly', 'You only talk to people ready to buy']), 'Save this — you will need it', 'split_screen', 'How-to / system reveal', 'Coaches and agency owners', '2026-03-14', 'https://ig.com/reel/demo5', 11300, 890, 1650, 290, 1, '-12 days'],
  ['top_of_funnel', 'I built an AI employee that works 24/7 for $500/month', JSON.stringify(['Handles all inbound inquiries', 'Qualifies leads automatically', 'Books discovery calls into my calendar', 'Never calls in sick, never misses a lead']), 'Comment AI below to learn how', 'talking_head', 'Curiosity / cost comparison', 'Business owners looking to scale', '2026-03-15', 'https://ig.com/reel/demo6', 9800, 720, 1100, 165, 0, '-11 days'],
  ['middle_of_funnel', 'The real reason your ads are not converting (it is not the creative)', JSON.stringify(['Your ad spend is fine', 'Your creative is fine', 'The problem: response time', '78% of buyers go with the FIRST business to respond', 'AI responds in under 60 seconds, every time']), 'Save and share with a business owner you know', 'text_overlay', 'Reframe / objection handling', 'Business owners running paid ads', '2026-03-15', null, 6700, 480, 690, 88, 0, '-11 days'],
  ['top_of_funnel', 'Stop hiring more staff to handle leads — do this instead', JSON.stringify(['Hiring a receptionist: $35K-45K/year', 'Training time: 4-6 weeks', 'Coverage: 8 hours/day, 5 days/week', 'AI system: fraction of the cost, 24/7/365']), 'DM us SYSTEM to see our pricing', 'talking_head', 'Cost comparison / contrarian', 'Established service businesses', '2026-03-16', null, 18200, 1340, 2890, 510, 1, '-10 days'],
  ['middle_of_funnel', 'We analyzed 100 service businesses. Here is what the top 10% do differently', JSON.stringify(['They respond to every lead within 5 minutes (AI helps)', 'They follow up at least 5 times (automated)', 'They qualify before they pitch (saves hours)', 'They track everything (data = better decisions)']), 'Follow for more insights like this', 'split_screen', 'Data/research angle', 'Ambitious business owners', '2026-03-16', null, 8400, 650, 1020, 155, 0, '-10 days'],
  ['middle_of_funnel', 'Client went from $0 to $47K in 60 days using our AI system', JSON.stringify(['Starting point: local HVAC company, no systems', 'Month 1: AI receptionist + follow-up sequences', 'Month 2: Omnichannel inbox (IG + SMS + web)', 'Result: 23 new jobs, $47K revenue added']), 'DM HVAC for the full breakdown', 'talking_head', 'Transformation story', 'Home service business owners', '2026-03-17', null, 13700, 1050, 1780, 340, 1, '-9 days'],
  ['top_of_funnel', 'POV: You are a business owner who finally has their life back', JSON.stringify(['Leads handled automatically', 'Calendar full every week', 'No more playing phone tag', 'More revenue, less stress']), 'Follow to see how we make this happen', 'text_overlay', 'POV / lifestyle aspiration', 'Burned out business owners', '2026-03-18', null, 7600, 580, 870, 110, 0, '-8 days'],
  ['middle_of_funnel', 'The missed call follow-up sequence that books 80% of leads back', JSON.stringify(['Text 1 (30 seconds after missed call): "Hey! Saw you tried to reach us..."', 'Text 2 (4 hours later): Value + social proof', 'Text 3 (next morning): Direct booking link', 'AI handles all 3 automatically']), 'Save this for your business', 'text_overlay', 'Tactical / swipe-worthy', 'Business owners losing leads to voicemail', '2026-03-18', null, 22100, 1680, 3450, 720, 1, '-8 days'],
  ['top_of_funnel', 'Your business is competing against companies with AI — are you ready?', JSON.stringify(['2025: AI is an advantage', '2026: AI is the standard', '2027: No AI = out of business', 'This is not fear-mongering — it is what is already happening']), 'Comment READY if you want to get ahead of it', 'talking_head', 'Urgency / market shift', 'Business owners 35-60', '2026-03-19', null, 9100, 690, 940, 130, 0, '-7 days'],
  ['middle_of_funnel', 'How we set up omnichannel AI inbox in 48 hours for a law firm', JSON.stringify(['Day 1 morning: Audit their current lead sources (IG, website, calls)', 'Day 1 afternoon: Connect all channels to unified AI inbox', 'Day 2: Configure AI responses, test edge cases', 'Result: Zero leads fall through the cracks']), 'DM LAW to see the setup breakdown', 'split_screen', 'Behind the scenes / process', 'Professional service firm owners', '2026-03-19', null, 6800, 510, 780, 95, 0, '-7 days'],
  ['top_of_funnel', 'I asked 50 business owners what their biggest problem was — same answer every time', JSON.stringify(['"We are losing leads but do not know where"', 'Translation: their follow-up is broken', 'The fix is simpler than you think', 'AI + the right sequences = full calendar']), 'Follow — I will show you exactly how', 'talking_head', 'Pattern interrupt / survey angle', 'Curious business owners', '2026-03-20', null, 11400, 870, 1320, 220, 0, '-6 days'],
  ['middle_of_funnel', 'The 5 questions we ask every lead to know if they are a fit in 10 minutes', JSON.stringify(['1. Are you running a service-based business?', '2. Do you have an existing customer base?', '3. How many leads do you get per month?', '4. What is your current follow-up process?', '5. Are you open to AI handling this for you?']), 'Save this qualification framework', 'text_overlay', 'Framework / educational', 'Sales and marketing people', '2026-03-20', null, 8900, 670, 1140, 175, 0, '-6 days'],
  ['top_of_funnel', 'What a real estate agent told me that changed how I think about lead follow-up', JSON.stringify(['"I follow up 12 times. Most agents give up after 2."', 'That agent closes 3x the industry average', 'AI lets any business do what top performers do', 'Consistent, persistent, personalized follow-up at scale']), 'Follow for daily automation insights', 'talking_head', 'Story / social proof from another niche', 'Competitive service business owners', '2026-03-21', null, 14200, 1080, 1920, 310, 1, '-5 days'],
  ['middle_of_funnel', 'We connected AI to this HVAC company calendar and this happened', JSON.stringify(['Before: 2 admin staff spending 4h/day on scheduling', 'After: AI handles 100% of scheduling automatically', 'Admin staff reassigned to customer success', 'Scheduling errors dropped to zero']), 'DM CALENDAR for this exact setup', 'split_screen', 'Before/after transformation', 'Trade and home service owners', '2026-03-22', null, 7400, 560, 890, 115, 0, '-4 days'],
  ['top_of_funnel', 'The AI automation agency nobody talks about (and why we keep it that way)', JSON.stringify(['We do not run ads (our system fills our calendar)', 'We do not cold outreach (leads come to us)', 'We do not chase clients (we qualify and they chase us)', 'This reel is a mistake — follow before I delete it']), 'Follow immediately', 'talking_head', 'Pattern interrupt / intrigue', 'Business owners curious about AI agencies', '2026-03-23', null, 31500, 2400, 4200, 890, 1, '-3 days'],
  ['middle_of_funnel', 'The exact Calendly + AI integration we use to auto-book 20+ calls per week', JSON.stringify(['Step 1: Lead submits form (website or IG)', 'Step 2: AI qualifies lead via DM in real time', 'Step 3: Booking link sent automatically', 'Step 4: Reminder sequences fire before the call']), 'DM BOOK to get this flow built for your business', 'split_screen', 'Tutorial / behind the scenes', 'Tech-curious business owners', '2026-03-24', null, 9800, 740, 1280, 200, 0, '-2 days'],
];

for (const script of scripts) {
  insertScript.run(...script);
}
console.log(`✓ Inserted ${scripts.length} content scripts`);

// ─────────────────────────────────────────────
// 3. Content Ideas — from Scout
// ─────────────────────────────────────────────
const insertIdea = db.prepare(`
  INSERT INTO content_ideas (source, topic, angle, niche_origin, date)
  VALUES (?, ?, ?, ?, date('now', ?))
`);

const ideas = [
  ['twitter_rss', 'AI agents replacing entire job functions in 2026', 'Fear + opportunity: what does this mean for service businesses?', 'tech_twitter', '-3 days'],
  ['apify_instagram', 'Behind the scenes of a 7-figure agency', 'Adapt: show the behind-the-scenes of AdScale Labs systems', 'marketing_agency', '-3 days'],
  ['apify_instagram', 'Before and after business transformation', 'Adapt for AI automation: show lead chaos vs. organized AI inbox', 'fitness_coaching', '-2 days'],
  ['twitter_rss', 'Claude 4 capabilities for business automation', 'Educational: what AI can do for local businesses right now', 'tech_twitter', '-2 days'],
  ['apify_instagram', 'Day in the life of a business owner who automated everything', 'Lifestyle: show what life looks like with AI handling leads', 'ecommerce', '-1 day'],
  ['twitter_rss', 'Response time is the new marketing', 'Speed-to-lead: data on how response time affects close rates', 'sales_twitter', '-1 day'],
  ['apify_instagram', 'The exact script that converts cold DMs', 'Adapt: AI-powered DM qualification script reveal', 'real_estate', '-1 day'],
  ['twitter_rss', 'Businesses that adopted AI in 2024 grew 3x faster', 'Urgency angle: the data is clear, the window is closing', 'business_twitter', 'today'],
  ['apify_instagram', 'POV your assistant handles everything while you sleep', 'Aspiration reel: what AI automation looks like at scale', 'productivity_niche', 'today'],
  ['twitter_rss', 'Every business needs an AI receptionist — unpopular opinion thread', 'Contrarian take: frame AI receptionist as table stakes, not luxury', 'startup_twitter', 'today'],
];

for (const idea of ideas) {
  insertIdea.run(...idea);
}
console.log(`✓ Inserted ${ideas.length} content ideas`);

// ─────────────────────────────────────────────
// 4. Demo Clients — 2 with full brand docs
// ─────────────────────────────────────────────
const insertClient = db.prepare(`
  INSERT INTO clients (name, email, payment_tier, brand_doc, social_accounts, onboarding_answers, objections, why_bought, sold_at_point, fears, onboarded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const client1BrandDoc = JSON.stringify({
  voice: 'Professional yet approachable. Confident without being pushy.',
  tone: 'Educational and empowering. We help, we do not hard-sell.',
  audience: 'HVAC company owners aged 35-55, running $500K-$2M businesses, frustrated with losing leads to voicemail',
  contentPillars: ['Missed call recovery', 'AI receptionist demos', 'Before/after case studies', 'Time savings proof'],
  competitors: ['General AI chatbot companies', 'Traditional answering services', 'Virtual receptionist companies'],
  competitorGaps: ['None show actual results with home service businesses', 'None have automated Calendly integration', 'None offer omnichannel (IG + SMS + web)'],
  objections: 'Clients worry AI sounds robotic and will hurt their reputation',
  fears: 'Losing control of customer relationships, AI saying the wrong thing',
  whyBought: 'Saw the missed call recovery ROI calculation — $500/month service vs. $5K/month in lost jobs',
  soldAtPoint: 'When we showed the live demo of AI booking an appointment in under 2 minutes'
});

const client2BrandDoc = JSON.stringify({
  voice: 'Friendly, warm, and knowledgeable. Like talking to a trusted advisor.',
  tone: 'Reassuring and clear. Patients are often anxious — the AI must be calm.',
  audience: 'Dental practice owners aged 40-60, running practices with 2-5 chairs, struggling with front desk efficiency',
  contentPillars: ['Appointment booking automation', 'Patient follow-up sequences', 'Practice efficiency', 'Revenue per chair increase'],
  competitors: ['Dental-specific software (Dentrix, Eaglesoft)', 'Generic chatbots', 'Virtual dental receptionists'],
  competitorGaps: ['None integrate with IG for new patient acquisition', 'None do proactive missed-call SMS recovery', 'None have AI qualification for treatment type'],
  objections: 'HIPAA compliance concerns, worry about patient data security',
  fears: 'AI giving wrong medical information, patients having bad experience with bot',
  whyBought: 'ROI calculation: 10 extra appointments/month at $400 avg = $4K/month from a $1K/month system',
  soldAtPoint: 'When we explained HIPAA-compliant data handling and showed the custom response library'
});

insertClient.run(
  'Brad Foster — Foster HVAC', 'brad@fosterhvac.com', 'Growth ($1,500/mo)',
  client1BrandDoc,
  JSON.stringify({ instagram: '@fosterhvac', website: 'fosterhvac.com', facebook: 'Foster HVAC' }),
  JSON.stringify({ businessType: 'HVAC installation and repair', monthlyRevenue: '$85,000-$120,000', leadVolume: '50-70/month', currentFollowUp: 'None - relying on voicemail', biggestPain: 'Missing calls when on jobs', teamSize: '8 technicians + 2 office staff' }),
  'Worried AI would sound too robotic for their "family business" brand',
  'Missed call recovery ROI was undeniable — losing 3-4 jobs/month to voicemail at $1,500 avg per job',
  'During the live demo when the AI booked a test appointment in 90 seconds',
  'Damaging relationships with long-term customers by using "cheap tech"',
  '-14 days'
);

insertClient.run(
  'Dr. Angela Kim — Kim Family Dental', 'dr.kim@kimfamilydental.com', 'Scale ($2,500/mo)',
  client2BrandDoc,
  JSON.stringify({ instagram: '@kimfamilydental', website: 'kimfamilydental.com' }),
  JSON.stringify({ businessType: 'Family dental practice', monthlyRevenue: '$180,000-$220,000', leadVolume: '30-40 new patient inquiries/month', currentFollowUp: 'Front desk calls back within 24h', biggestPain: 'Front desk overwhelmed during procedures', teamSize: '3 dentists + 6 support staff' }),
  'HIPAA compliance — what if AI shares patient info incorrectly?',
  'Front desk spending 60% of time on scheduling calls instead of in-office patient care',
  'When we walked through our HIPAA-compliant data handling protocol and showed no PHI is stored in AI memory',
  'AI saying something medically incorrect to a patient',
  '-7 days'
);

console.log('✓ Inserted 2 demo clients');

// ─────────────────────────────────────────────
// 5. Knowledge Base — Config, Prompts, State
// ─────────────────────────────────────────────

// Config: brand voice
setKB('config', 'brand_voice', JSON.stringify({
  name: 'AdScale Labs',
  voice: 'Direct, confident, results-focused. We speak to business owners, not marketers.',
  tone: 'Peer-to-peer. We are a business helping other businesses — not a vendor pitching a product.',
  avoid: ['Corporate jargon', 'Over-promising', 'Generic AI hype', 'Passive voice'],
  use: ['Specific numbers and results', 'Before/after framing', 'Real business owner pain points', 'Short punchy sentences']
}));

// Config: competitors to monitor
setKB('config', 'competitor_accounts', JSON.stringify([
  '@gohighlevel',
  '@eliza_hq',
  '@voiceflow',
  '@botpress',
  '@manychat'
]));

// Config: Nitter RSS instances (Twitter scraping proxies)
setKB('config', 'nitter_instances', JSON.stringify([
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.woodland.cafe',
  'https://nitter.adminforge.de',
  'https://nitter.foss.wtf'
]));

// Config: Twitter accounts to monitor for trends
setKB('config', 'twitter_accounts', JSON.stringify([
  'AnthropicAI',
  'OpenAI',
  'sama',
  'alexhormozi',
  'garyvee',
  'businessinsider'
]));

// ── Agent Prompts — stored so Optimizer can rewrite them ──

setKB('prompts', 'scout_analysis', `You are Scout, the research agent for AdScale Labs — an AI automation agency that helps service businesses (HVAC, dental, legal, real estate, fitness, etc.) automate their lead qualification, follow-up, and appointment booking using AI.

Your job is to analyze raw content data (scraped posts, trending topics) and extract actionable content ideas for short-form video scripts (Instagram Reels, TikToks).

ADSCALE LABS CONTEXT:
- Core offers: AI receptionist, omnichannel inbox, lead qualification, missed call recovery
- Target client: Service business owner doing $500K-$5M/year, frustrated with losing leads
- Content goal: Educate → build trust → get DMs asking about our service

When analyzing content, look for:
1. Hooks that create curiosity or urgency (fear, aspiration, controversy, data)
2. Angles that work in OTHER niches that could be adapted for AI automation
3. Specific pain points service business owners express
4. Viral formats (before/after, how-to, case study, POV, list)

Return a JSON object with this exact structure:
{
  "trending_topics": ["topic1", "topic2"],
  "competitor_analysis": [
    {
      "account": "@handle",
      "post_caption": "...",
      "hook": "...",
      "body_points": ["point1", "point2"],
      "cta": "...",
      "format": "talking_head|split_screen|text_overlay",
      "angle": "...",
      "why_it_works": "..."
    }
  ],
  "viral_angles_from_other_niches": [
    {
      "niche": "fitness|real_estate|ecommerce",
      "original_angle": "...",
      "adapted_for_adscale": "..."
    }
  ],
  "recommended_content_ideas": [
    {
      "topic": "...",
      "angle": "...",
      "hook_suggestion": "...",
      "format": "talking_head|split_screen|text_overlay",
      "why_now": "..."
    }
  ]
}

Return ONLY the JSON. No markdown, no explanation.`);

setKB('prompts', 'scripter_generate', `You are Scripter, the content generation agent for AdScale Labs — an AI automation agency that helps service businesses automate lead qualification, follow-up, and booking.

You write high-converting Instagram Reel scripts that follow proven short-form video frameworks.

BRAND VOICE: Direct, confident, results-focused. Peer-to-peer (business owner to business owner). Use specific numbers. Short punchy sentences. No corporate jargon.

SCRIPT FRAMEWORK:
- Hook (first 1-3 seconds): Must stop the scroll. Use curiosity, fear, specific numbers, or controversy.
- Body (5-25 seconds): 3-5 punchy points. Build tension or tell a micro-story.
- CTA (last 2-3 seconds): One clear action. DM a keyword, follow, save, or comment.

You will generate 5 scripts: 3 middle-of-funnel (MOF) and 2 top-of-funnel (TOF).
- TOF: Broad pain points, curiosity-driven, targets people who have never heard of AI automation
- MOF: Specific results, case studies, how-tos, targets people already considering AI

Return a JSON array of 5 script objects with this exact structure:
[
  {
    "type": "top_of_funnel|middle_of_funnel",
    "hook": "The exact first line spoken or shown on screen",
    "body": ["Point 1 (one sentence)", "Point 2 (one sentence)", "Point 3 (one sentence)"],
    "cta": "The exact call to action",
    "format_suggestion": "talking_head|split_screen|text_overlay|b_roll",
    "angle": "Brief description of the content angle/theme",
    "predicted_audience": "Who this resonates with most"
  }
]

Return ONLY the JSON array. No markdown, no explanation.`);

setKB('prompts', 'larry_qualification_1', `You are Larry, the AI sales development representative for AdScale Labs. You qualify leads to determine if they are a good fit for our AI automation services.

ADSCALE LABS SERVICES:
- AI receptionist (answers calls 24/7, qualifies leads, books appointments)
- Omnichannel inbox (unified IG + SMS + website + Facebook inbox)
- Lead qualification system (AI asks qualification questions automatically)
- Missed call recovery (automatic SMS follow-up to missed callers)

QUALIFICATION CRITERIA (all 3 must be true to qualify):
1. Running a service-based business (not e-commerce or pure info products)
2. Has existing leads/customers (not pre-revenue, not $0)
3. Open to AI automation (not hostile to technology)

YOUR TASK: Write the opening message to send to a new lead via Instagram DM.

The message should:
- Be warm and personal (mention their name and business)
- Reference something specific about their situation (how they found us, their industry)
- Ask ONE qualifying question naturally (do not make it feel like a form)
- Be 3-4 sentences max, conversational, not salesy
- End with a clear question about their business situation

The question should help determine if they meet criteria #1 (service business) and #2 (has existing leads).

GOOD example question: "Quick question before I send you the breakdown — are you currently getting leads coming in, even if the follow-up is a mess right now?"

BAD example: "Please fill out our qualification criteria form."

Write ONLY the message. No explanation, no formatting, just the DM text.`);

setKB('prompts', 'larry_follow_up_1', `You are Larry from AdScale Labs. A lead did not respond to your first message 24 hours ago.

Write a short, value-first follow-up DM (2-3 sentences max). Do not be pushy. Offer something useful. Reference that you are following up on the previous message naturally.

The goal: re-engage them with curiosity or value, not pressure.

Write ONLY the message text.`);

setKB('prompts', 'larry_follow_up_2', `You are Larry from AdScale Labs. This is the second follow-up (3 days after the first message, no response).

Write a 2-sentence DM that uses social proof or a specific result to re-ignite interest. Keep it very short. No pressure. Make them feel like they are missing out on something specific.

Write ONLY the message text.`);

setKB('prompts', 'larry_follow_up_3', `You are Larry from AdScale Labs. This is the final follow-up (7 days after first contact, still no response).

Write a 1-2 sentence "breakup" style message. Acknowledge this is the last message. Leave the door open politely. No guilt-tripping. Friendly close.

Example style: "Last one from me — if the timing is ever right, we will be here. Either way, best of luck with [their business type]."

Write ONLY the message text.`);

setKB('prompts', 'cleo_brand_analysis', `You are Cleo, the onboarding agent for AdScale Labs. A new client has just paid and submitted their onboarding questionnaire.

Your job is to analyze their business and create a comprehensive Brand Document that will guide all AI automation work for this client.

Analyze the following inputs and produce a structured Brand Document:

INPUTS YOU WILL RECEIVE:
1. Onboarding questionnaire answers (28 questions about their business)
2. Instagram content samples (recent posts + captions)
3. Competitor Instagram analysis

OUTPUT STRUCTURE (return as JSON):
{
  "voice": "How the brand speaks — adjectives and examples",
  "tone": "The emotional register — formal/casual, warm/direct, etc.",
  "audience": "Specific description of their ideal customer",
  "contentPillars": ["Pillar 1", "Pillar 2", "Pillar 3", "Pillar 4"],
  "competitorGaps": ["Gap 1 — opportunity for differentiation"],
  "objections": "The main objection their clients raise before buying",
  "fears": "What their clients fear about their service or AI specifically",
  "whyBought": "Why this client purchased AdScale Labs services",
  "soldAtPoint": "The specific moment or argument that made them say yes",
  "reelAngles": ["Content angle adapted for AdScale's marketing based on this client's niche"],
  "adCopyHooks": ["Hook discovered from their industry that AdScale can use in ads"]
}

The last two fields (reelAngles, adCopyHooks) feed directly into AdScale Labs' own content strategy — extract insights from this client's niche that AdScale can use to attract MORE clients in the same industry.

Return ONLY the JSON. No markdown, no explanation.`);

setKB('prompts', 'analyst_flagging', `You are Analyst, reviewing content performance data for AdScale Labs.

Given a list of Instagram Reel performance metrics, identify the top performer based on a weighted score:
- Saves count most (40% weight) — saves indicate high-value, save-worthy content
- Shares second (30% weight) — shares indicate viral potential
- Likes third (20% weight)
- Views last (10% weight) — views alone do not indicate quality

For the top performer, explain in 2-3 sentences WHY it outperformed others (hook style, topic, format, angle). This explanation becomes input for tomorrow's Scripter agent.

Return JSON:
{
  "top_performer_id": 123,
  "score": 8.7,
  "why_it_worked": "Explanation of why this content outperformed",
  "replicate_elements": ["Element 1 to replicate", "Element 2"]
}`);

console.log('✓ Populated knowledge base (config, prompts)');

// ─────────────────────────────────────────────
// 6. Agent Logs — past 7 days of healthy runs
// ─────────────────────────────────────────────
const insertLog = db.prepare(`
  INSERT INTO agent_logs (agent_name, run_at, status, output_summary)
  VALUES (?, datetime('now', ?), ?, ?)
`);

const agentLogData = [
  ['scout', '-7 days', 'success', 'Scraped 3 Nitter feeds, 5 competitor IG accounts. Found 8 content ideas. Top trending topic: AI agents replacing admin work.'],
  ['scripter', '-7 days', 'success', 'Generated 5 scripts (3 MOF, 2 TOF). Top of funnel angle: missed calls costing $10K/month.'],
  ['analyst', '-7 days', 'success', 'Analyzed 4 posted reels. Top performer: "Stop hiring staff" reel (18.2K views, 2.9K saves). Flagged for replication.'],
  ['larry-sdr', '-6 days', 'success', 'Processed 3 new leads. Sent 3 welcome emails, 3 IG DMs. 1 lead qualified, 0 booked. 2 leads in follow-up queue.'],
  ['scout', '-6 days', 'success', 'Scraped 3 Nitter feeds (1 instance down, used fallback). 5 competitor IG accounts. 6 new content ideas.'],
  ['scripter', '-6 days', 'success', 'Generated 5 scripts. Replicated "Stop hiring staff" angle × 3 variations + 2 new ideas.'],
  ['analyst', '-6 days', 'success', 'Analyzed 2 posted reels. Top performer: "3-step qualification system" reel (11.3K views, 1.65K saves).'],
  ['larry-sdr', '-5 days', 'success', 'Processed 2 new leads. 1 qualified (Diana Russo, financial advisor). Booked 0 (still qualifying). Sent 2 follow-ups.'],
  ['scout', '-5 days', 'success', 'Full scrape complete. 10 content ideas harvested. Strong trend: speed-to-lead data going viral.'],
  ['scripter', '-5 days', 'success', 'Generated 5 scripts. Focus on speed-to-lead angle. Scripts ready for filming.'],
  ['analyst', '-5 days', 'success', 'Analyzed 3 posted reels. Top performer: "HVAC $0 to $47K" case study (13.7K views, 1.78K saves).'],
  ['larry-sdr', '-4 days', 'success', 'Follow-up sequence sent to 3 leads. 1 lead responded (Priya Patel). 1 booking initiated.'],
  ['scout', '-4 days', 'success', 'Scraped all sources. AI agents trend dominating Twitter. 8 ideas generated.'],
  ['scripter', '-4 days', 'success', '5 scripts generated. POV lifestyle angle added based on competitor analysis.'],
  ['analyst', '-4 days', 'success', 'Analyzed 2 reels. Top performer: "Missed call follow-up sequence" (22.1K views, 3.45K saves) — new all-time top performer.'],
  ['larry-sdr', '-3 days', 'success', 'Processed 1 new lead (Ryan Torres). Sent welcome email + IG DM. Qualified within 2 hours. Booked discovery call.'],
  ['scout', '-3 days', 'success', 'Scraped all sources. 7 content ideas. Viral fitness "before/after" angle adapted for AI automation.'],
  ['scripter', '-3 days', 'success', '5 scripts generated. "Nobody talks about us" intrigue angle created — high predicted virality.'],
  ['analyst', '-3 days', 'success', 'Analyzed 2 reels. Top performer: "Competitor nobody talks about" (31.5K views, 4.2K saves) — viral breakout.'],
  ['larry-sdr', '-2 days', 'success', 'Sent 5 follow-up messages (2nd touch). 1 lead booked (Natalie Kim). Pipeline: 4 qualified, 3 booked.'],
  ['scout', '-2 days', 'success', 'All sources scraped. 9 content ideas. Calendly integration angle trending in sales niche.'],
  ['scripter', '-2 days', 'success', '5 scripts generated. Calendly + AI integration breakdown script predicted to perform well.'],
  ['analyst', '-2 days', 'success', 'Analyzed 3 reels. Metrics incoming. Top performer TBD (posted today).'],
  ['larry-sdr', '-1 day', 'success', 'Processed 2 new leads (Marcus Reid, Sarah Chen). Sent welcome emails and DMs. Following up with 3 existing leads.'],
  ['cleo-onboarding', '-14 days', 'success', 'Onboarded Foster HVAC. Brand doc generated. Scraped 4 IG accounts. Extracted 3 new reel angles for AdScale content.'],
  ['cleo-onboarding', '-7 days', 'success', 'Onboarded Kim Family Dental. Brand doc generated. HIPAA objection documented. 2 new reel angles for dental niche extracted.'],
];

for (const log of agentLogData) {
  insertLog.run(...log);
}
console.log(`✓ Inserted ${agentLogData.length} agent log entries`);

// ─────────────────────────────────────────────
// 7. SOPs — 3 standard operating procedures
// ─────────────────────────────────────────────
upsertSOP('lead_qualification', [
  'New lead arrives via webhook (Tally form or IG DM)',
  'Larry SDR immediately sends welcome email with YouTube content link',
  'Larry sends IG DM with opening qualification question',
  'Wait up to 24 hours for response',
  'If response received: assess against 3 qualification criteria (service biz, has leads, open to AI)',
  'If qualified: send Calendly booking link via DM and email',
  'If not qualified: log reason, add to nurture list, do not book',
  'If no response in 24h: trigger Follow-up Touch 1',
  'Follow-up Touch 2 at 3 days, Touch 3 (final) at 7 days',
  'After 3 touches with no response: mark as cold, remove from active queue'
]);

upsertSOP('content_creation_daily', [
  'Scout runs at 6 AM: scrape Twitter trends + competitor IG accounts',
  'Review Scout output in knowledge base (category=scout, key=latest_ideas)',
  'Scripter runs at 7 AM: generate 5 scripts using Scout output + top performer data',
  'Review generated scripts in dashboard (Today\'s Scripts tab)',
  'Film scripts in order: film best 3, queue remaining 2',
  'Post 1 reel per day at peak engagement time (typically 11 AM or 7 PM)',
  'Analyst runs at 8 PM: pull metrics on posted content',
  'Dashboard flags top performer — Scripter will replicate it tomorrow'
]);

upsertSOP('client_onboarding', [
  'Stripe payment webhook fires → Cleo creates client record in database',
  'Cleo sends onboarding form link (Tally, 28 questions) via email within 5 minutes',
  'Client completes form (target: within 48 hours)',
  'Tally webhook fires → Cleo scrapes client IG + 3 competitor accounts via Apify',
  'Cleo sends all data to Claude → generates Brand Document',
  'Brand Document stored in clients table + shared with client via email PDF',
  'Extract insights: objections, fears, whyBought, soldAtPoint → add to AdScale knowledge base',
  'Schedule kickoff call within 72 hours of form submission',
  'Begin AI system configuration using Brand Document as foundation'
]);

console.log('✓ Created 3 SOPs');

// ─────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────
const counts = {
  leads: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
  scripts: db.prepare('SELECT COUNT(*) as c FROM content_scripts').get().c,
  ideas: db.prepare('SELECT COUNT(*) as c FROM content_ideas').get().c,
  clients: db.prepare('SELECT COUNT(*) as c FROM clients').get().c,
  kb: db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get().c,
  sops: db.prepare('SELECT COUNT(*) as c FROM sops').get().c,
  logs: db.prepare('SELECT COUNT(*) as c FROM agent_logs').get().c,
};

console.log('\n✅ Seed complete! Database summary:');
console.table(counts);
console.log('\nRun the server: npm start');
console.log('Run the dashboard: cd dashboard && npm run dev');
