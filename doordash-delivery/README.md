# DoorDash Delivery Integration

Connect restaurants with DoorDash delivery service through SSP POS.

## Features

- ✅ Create delivery orders
- ✅ Real-time status updates
- ✅ Driver tracking
- ✅ Order cancellation
- ✅ Webhook handling
- ✅ Estimated delivery times

## Prerequisites

- Python 3.8+
- DoorDash Drive API access
- SSP POS account

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# SSP Configuration
SSP_PLUGIN_API_KEY=pik_your-plugin-api-key-here
SSP_WEBHOOK_SECRET=your-webhook-secret

# DoorDash Configuration
DOORDASH_API_URL=https://openapi.doordash.com
DOORDASH_WEBHOOK_SECRET=your-doordash-webhook-secret
```

### 3. Run Locally

```bash
python app.py
```

Server starts at `http://localhost:3000`

### 4. Test

```bash
# Health check
curl http://localhost:3000/health

# Create delivery order
curl -X POST http://localhost:3000/orders \
  -H "X-SSP-Signature: <hmac-hex>" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "order_123",
    "items": [
      {
        "name": "Burger",
        "quantity": 2,
        "price": 10.00
      }
    ],
    "customer": {
      "name": "John Doe",
      "phone": "+1234567890"
    },
    "delivery_address": {
      "street": "123 Main St",
      "city": "Toronto",
      "postal_code": "M5V 1A1"
    },
    "restaurant_name": "Pizza Palace",
    "restaurant_phone": "+1234567890",
    "pickup_address": "456 Restaurant Ave",
    "total_amount": 20.00,
    "provider_config": {
      "developer_id": "your-developer-id",
      "key_id": "your-key-id",
      "signing_secret": "your-signing-secret"
    }
  }'
```

## API Endpoints

### POST /orders
Create new delivery order.

**Response:**
```json
{
  "success": true,
  "external_order_id": "doordash_order_123",
  "status": "accepted",
  "estimated_pickup_time": "2025-11-02T11:00:00Z",
  "estimated_delivery_time": "2025-11-02T11:30:00Z",
  "tracking_url": "https://doordash.com/track/123"
}
```

### PUT /orders/:id
Update order status.

**Request:**
```json
{
  "status": "ready_for_pickup",
  "provider_config": { ... }
}
```

### GET /orders/:id
Get order details and tracking.

### POST /orders/:id/cancel
Cancel delivery order.

## Webhooks

Configure DoorDash to send webhooks to:
```
https://your-app.com/webhooks/doordash
```

**Events handled:**
- `delivery.status.update`
- `delivery.driver.assigned`
- `delivery.cancelled`

## Deployment

### Heroku

```bash
heroku create doordash-ssp-plugin
echo "web: gunicorn app:app" > Procfile
git push heroku main
heroku config:set SSP_PLUGIN_API_KEY=pik_your-key SSP_WEBHOOK_SECRET=your-secret
```

### Railway

```bash
railway init
railway up
railway variables set SSP_PLUGIN_API_KEY=pik_your-key SSP_WEBHOOK_SECRET=your-secret
```

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 3000
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:3000"]
```

## DoorDash Setup

1. Sign up for [DoorDash Drive](https://www.doordash.com/drive/)
2. Get API credentials
3. Configure webhook URL
4. Test in sandbox environment

## Register with SSP

```bash
curl -X POST https://api.ssppos.com/v1/plugins/submit \
  -H "X-Plugin-Api-Key: pik_YOUR_KEY" \
  -d '{
    "name": "doordash-delivery",
    "display_name": "DoorDash Delivery",
    "description": "Integrate with DoorDash for delivery orders",
    "plugin_type": "delivery",
    "integration_type": "rest_api",
    "api_endpoint": "https://your-app.herokuapp.com",
    "webhook_endpoint": "https://your-app.herokuapp.com/webhooks/ssp",
    "supported_features": ["order_creation", "status_updates", "tracking"],
    "supported_regions": ["US", "CA"],
    "developer_name": "Your Name",
    "developer_email": "your@email.com"
  }'
```

## Testing

### Mock Webhooks

```bash
curl -X POST http://localhost:3000/webhooks/doordash \
  -H "Content-Type: application/json" \
  -H "X-DoorDash-Signature: test_signature" \
  -d '{
    "event_type": "delivery.status.update",
    "event_id": "evt_123",
    "data": {
      "external_delivery_id": "order_123",
      "delivery_status": "picked_up"
    }
  }'
```

## Support

- **DoorDash Docs**: [developer.doordash.com](https://developer.doordash.com)
- **SSP Docs**: [docs.ssppos.com](https://docs.ssppos.com)
- **Issues**: Open an issue on GitHub

## License

MIT
