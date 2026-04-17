# Minimal SSP Plugin Template

A bare-bones template for creating SSP POS plugins. Choose your language and get started in minutes.

## Available Templates

- **[Node.js](./nodejs/)** - Express-based minimal template
- **[Python](./python/)** - Flask-based minimal template
- **[PHP](./php/)** - Slim-based minimal template
- **[Go](./go/)** - Gin-based minimal template

## Quick Start

1. Copy your preferred template
2. Install dependencies
3. Configure `.env`
4. Implement your business logic
5. Deploy and register with SSP

## Required Endpoints

All plugins must implement:

### GET /health
Health check endpoint.

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### GET /capabilities
Returns what your plugin supports.

```json
{
  "supported_methods": ["your", "methods"],
  "supported_currencies": ["USD", "INR"],
  "features": ["charge", "refund"]
}
```

### Plugin-Specific Endpoints

Implement based on your plugin type:

**Payment Gateway:**
- `POST /charge`
- `POST /refund`
- `GET /transactions/:id`
- `POST /payment-intent`

**Delivery Platform:**
- `POST /orders`
- `PUT /orders/:id`
- `POST /menu/sync`

**Inventory:**
- `GET /inventory`
- `POST /inventory/update`

**Accounting:**
- `POST /invoices/sync`
- `POST /expenses/sync`

## Authentication

SSP signs all outbound requests with HMAC SHA-256. Your plugin receives:

```
X-SSP-Signature: <hmac-sha256-hex>
```

Always verify this signature using your `SSP_WEBHOOK_SECRET`!

## Response Format

Return consistent JSON responses:

**Success:**
```json
{
  "success": true,
  "data": {}
}
```

**Error:**
```json
{
  "error": true,
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

## Next Steps

1. Choose a template
2. Read the template-specific README
3. Implement your logic
4. Test locally
5. Deploy
6. Register with SSP

## Support

- Documentation: https://docs.ssppos.com/sdk
- Email: developers@sspsystems.com
