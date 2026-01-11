# SSP Webhook Handler Example

Handle webhooks from SSP for order, payment, and menu events.

## Overview

This example demonstrates how to:
- Receive webhooks from SSP
- Verify HMAC SHA-256 signatures
- Route events to appropriate handlers
- Process order, payment, and menu events
- Handle plugin lifecycle events

## Supported Events

### Order Events
- `order.created` - New order created
- `order.status_changed` - Order status updated
- `order.items_added` - Items added to order
- `order.paid` - Order payment completed
- `order.cancelled` - Order cancelled

### Payment Events
- `payment.succeeded` - Payment processed successfully
- `payment.failed` - Payment failed
- `payment.refunded` - Payment refunded

### Menu Events
- `menu.item_created` - Menu item created
- `menu.item_updated` - Menu item updated
- `menu.item_deleted` - Menu item deleted

### Plugin Lifecycle Events
- `plugin.installed` - Plugin installed by organization
- `plugin.uninstalled` - Plugin uninstalled
- `plugin.configuration_updated` - Configuration changed

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your webhook secret
```

### 3. Run the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 4. Test Webhook

```bash
curl -X POST http://localhost:3000/webhooks/ssp \
  -H "Content-Type: application/json" \
  -H "X-SSP-Signature: test_signature" \
  -H "X-SSP-Event: order.created" \
  -d '{
    "event": "order.created",
    "timestamp": "2025-01-10T18:30:00Z",
    "installation_id": "install_123",
    "data": {
      "order_id": 123,
      "unique_orderid": "ORD-2025-001",
      "order_status": "open",
      "total_amount": "57.60",
      "location_id": 1
    }
  }'
```

## Signature Verification

SSP signs all webhooks with HMAC SHA-256. The signature is sent in the `X-SSP-Signature` header.

```javascript
function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Important:** Always verify signatures before processing webhooks to prevent spoofing.

## Webhook Payload Format

```json
{
  "event": "order.created",
  "timestamp": "2025-01-10T18:30:00Z",
  "installation_id": "install_123",
  "data": {
    // Event-specific data
  }
}
```

## Headers

| Header | Description |
|--------|-------------|
| `X-SSP-Signature` | HMAC SHA-256 signature |
| `X-SSP-Event` | Event type |
| `Content-Type` | Always `application/json` |

## Best Practices

### 1. Respond Quickly

SSP expects a response within 5 seconds. Process webhooks asynchronously:

```javascript
app.post('/webhooks/ssp', (req, res) => {
  // Respond immediately
  res.json({ status: 'ok' });

  // Process asynchronously
  setImmediate(() => processWebhook(req.body));
});
```

### 2. Handle Duplicates

Webhooks may be retried. Use idempotency keys:

```javascript
const processedEvents = new Set();

function handleEvent(event) {
  if (processedEvents.has(event.id)) {
    return; // Already processed
  }
  // Process event
  processedEvents.add(event.id);
}
```

### 3. Log Everything

```javascript
function handleWebhook(event) {
  console.log({
    timestamp: new Date().toISOString(),
    event: event.event,
    installationId: event.installation_id,
    data: event.data
  });
}
```

## Subscribing to Events

When registering your plugin, specify which events you want to receive:

```json
{
  "name": "my-plugin",
  "supported_events": ["order.created", "order.paid", "payment.*"]
}
```

Use wildcards to receive all events in a category:
- `order.*` - All order events
- `payment.*` - All payment events
- `menu.*` - All menu events

## Testing with ngrok

For local development, expose your server with ngrok:

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm start

# In another terminal, expose port 3000
ngrok http 3000

# Use the ngrok URL as your webhook endpoint
# https://abc123.ngrok.io/webhooks/ssp
```

## Deployment

### Heroku

```bash
heroku create my-webhook-handler
git push heroku main
heroku config:set WEBHOOK_SECRET=your-secret
```

### Railway

```bash
railway init
railway up
railway variables set WEBHOOK_SECRET=your-secret
```

## Learn More

- [SSP Webhooks Documentation](https://developer.ssppos.com/sdk/webhooks)
- [Plugin Data API](https://developer.ssppos.com/sdk/plugin-data-api)
- [Security Best Practices](https://developer.ssppos.com/sdk/security)
