/**
 * lib/webhooks.js
 * Webhook route handlers for AdScale Labs.
 *
 * Handles:
 * - POST /webhooks/lead       → Tally form submission (new lead for Larry)
 * - POST /webhooks/stripe     → Stripe payment event (new client for Cleo)
 * - POST /webhooks/onboarding → Tally onboarding form (28 questions for Cleo)
 *
 * IMPORTANT: The Stripe route MUST use express.raw() for body parsing.
 * Stripe's SDK requires access to the raw request body bytes to verify
 * the webhook signature. If express.json() parses first, the raw body
 * is destroyed and signature verification will always fail.
 *
 * In server.js, register the Stripe route BEFORE app.use(express.json()).
 */

'use strict';

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Lazy-load agents to avoid circular dependency issues
// (server.js requires webhooks.js; agents require database.js which is fine)
let larry = null;
let cleo = null;

function getLarry() {
  if (!larry) larry = require('../agents/larry-sdr');
  return larry;
}

function getCleo() {
  if (!cleo) cleo = require('../agents/cleo-onboarding');
  return cleo;
}

// ─────────────────────────────────────────────
// Tally Webhook Signature Verification
// Tally signs webhooks with HMAC-SHA256 using your webhook secret.
// The signature is in the X-Tally-Signature header.
// ─────────────────────────────────────────────

function verifyTallySignature(rawBody, signature) {
  if (!process.env.TALLY_WEBHOOK_SECRET) {
    // If no secret configured, skip verification (dev mode)
    console.warn('[webhooks] TALLY_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }

  if (!signature) {
    console.warn('[webhooks] No Tally signature header received');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', process.env.TALLY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Parse Tally Form Data
// Tally sends field data as an array of { key, label, value } objects.
// This converts it to a simple { key: value } object for easier handling.
// ─────────────────────────────────────────────

function parseTallyFields(fields) {
  if (!fields || !Array.isArray(fields)) return {};
  return fields.reduce((acc, field) => {
    acc[field.key] = field.value;
    acc[field.label] = field.value; // Also index by label for human-readable access
    return acc;
  }, {});
}

// ─────────────────────────────────────────────
// Route: POST /webhooks/lead
// Triggered when someone submits the lead capture form (Tally/Typeform).
// Passes data to Larry SDR who handles everything from here.
// ─────────────────────────────────────────────

async function handleLeadWebhook(req, res) {
  try {
    // Verify Tally signature
    const rawBody = JSON.stringify(req.body); // Re-stringify since express.json() already parsed
    const signature = req.headers['x-tally-signature'];

    if (!verifyTallySignature(rawBody, signature)) {
      console.warn('[webhooks] Lead webhook: invalid Tally signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse the form fields from Tally's payload format
    const payload = req.body;
    const fields = parseTallyFields(payload.data?.fields);

    // Extract standard lead fields — adjust these keys to match your Tally form field IDs
    const leadData = {
      name: fields['name'] || fields['full_name'] || fields['Name'] || payload.data?.respondentId || 'Unknown',
      email: fields['email'] || fields['Email'] || fields['email_address'] || '',
      ig_handle: fields['instagram'] || fields['ig_handle'] || fields['Instagram handle'] || null,
      source: fields['how_did_you_find_us'] || fields['source'] || payload.formName || 'tally_form',
    };

    // Validate minimum required fields
    if (!leadData.email) {
      console.warn('[webhooks] Lead webhook: missing email address');
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Immediately acknowledge to Tally (they require a fast response)
    res.status(200).json({ received: true, message: 'Lead received' });

    // Process the lead asynchronously (so we don't block Tally's webhook timeout)
    setImmediate(async () => {
      try {
        const result = await getLarry().processLead(leadData);
        console.log(`[webhooks] Lead processed: ID ${result.leadId}`);
      } catch (err) {
        console.error(`[webhooks] Error processing lead: ${err.message}`);
      }
    });

  } catch (err) {
    console.error(`[webhooks] Lead webhook error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// ─────────────────────────────────────────────
// Route: POST /webhooks/stripe
// Triggered when Stripe sends a payment event (charge.succeeded, payment_intent.succeeded, etc.)
// IMPORTANT: This route must receive the RAW body (not JSON-parsed) for Stripe signature verification.
// In server.js, this route is registered with express.raw() before express.json().
// ─────────────────────────────────────────────

async function handleStripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    // stripe.webhooks.constructEvent() needs the raw body Buffer, not a parsed object
    // This works because server.js registers this route with express.raw()
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`[webhooks] Stripe signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  // Immediately acknowledge to Stripe (important — Stripe retries if no quick response)
  res.status(200).json({ received: true });

  // Handle the event asynchronously
  setImmediate(async () => {
    try {
      // We only care about successful payments
      if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
        const paymentData = event.data.object;
        await getCleo().handleStripeEvent(paymentData, event.type);
      } else if (event.type === 'customer.subscription.created') {
        await getCleo().handleStripeEvent(event.data.object, event.type);
      } else {
        console.log(`[webhooks] Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err) {
      console.error(`[webhooks] Error handling Stripe event ${event.type}: ${err.message}`);
    }
  });
}

// ─────────────────────────────────────────────
// Route: POST /webhooks/onboarding
// Triggered when a new client submits the 28-question onboarding form (Tally).
// Passes data to Cleo who generates the Brand Document.
// ─────────────────────────────────────────────

async function handleOnboardingWebhook(req, res) {
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-tally-signature'];

    if (!verifyTallySignature(rawBody, signature)) {
      console.warn('[webhooks] Onboarding webhook: invalid Tally signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const fields = parseTallyFields(payload.data?.fields);

    // Immediately acknowledge
    res.status(200).json({ received: true, message: 'Onboarding form received' });

    // Process asynchronously
    setImmediate(async () => {
      try {
        await getCleo().handleOnboardingSubmission(fields, payload);
        console.log('[webhooks] Onboarding form processed by Cleo');
      } catch (err) {
        console.error(`[webhooks] Error in onboarding processing: ${err.message}`);
      }
    });

  } catch (err) {
    console.error(`[webhooks] Onboarding webhook error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// ─────────────────────────────────────────────
// Route: POST /webhooks/lead-response
// Optional: handle when a lead responds to a qualification question via a web form.
// This allows the qualification loop to continue without requiring IG integration.
// ─────────────────────────────────────────────

async function handleLeadResponse(req, res) {
  try {
    const { leadId, response } = req.body;

    if (!leadId || !response) {
      return res.status(400).json({ error: 'leadId and response are required' });
    }

    res.status(200).json({ received: true });

    setImmediate(async () => {
      try {
        const result = await getLarry().handleLeadResponse(parseInt(leadId), response);
        console.log(`[webhooks] Lead response handled: ${result.action}`);
      } catch (err) {
        console.error(`[webhooks] Error handling lead response: ${err.message}`);
      }
    });

  } catch (err) {
    console.error(`[webhooks] Lead response error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = {
  handleLeadWebhook,
  handleStripeWebhook,
  handleOnboardingWebhook,
  handleLeadResponse,
};
