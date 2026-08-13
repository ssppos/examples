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

## What SSP actually calls on your service

For a marketplace plugin, SSP makes exactly **two** kinds of request to you:

### GET /health — required

Polled periodically with a **5-second timeout**. A response slower than
3 seconds is recorded as `degraded` and shown on your marketplace listing, so
keep it free of database and upstream calls.

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### POST {your webhook route} — required if you subscribe to events

Signed event delivery. Verify `X-SSP-Signature` over the **raw** request body,
answer 2xx within **10 seconds**, and process asynchronously. SSP retries 3
times (60s / 300s / 900s backoff) on any non-2xx.

Optionally, a **setup page** if your plugin needs its own configuration UI —
see [Setup Handoff](https://docs.ssppos.com/docs/sdk/setup-handoff).

**That is the entire inbound surface.** Everything else is *your plugin calling
SSP*, authenticated with the installation's `pik_` key against
`https://api.ssppos.com/api/plugin/v1`.

## Your own API is your own design

Apart from `/health` and a webhook receiver, SSP never calls your service, so
you can shape the rest however your product needs.

Where a plugin type has real work to do, it does it by calling SSP:

| Plugin type | What it calls |
|-------------|---------------|
| **Payment** | `POST /orders/{id}/payments` to record a capture authoritatively (needs `payments:capture`) |
| **Delivery** | `POST /orders` to originate an order (needs `orders:create`), `PUT /orders/{id}` to advance it, `PATCH /menu/{id}` and `POST /menu/bulk-availability` to sync availability |
| **Inventory** | `GET /inventory`, `POST /inventory/{id}/movements` to write the stock ledger |

> One exception: the **external gateway provider** registration is a separate
> contract in which SSP *does* call your `POST /charge`, `POST /refund`,
> `GET /transactions/{id}` and `POST /payment-intent`. That is not created by
> publishing a marketplace plugin — see
> [Payment Gateways](https://docs.ssppos.com/docs/sdk/payment-gateways).

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
- Email: developers@ssppos.com
