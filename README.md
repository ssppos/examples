# SSP Systems - Plugin Examples

Official example plugins for the SSP POS Plugin Marketplace. These examples demonstrate how to build integrations for payment gateways, delivery platforms, inventory management, and more.

## 📚 Available Examples

### Payment Gateways
- **[Razorpay UPI](./razorpay-upi-gateway/)** (Node.js) - Accept UPI payments in India
- **[Stripe Alternative](./stripe-alternative-gateway/)** (Node.js) - Generic Stripe-style payment gateway

### Delivery Platforms
- **[DoorDash Integration](./doordash-delivery/)** (Python) - Manage DoorDash orders and menu sync
- **[Generic Delivery](./generic-delivery/)** (Node.js) - Template for any delivery platform

### Inventory Management
- **[Inventory Tracker](./inventory-tracker/)** (Python) - Simple inventory management plugin

### Accounting
- **[QuickBooks Integration](./quickbooks-accounting/)** (PHP) - Sync invoices and expenses

### Minimal Templates
- **[Minimal Plugin Template](./minimal-template/)** - Bare-bones plugin in multiple languages

## 🚀 Quick Start

### 1. Choose Your Stack

All examples work with SSP POS Plugin Marketplace. Choose based on your preferred language:

- **Node.js** - Best for payment gateways and real-time integrations
- **Python** - Great for data processing and delivery platforms
- **PHP** - Perfect for accounting and legacy system integrations
- **Go** - High-performance applications

### 2. Clone an Example

```bash
git clone https://github.com/sspsystems/examples.git
cd examples/razorpay-upi-gateway
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Run Locally

```bash
npm start
# or
python app.py
# or
php -S localhost:3000 index.php
```

### 5. Test

```bash
curl http://localhost:3000/health
```

### 6. Deploy

Deploy to your preferred platform:
- **Heroku** - Free tier available
- **Railway** - Easy deployment
- **DigitalOcean App Platform** - Simple and affordable
- **AWS Lambda** - Serverless option
- **Vercel/Netlify** - For Node.js serverless

### 7. Register with SSP

```bash
curl -X POST https://api.sspsystems.com/v1/plugins/submit \
  -H "Authorization: Bearer YOUR_SSP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "razorpay-upi",
    "display_name": "Razorpay UPI Payments",
    "description": "Accept UPI payments via Razorpay in India",
    "plugin_type": "payment",
    "integration_type": "rest_api",
    "api_endpoint": "https://your-app.herokuapp.com",
    "supported_features": ["charge", "refund", "payment_intent"],
    "supported_currencies": ["INR"],
    "supported_events": ["order.created", "order.paid", "payment.succeeded"],
    "developer_name": "Your Name",
    "developer_email": "your@email.com"
  }'
