const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// The Plugin Data API base. Sandbox and production share this URL - your pik_
// key decides which data plane you reach.
const SSP_API_BASE = process.env.SSP_API_BASE || 'https://api.ssppos.com/api/plugin/v1';

/**
 * Verify an SSP webhook signature.
 *
 * The HMAC covers the EXACT BYTES SSP transmitted, so the route must use
 * express.raw() and hash the Buffer. Hashing JSON.stringify(req.body) produces
 * different bytes than the sender emitted, so any payload containing a URL or
 * a non-ASCII character would fail to verify.
 */
const verifySspSignature = (rawBody, received, secret) => {
  if (!received || !secret) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on a length mismatch; never use !== here.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const authenticate = (req, res, next) => {
  if (!verifySspSignature(req.body, req.headers['x-ssp-signature'], process.env.SSP_WEBHOOK_SECRET)) {
    return res.status(401).json({
      error: true,
      message: 'Unauthorized - Invalid signature'
    });
  }
  next();
};

// Create Razorpay instance from config
const getRazorpayInstance = (config) => {
  return new Razorpay({
    key_id: config.razorpay_key_id || process.env.DEFAULT_RAZORPAY_KEY_ID,
    key_secret: config.razorpay_key_secret || process.env.DEFAULT_RAZORPAY_KEY_SECRET,
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Capabilities endpoint.
// NOTE: SSP does not call this on a marketplace plugin - it polls /health and
// POSTs to your webhook_endpoint, nothing else. Kept here because it is part
// of the separate external-gateway-provider contract, and it is useful
// self-description either way.
app.get('/capabilities', (req, res) => {
  res.json({
    supported_methods: ['upi', 'cards', 'netbanking', 'wallets'],
    supported_currencies: ['INR'],
    features: ['charge', 'refund', 'payment_intent', 'webhooks'],
  });
});

// ---------------------------------------------------------------------------
// The /charge, /refund, /transactions and /payment-intent routes below are the
// EXTERNAL GATEWAY PROVIDER contract - a separate registration in which SSP
// calls your service to move money. A marketplace plugin does not need them:
// there you own the payment flow and record the result with
// POST /orders/{id}/payments (see the Razorpay webhook handler at the bottom).
//
// See https://docs.ssppos.com/docs/sdk/payment-gateways
// ---------------------------------------------------------------------------

// Charge endpoint
app.post('/charge', authenticate, async (req, res) => {
  try {
    const { amount, currency, customer, provider_config, description } = req.body;

    // Validation
    if (!amount || !currency || !provider_config) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: amount, currency, provider_config',
      });
    }

    const razorpay = getRazorpayInstance(provider_config);

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        customer_email: customer?.email,
        customer_phone: customer?.phone,
        description: description,
      },
    });

    res.json({
      success: true,
      transaction_id: order.id,
      status: order.status,
      amount: amount,
      currency: currency,
      provider_transaction_id: order.id,
      metadata: {
        receipt: order.receipt,
        created_at: new Date(order.created_at * 1000).toISOString(),
      },
    });

  } catch (error) {
    console.error('Charge error:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to process charge',
      code: error.error?.code,
    });
  }
});

// Refund endpoint
app.post('/refund', authenticate, async (req, res) => {
  try {
    const { transaction_id, amount, provider_config, reason } = req.body;

    if (!transaction_id || !amount || !provider_config) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: transaction_id, amount, provider_config',
      });
    }

    const razorpay = getRazorpayInstance(provider_config);

    // Create refund
    const refund = await razorpay.payments.refund(transaction_id, {
      amount: Math.round(amount * 100), // Convert to paise
      notes: {
        reason: reason || 'Refund requested',
      },
    });

    res.json({
      success: true,
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount / 100,
      original_transaction_id: transaction_id,
      metadata: {
        created_at: new Date(refund.created_at * 1000).toISOString(),
      },
    });

  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to process refund',
      code: error.error?.code,
    });
  }
});

// Get transaction details
app.get('/transactions/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const provider_config = JSON.parse(req.query.provider_config || '{}');

    const razorpay = getRazorpayInstance(provider_config);

    // Fetch payment details
    const payment = await razorpay.payments.fetch(id);

    res.json({
      success: true,
      transaction_id: payment.id,
      status: payment.status,
      amount: payment.amount / 100,
      currency: payment.currency,
      method: payment.method,
      created_at: new Date(payment.created_at * 1000).toISOString(),
      metadata: {
        email: payment.email,
        contact: payment.contact,
        order_id: payment.order_id,
      },
    });

  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to fetch transaction',
    });
  }
});

