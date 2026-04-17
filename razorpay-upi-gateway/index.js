const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Authentication middleware — verifies SSP outbound webhook signature
const authenticate = (req, res, next) => {
  const signature = req.headers['x-ssp-signature'];

  if (!signature || !process.env.SSP_WEBHOOK_SECRET) {
    return res.status(401).json({
      error: true,
      message: 'Unauthorized - Missing signature'
    });
  }

  const expected = crypto
    .createHmac('sha256', process.env.SSP_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expected) {
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

// Capabilities endpoint
app.get('/capabilities', (req, res) => {
  res.json({
    supported_methods: ['upi', 'cards', 'netbanking', 'wallets'],
    supported_currencies: ['INR'],
    features: ['charge', 'refund', 'payment_intent', 'webhooks'],
  });
});

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

// Webhook handler from Razorpay
app.post('/webhooks/razorpay', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify webhook signature
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    console.log('Received Razorpay webhook:', event.event);

    // Forward to SSP Backend
    if (process.env.SSP_CALLBACK_URL) {
      const forwardPayload = {
        provider: 'razorpay-upi',
        event: event.event,
        payload: event.payload,
        transaction_id: event.payload?.payment?.entity?.id,
      };
      const forwardBody = JSON.stringify(forwardPayload);
      const forwardSignature = crypto
        .createHmac('sha256', process.env.SSP_WEBHOOK_SECRET)
        .update(forwardBody)
        .digest('hex');

      await axios.post(process.env.SSP_CALLBACK_URL, forwardPayload, {
        headers: {
          'X-Plugin-Api-Key': process.env.SSP_PLUGIN_API_KEY,
          'X-SSP-Signature': forwardSignature,
          'Content-Type': 'application/json',
        },
      });

      console.log('Forwarded to SSP Backend');
    }

    res.json({ status: 'ok' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
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
