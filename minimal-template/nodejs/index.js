const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;

/**
 * Verify an SSP webhook signature.
 *
 * The HMAC covers the EXACT BYTES SSP transmitted, so the route must use
 * express.raw() and hash the Buffer. Hashing JSON.stringify(req.body) produces
 * different bytes than the sender emitted (forward slashes and non-ASCII are
 * escaped differently), so any payload containing a URL or an accented
 * character would fail to verify.
 */
function verifySignature(rawBody, received, secret) {
  if (!received || !secret) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws when lengths differ, so compare lengths first.
  // Never use === here: it leaks how much of the signature was correct.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Health check — the ONE endpoint SSP requires you to expose.
 *
 * SSP polls GET {api_endpoint}/health with a 5-second timeout. A response
 * slower than 3 seconds is recorded as "degraded" and surfaces on your
 * marketplace listing, so keep this free of database and upstream calls.
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * SSP webhook receiver.
 *
 * express.raw() is mounted on this route specifically so req.body is a Buffer.
 * Subscribe to events via `supported_events` on your plugin listing.
 */
app.post('/webhooks/ssp', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifySignature(req.body, req.headers['x-ssp-signature'], process.env.SSP_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: true, message: 'Invalid signature' });
  }

  const { event, installation_id: installationId, data } = JSON.parse(req.body.toString('utf8'));

  // Acknowledge within 10 seconds. SSP retries 3 times (60s / 300s / 900s) on
  // any non-2xx, so do the real work off the request path.
  res.json({ status: 'ok' });

  setImmediate(async () => {
    try {
      // TODO: your logic here. `installation_id` is your tenant key —
      // look up that installation's pik_ key and act in its context.
      console.log(`[${installationId}] ${event}`, data);
    } catch (err) {
      console.error(`Failed to process ${event}:`, err);
    }
  });
});

/**
 * Calling SSP back.
 *
 * Everything beyond /health and your webhook route is YOUR plugin calling SSP,
 * not the other way around. Authenticate with the installation's pik_ key.
 *
 *   const res = await fetch('https://api.ssppos.com/api/plugin/v1/orders', {
 *     headers: { 'X-Plugin-Api-Key': installationApiKey },
 *   });
 *
 * See https://docs.ssppos.com/docs/sdk/plugin-data-api
 */

// JSON parsing for your own routes — mounted AFTER the webhook route so it
// cannot consume the raw body the signature check depends on.
app.use(express.json());

// Example of your own endpoint. SSP never calls this; design it as you like.
app.post('/your-endpoint', async (req, res) => {
  try {
    // TODO: implement your logic
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: true, message: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: true, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`SSP plugin running on port ${PORT}`);
  console.log(`  Health:  GET  http://localhost:${PORT}/health`);
  console.log(`  Webhook: POST http://localhost:${PORT}/webhooks/ssp`);

  if (!process.env.SSP_WEBHOOK_SECRET) {
    console.warn('  WARNING: SSP_WEBHOOK_SECRET is unset — every webhook will be rejected.');
  }
});

module.exports = app;
