# SSP Webhook Handler Example

Receive and process webhooks from SSP.

## Overview

This example demonstrates:

- Raw-body HMAC SHA-256 signature verification
- The complete SSP event catalog with correct payload fields
- The verify → acknowledge → process-asynchronously pattern
- Handling installation, trial, and subscription lifecycle events

## The event catalog

SSP emits 20 events. Subscribe via `supported_events` on your plugin listing.

### Order events
- `order.created` — a new order became real
- `order.status_changed` — status transition
- `order.items_added` — items added to an existing order
- `order.paid` — order fully paid
- `order.cancelled` — order cancelled

### Payment events
- `payment.succeeded` · `payment.failed` · `payment.refunded`

### Menu events
- `menu.item_created` · `menu.item_updated` · `menu.item_deleted`

### Inventory events
- `inventory.stock_updated` — every movement
- `inventory.low_stock` — crossed down to/below the reorder point
- `inventory.low_stock_resolved` — crossed back up

### Installation lifecycle
- `installation.created` — installed and activated; **provision your tenant here**
- `installation.removed` — uninstalled; fired while still active so you can deprovision

### Subscription and trial lifecycle (paid plugins)
- `trial.started` · `trial.ending` · `subscription.activated`

### Sandbox lifecycle
- `sandbox.expiry_warning` — 7 days before idle expiry drops your sandbox schema

> **Lifecycle events need explicit opt-in.** If you set an explicit
> `supported_events` list, the `installation.*`, `subscription.*` and `trial.*`
> families are **not** included by default.

## Quick start

```bash
npm install
cp .env.example .env       # set SSP_WEBHOOK_SECRET
npm start
```

## Signature verification

SSP signs the **raw request body** with your `webhook_secret` and sends the hex
digest in `X-SSP-Signature`.

```javascript
function verifySignature(rawBody, received, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(received || '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws when lengths differ — check length first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// express.raw() on this route specifically, so req.body is a Buffer.
app.post('/webhooks/ssp', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifySignature(req.body, req.headers['x-ssp-signature'], SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const envelope = JSON.parse(req.body.toString('utf8'));
  res.json({ status: 'ok' });
});
```

> **Never hash `JSON.stringify(req.body)`.** The signature covers the exact
> bytes SSP transmitted. Re-serializing in JavaScript produces different bytes
> than the sender emitted — forward slashes and non-ASCII characters are
> escaped differently — so any payload containing a URL or an accented
> character will fail to verify. Mount `express.raw()` on the webhook route and
> hash `req.body` directly.

> **Compare in constant time.** Use `crypto.timingSafeEqual`, never `===`.

## The envelope

```json
{
  "event": "order.created",
  "timestamp": "2026-05-30T12:00:00+00:00",
  "installation_id": 123,
  "data": { }
}
```

`installation_id` is your **tenant key** — look up the matching `pik_` key and
act in that installation's context.

## Headers

| Header | Description |
|--------|-------------|
| `X-SSP-Signature` | Hex HMAC-SHA256 of the raw body |
| `X-SSP-Event` | Event type |
| `Content-Type` | Always `application/json` |

## Delivery guarantees

| Property | Value |
|----------|-------|
| Transport | HTTPS only — private, loopback and reserved addresses are refused |
| Redirects | Not followed |
| Request timeout | **10 seconds** |
| Attempts | 3 |
| Backoff | 60s, 300s, 900s |
| Success | Any 2xx |

## Best practices

### Acknowledge first, process after

```javascript
app.post('/webhooks/ssp', express.raw({ type: 'application/json' }), (req, res) => {
  // verify signature...
  res.json({ status: 'ok' });                  // acknowledge within 10s
  setImmediate(() => process(envelope));       // then do the work
});
```

### Be idempotent

Three attempts mean duplicates are normal. Deduplicate on a natural key and
**persist the marker in your database** — a restart must not replay:

```javascript
const key = `${event}:${installationId}:${data.order_id ?? data.transaction_id}`;
if (!await db.processedEvents.insertIfAbsent({ key })) return;
```

### Return 2xx even for events you ignore

A non-2xx triggers retries that can never succeed.

### Tolerate new fields

Payloads gain fields over time. Read what you need; never fail on an
unrecognised key.

## Two vocabularies, one system

Webhook payloads carry SSP's **internal** order statuses (`CREATED`, `COOKING`,
`PREPARED`, `SERVED`, `COMPLETED`, `PAID`, `CANCELLED`).

REST response bodies return the coarser **plugin** vocabulary (`open`,
`in_progress`, `ready`, `completed`, `paid`, `cancelled`), and the `?status=`
filter on `GET /orders` matches the internal column. Normalise on your side.

## Testing

### From the Developer Portal

The portal's webhook tester fires a real, signed webhook built from your sandbox
data and returns a log ID you can poll for the delivery outcome.

### Locally with ngrok

SSP only delivers to public HTTPS addresses:

```bash
npm start
ngrok http 3000
# Use https://<id>.ngrok.io/webhooks/ssp as your webhook_endpoint
```

### Sending a correctly signed test request

```bash
BODY='{"event":"order.created","timestamp":"2026-05-30T12:00:00+00:00","installation_id":123,"data":{"order_id":456,"unique_orderid":"ORD-2026-001","order_status":"CREATED","total":"57.60"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SSP_WEBHOOK_SECRET" | sed 's/^.* //')

curl -X POST http://localhost:3000/webhooks/ssp \
  -H "Content-Type: application/json" \
  -H "X-SSP-Event: order.created" \
  -H "X-SSP-Signature: $SIG" \
  -d "$BODY"
```

## Deployment

Your `webhook_endpoint` must be a public **https** URL.

```bash
# Heroku
heroku create my-webhook-handler
heroku config:set SSP_WEBHOOK_SECRET=your-secret
git push heroku main

# Railway
railway init && railway up
railway variables set SSP_WEBHOOK_SECRET=your-secret
```

## Learn more

- [Webhooks](https://docs.ssppos.com/docs/sdk/webhooks)
- [Plugin Data API](https://docs.ssppos.com/docs/sdk/plugin-data-api)
- [Security](https://docs.ssppos.com/docs/sdk/security)
