const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Authentication middleware — verifies SSP outbound webhook HMAC signature
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

// Health check - REQUIRED
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Capabilities - REQUIRED
app.get('/capabilities', (req, res) => {
  res.json({
    supported_methods: ['your_methods_here'],
    supported_currencies: ['USD', 'INR'],
    features: ['feature1', 'feature2'],
  });
});

// Example endpoint - Implement your business logic here
app.post('/your-endpoint', authenticate, async (req, res) => {
  try {
    const { data } = req.body;

    // TODO: Implement your logic here
    // 1. Validate input
    // 2. Process request
    // 3. Return response

    res.json({
      success: true,
      message: 'Request processed successfully',
      data: {
        // Your response data
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: true,
      message: error.message || 'Internal server error',
    });
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
  console.log(`SSP Plugin running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

module.exports = app;
