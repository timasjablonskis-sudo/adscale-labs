/**
 * lib/anthropic.js
 * Claude API wrapper for AdScale Labs.
 *
 * KEY FEATURE — Prompt Key Lookup:
 * Every agent has a named "promptKey" (e.g. 'larry_qualification_1').
 * These prompts are stored in the knowledge_base table under category='prompts'.
 * The Optimizer agent rewrites these prompts weekly based on performance data.
 * So every time an agent calls Claude, it can receive an UPDATED prompt without
 * any code changes — the system improves itself over time.
 *
 * KEY FEATURE — Retry Logic:
 * Claude's API occasionally returns 429 (rate limit) or 529 (overloaded).
 * This wrapper retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * This makes all agent runs resilient to transient API errors.
 */

'use strict';

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { getKB } = require('./database');

// Initialize the Anthropic client once at module load
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Default model — claude-sonnet-4-6 per system spec
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Maximum retry attempts for transient API errors
const MAX_RETRIES = 3;

/**
 * Sleep for a given number of milliseconds.
 * Used for exponential backoff between retries.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Claude with a system prompt and user message.
 *
 * @param {string} systemPrompt - The base system prompt to use (fallback if promptKey not found)
 * @param {string} userMessage - The user turn message
 * @param {object} options
 * @param {string} [options.promptKey] - If provided, looks up an override prompt from the
 *   knowledge_base table (category='prompts', key=promptKey). The Optimizer can update
 *   these keys to improve agent behavior over time without changing code.
 * @param {number} [options.maxTokens=2048] - Maximum tokens in the response
 * @param {string} [options.model] - Override the model (defaults to claude-sonnet-4-6)
 * @returns {Promise<string>} The raw text content of Claude's response
 */
async function callClaude(systemPrompt, userMessage, options = {}) {
  const { promptKey, maxTokens = 2048, model = DEFAULT_MODEL } = options;

  // If a promptKey is provided, try to load the stored prompt from the knowledge base.
  // This is how the Optimizer's rewrites take effect — without any code deployment.
  let resolvedSystemPrompt = systemPrompt;
  if (promptKey) {
    const storedPrompt = getKB('prompts', promptKey);
    if (storedPrompt) {
      resolvedSystemPrompt = storedPrompt;
    }
    // If not found in KB, fall back to the passed systemPrompt (which is the initial default)
  }

  // Retry loop: attempt up to MAX_RETRIES times with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: resolvedSystemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ],
      });

      // Extract the text content from the response
      const textBlock = response.content.find(block => block.type === 'text');
      if (!textBlock) throw new Error('Claude returned no text content');
      return textBlock.text;

    } catch (err) {
      lastError = err;
      const status = err.status || (err.error && err.error.status);

      // Retry on rate limit (429) or server overload (529/500)
      const isRetryable = status === 429 || status === 529 || status === 500;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.warn(`[anthropic] Attempt ${attempt} failed (status ${status}). Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }

      // Non-retryable error or exhausted retries — throw immediately
      break;
    }
  }

  throw new Error(`Claude API call failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

/**
 * Parse a JSON response from Claude.
 * Claude sometimes wraps JSON in markdown code blocks — this strips those.
 * @param {string} text - Raw text response from callClaude
 * @returns {*} Parsed JSON value
 */
function parseJSON(text) {
  // Strip markdown code fences if present: ```json ... ``` or ``` ... ```
  // Use a greedy match to find the first JSON block in the response
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const stripped = fenceMatch ? fenceMatch[1].trim() : text.trim();
  return JSON.parse(stripped);
}

module.exports = { callClaude, parseJSON };
