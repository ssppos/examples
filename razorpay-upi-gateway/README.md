# Razorpay UPI Payment Gateway Plugin

Accept UPI payments in India using Razorpay through SSP POS.

## Features

- ✅ UPI payments
- ✅ Credit/Debit cards
- ✅ Netbanking
- ✅ Wallets (Paytm, PhonePe, etc.)
- ✅ Refunds
- ✅ Payment intents for async payments
- ✅ Webhook handling
- ✅ Sandbox and production modes

## Prerequisites

- Node.js 18+
- Razorpay account ([Sign up](https://razorpay.com))
- SSP POS account

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# SSP Configuration
SSP_PLUGIN_API_KEY=pik_your-plugin-api-key-here
SSP_WEBHOOK_SECRET=your-webhook-secret-here
SSP_CALLBACK_URL=https://api.ssppos.com/api/plugin/v1/webhooks/external

# Razorpay Configuration (for testing)
DEFAULT_RAZORPAY_KEY_ID=rzp_test_xxx
DEFAULT_RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=your-razorpay-webhook-secret

# Server
PORT=3000
NODE_ENV=development
```

### 3. Run Locally

```bash
npm start
```

Server starts at `http://localhost:3000`

### 4. Test

```bash
# Health check
curl http://localhost:3000/health

# Capabilities
curl http://localhost:3000/capabilities

# Test charge (sandbox)
curl -X POST http://localhost:3000/charge \
  -H "X-SSP-Signature: <hmac-hex>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "INR",
    "customer": {
      "email": "test@example.com",
      "phone": "+919876543210"
    },
    "provider_config": {
      "razorpay_key_id": "rzp_test_xxx",
      "razorpay_key_secret": "xxx"
    }
  }'
```

## Deployment

### Heroku

```bash
heroku create razorpay-ssp-bridge
git push heroku main
heroku config:set SSP_PLUGIN_API_KEY=pik_your-key
heroku config:set SSP_WEBHOOK_SECRET=your-secret
```

### Railway

```bash
railway init
railway up
```

### DigitalOcean

```bash
doctl apps create --spec .do/app.yaml
```

## Register with SSP

After deployment:

```bash
> **Registration happens in the Developer Portal.** Create a project, provision
> a sandbox, then promote it with **Create Plugin** at
> <https://developer.ssppos.com>. The REST call below exists for CI and needs a
> staff session; it is not the normal path.

curl -X POST https://api.ssppos.com/api/v1/plugins/submit \
  -H "X-Plugin-Api-Key: pik_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "razorpay-upi",
    "display_name": "Razorpay UPI Payments",
    "description": "Accept UPI, cards, and wallets via Razorpay in India",
    "plugin_type": "payment",
    "integration_type": "rest_api",
    "api_endpoint": "https://your-app.herokuapp.com",
    "webhook_endpoint": "https://your-app.herokuapp.com/webhooks/ssp",
    "supported_features": ["payments:capture"],
    "supported_regions": ["IN"],
    "supported_currencies": ["INR"],
    "auth_type": "api_key",
    "api_key": "generate-random-secure-key",
    "developer_name": "Your Name",
    "developer_email": "your@email.com",
    "documentation_url": "https://github.com/yourusername/razorpay-ssp-plugin"
  }'
```

## API Endpoints

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2025-11-02T10:30:00Z"
}
```

### GET /capabilities
Returns supported features.

**Response:**
```json
{
  "supported_methods": ["upi", "cards", "netbanking", "wallets"],
  "supported_currencies": ["INR"],
  "features": ["charge", "refund", "payment_intent", "webhooks"]
}
```

### POST /charge
Process immediate payment.

**Request:**
```json
{
  "amount": 1000.00,
  "currency": "INR",
  "description": "Order #12345",
  "customer": {
    "email": "customer@example.com",
    "phone": "+919876543210",
    "name": "John Doe"
  },
  "payment_method": "upi",
  "provider_config": {
    "razorpay_key_id": "rzp_live_xxx",
    "razorpay_key_secret": "xxx"
  },
  "sandbox": false
}
```

**Response:**
```json
{
  "success": true,
  "transaction_id": "order_abc123",
  "status": "created",
  "amount": 1000.00,
  "currency": "INR"
}
```

### POST /refund
Refund a transaction.

**Request:**
```json
{
  "transaction_id": "pay_abc123",
  "amount": 500.00,
  "reason": "Customer request",
  "provider_config": {
    "razorpay_key_id": "rzp_live_xxx",
    "razorpay_key_secret": "xxx"
  }
}
```

**Response:**
```json
{
  "success": true,
  "refund_id": "rfnd_xyz123",
  "status": "processed",
  "amount": 500.00
}
```

### GET /transactions/:id
Get transaction details.

**Response:**
```json
{
  "success": true,
  "transaction_id": "pay_abc123",
  "status": "captured",
  "amount": 1000.00,
  "currency": "INR",
  "method": "upi",
  "created_at": "2025-11-02T10:30:00Z"
}
```

### POST /payment-intent
Create payment intent for async payments.

**Request:**
```json
{
  "amount": 1000.00,
  "currency": "INR",
  "customer": {
    "email": "customer@example.com"
  },
  "callback_url": "https://api.ssppos.com/api/v1/payment/callback/razorpay-upi",
  "provider_config": {
    "razorpay_key_id": "rzp_live_xxx",
    "razorpay_key_secret": "xxx"
  }
}
```

**Response:**
```json
{
  "success": true,
  "intent_id": "order_abc123",
  "redirect_url": "https://razorpay.com/pay/order_abc123",
  "qr_code_url": null,
  "expires_at": "2025-11-02T11:00:00Z"
}
```

## Webhooks

### Razorpay → Your Plugin

Configure in Razorpay Dashboard:
- URL: `https://your-app.com/webhooks/razorpay`
- Events: `payment.captured`, `payment.failed`, `refund.created`

### Your Plugin → SSP Backend

Automatically forwards events to SSP at the configured callback URL.

## Testing with Razorpay

### Test Cards

```
Card: 4111 1111 1111 1111
CVV: 123
Expiry: Any future date
```

### Test UPI

```
UPI ID: success@razorpay
```

### Test Scenarios

- **Success**: Use `success@razorpay`
- **Failure**: Use `failure@razorpay`

## Monitoring

Monitor your plugin:

```bash
# View logs
heroku logs --tail

# Check health
curl https://your-app.herokuapp.com/health
```

## Troubleshooting

### Connection Errors
- Verify Razorpay credentials
- Check API key is correct
- Ensure webhook secret matches

### Payment Failures
- Check Razorpay Dashboard for details
- Verify amount is in paise (multiply by 100)
- Ensure customer details are valid

### Webhook Issues
- Verify webhook signature
- Check SSP callback URL is correct
- Ensure webhook secret is set

## Support

- **Razorpay Docs**: https://razorpay.com/docs
- **SSP Docs**: https://docs.ssppos.com
- **Issues**: Open an issue on GitHub

## License

MIT

## Author

Your Name - your@email.com