// Create payment intent
app.post('/payment-intent', authenticate, async (req, res) => {
  try {
    const { amount, currency, customer, callback_url, provider_config } = req.body;

    if (!amount || !currency || !provider_config) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: amount, currency, provider_config',
      });
    }

    const razorpay = getRazorpayInstance(provider_config);

    // Create order for payment intent
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency,
      receipt: `intent_${Date.now()}`,
      notes: {
        callback_url: callback_url,
        customer_email: customer?.email,
      },
    });

    // Generate payment link
    const paymentLink = `https://api.razorpay.com/v1/checkout/${order.id}`;

    res.json({
      success: true,
      intent_id: order.id,
      redirect_url: paymentLink,
      qr_code_url: null, // Razorpay generates this dynamically
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        order_id: order.id,
      },
    });

  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Failed to create payment intent',
    });
  }
});

/**
 * Razorpay webhook receiver.
 *
 * express.raw() so both signature checks (Razorpay's and ours) hash the exact
 * bytes that arrived.
 */
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // 1. Verify Razorpay's own signature over the raw bytes.
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    const received = Buffer.from(req.headers['x-razorpay-signature'] || '', 'utf8');
    const computed = Buffer.from(expected, 'utf8');

    if (received.length !== computed.length || !crypto.timingSafeEqual(received, computed)) {
      console.error('Invalid Razorpay webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString('utf8'));
    console.log('Received Razorpay webhook:', event.event);

    // 2. Acknowledge Razorpay immediately, then do the SSP work off the
    //    request path.
    res.json({ status: 'ok' });

    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (!payment) {
      return;
    }

    // 3. THE IMPORTANT PART: record the capture authoritatively.
    //
    //    POST /orders/{id}/payments writes a sale transaction that appears in
    //    the merchant's financial reports, tax filing and settlement
    //    reconciliation. Forwarding an event (step 4) does NOT move money.
    //
    //    Requires the `payments:capture` capability on your plugin listing.
    //    provider_transaction_id is the idempotency key: replaying returns 200
    //    with the original transaction, which is exactly what you want when
    //    Razorpay retries.
    const sspOrderId = payment.notes && payment.notes.ssp_order_id;

    if (event.event === 'payment.captured' && sspOrderId) {
      try {
        await axios.post(
          SSP_API_BASE + '/orders/' + sspOrderId + '/payments',
          {
            amount: payment.amount / 100, // Razorpay sends paise; SSP takes major units
            currency: payment.currency,
            payment_method: payment.method === 'upi' ? 'upi' : 'other',
            provider: 'razorpay',
            provider_transaction_id: payment.id,
            captured_at: new Date(payment.created_at * 1000).toISOString(),
            payer_reference: payment.vpa || payment.email || null,
          },
          { headers: { 'X-Plugin-Api-Key': process.env.SSP_PLUGIN_API_KEY } }
        );
        console.log('Recorded capture ' + payment.id + ' against SSP order ' + sspOrderId);
      } catch (err) {
        // 422 currency_mismatch / overpayment, or 403 feature_not_enabled.
        console.error('Failed to record capture in SSP:', (err.response && err.response.data) || err.message);
      }
    }

    // 4. Optionally also forward the raw provider event for audit.
    //
    //    The body shape is fixed: `event_type` (required), `payload`
    //    (required), `idempotency_key` (optional, deduplicates for 24h).
    //    `event_type` must be a catalog event, an `external.*` name, or match
    //    a wildcard family.
    if (process.env.SSP_WEBHOOK_URL) {
      const forwardBody = JSON.stringify({
        event_type: 'external.razorpay_' + event.event.split('.').join('_'),
        payload: {
          provider: 'razorpay-upi',
          razorpay_event: event.event,
          entity: payment,
        },
        idempotency_key: payment.id,
      });

      const forwardSignature = crypto
        .createHmac('sha256', process.env.SSP_WEBHOOK_SECRET)
        .update(forwardBody)
        .digest('hex');

      try {
        // Send the exact STRING that was hashed. Passing an object here would
        // let axios re-serialize it, producing bytes the signature no longer
        // matches.
        await axios.post(process.env.SSP_WEBHOOK_URL, forwardBody, {
          headers: {
            'X-Plugin-Api-Key': process.env.SSP_PLUGIN_API_KEY,
            'X-SSP-Signature': forwardSignature,
            'Content-Type': 'application/json',
          },
        });
      } catch (err) {
        console.error('Failed to forward event to SSP:', (err.response && err.response.data) || err.message);
      }
    }

  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: true,
    message: 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Razorpay SSP Plugin running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Capabilities: http://localhost:${PORT}/capabilities`);
});

module.exports = app;