```

## 📖 Documentation

### Plugin Requirements

All plugins must implement these endpoints:

#### Core Endpoints (All Types)
- `GET /health` - Health check
- `GET /capabilities` - Supported features

#### Payment Gateway Specific
- `POST /charge` - Process payment
- `POST /refund` - Refund transaction
- `GET /transactions/:id` - Get transaction details
- `POST /payment-intent` - Create payment intent (async payments)

#### Delivery Platform Specific
- `POST /orders` - Create order
- `PUT /orders/:id` - Update order status
- `POST /menu/sync` - Sync menu items
- `POST /webhooks` - Receive webhooks

#### Inventory Management Specific
- `GET /inventory` - Get current inventory
- `POST /inventory/update` - Update stock levels
- `POST /inventory/usage` - Track item usage
- `GET /inventory/alerts` - Get reorder alerts

#### Accounting Specific
- `POST /invoices/sync` - Sync invoice
- `POST /expenses/sync` - Sync expense
- `GET /accounts` - Get chart of accounts

### Authentication

Your plugin receives authentication via headers:

```javascript
// SSP Backend sends
headers: {
  'X-API-Key': 'your-plugin-api-key',
  'Content-Type': 'application/json'
}
```

Validate this on every request:

```javascript
if (req.headers['x-api-key'] !== process.env.SSP_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Request Format

SSP Backend sends:

```json
{
  "amount": 1000.00,
  "currency": "INR",
  "customer": {
    "email": "customer@example.com",
    "phone": "+919876543210"
  },
  "provider_config": {
    "razorpay_key_id": "rzp_live_xxx",
    "razorpay_key_secret": "xxx"
  },
  "sandbox": false,
  "request_id": "req_abc123"
}
```

### Response Format

Return consistent responses:

```json
{
  "success": true,
  "transaction_id": "txn_abc123",
  "status": "success",
  "amount": 1000.00,
  "currency": "INR",
  "metadata": {}
}
```

### Error Handling

Return errors in consistent format:

```json
{
  "error": true,
  "message": "Payment failed",
  "code": "INSUFFICIENT_FUNDS",
  "details": {
    "available": 50.00,
    "required": 100.00
  }
}
```

### Webhooks

Forward webhooks from your payment provider to SSP:

```javascript
// Receive from Razorpay
app.post('/webhooks/razorpay', async (req, res) => {
  // Verify signature
  const isValid = verifySignature(req);
  if (!isValid) return res.status(401).send();

  // Forward to SSP
  await axios.post('https://api.sspsystems.com/webhooks/external', {
    provider: 'razorpay-upi',
    event: req.body.event,
    payload: req.body.payload
  }, {
    headers: {
      'X-Webhook-Secret': process.env.SSP_WEBHOOK_SECRET
    }
  });

  res.json({ status: 'ok' });
});
```

## 🛡️ Security Best Practices

### 1. API Key Management
- Use environment variables
- Rotate keys periodically
- Never commit to git

### 2. Webhook Verification
- Always verify signatures
- Use timing-safe comparison
- Log suspicious requests

### 3. Input Validation
- Validate all inputs
- Sanitize data
- Check amounts and currencies

### 4. Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
});

app.use(limiter);
```

### 5. Error Handling
- Don't expose sensitive details
- Log errors securely
- Return generic messages to client

### 6. HTTPS Only
- Never use HTTP
- Use valid SSL certificates
- Redirect HTTP to HTTPS

## 🧪 Testing

### Local Testing

```bash
# Start your plugin
npm start

# Test health check
curl http://localhost:3000/health

# Test charge endpoint
curl -X POST http://localhost:3000/charge \
  -H "X-API-Key: test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "INR"
  }'
```

### Integration Testing

Use the SSP test environment:

```bash
# Register in sandbox mode
# Install to test location
# Process test transactions
# Verify webhooks work
```

## 📦 Deployment

### Heroku

```bash
heroku create your-plugin-name
git push heroku main
heroku config:set SSP_API_KEY=your-key
```

### Railway

```bash
railway init
railway up
railway variables set SSP_API_KEY=your-key
```

### DigitalOcean

```bash
doctl apps create --spec app.yaml
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

## 🔍 Monitoring

Monitor your plugin health:

- **Uptime** - Use UptimeRobot or Pingdom
- **Errors** - Sentry or Rollbar
- **Logs** - Papertrail or Loggly
- **Performance** - New Relic or DataDog

## 💰 Monetization

### Pricing Models

1. **Free** - Marketing and lead generation
2. **Freemium** - Basic free, premium paid
3. **Subscription** - $9-$99/month per location
4. **Transaction Fee** - 0.5-2% per transaction
5. **One-time** - One-time setup fee

### Payment Collection

SSP can handle billing for you:
- Monthly subscriptions via Stripe
- Transaction fee tracking
- Automatic invoicing

## 📞 Support

### Developer Resources
- **Documentation**: https://docs.ssppos.com/sdk
- **API Reference**: https://api-docs.ssppos.com
- **Forum**: https://forum.ssppos.com

### Getting Help
- **Email**: developers@sspsystems.com
- **Discord**: https://discord.gg/sspsystems
- **GitHub Issues**: https://github.com/sspsystems/examples/issues

### Commercial Support
- **Consulting**: $150/hour
- **Full Integration**: Starting at $5,000
- **Certification**: $1,000

## 📜 License

All examples are MIT licensed. You can use them as templates for your own plugins.

## 🤝 Contributing

We welcome contributions!

1. Fork the repository
2. Create your feature branch
3. Add your example
4. Submit a pull request

## ⭐ Featured Plugins

Built something awesome? Submit a PR to add your plugin to this list!

- Your plugin here!

---

**Happy Building!** 🚀

Made with ❤️ by SSP Systems
