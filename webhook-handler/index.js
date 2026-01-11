/**
 * SSP Webhook Handler Example
 *
 * This example demonstrates how to receive and process webhooks from SSP.
 * It shows proper signature verification and event handling patterns.
 */

const express = require('express');
const crypto = require('crypto');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-webhook-secret';

/**
 * Verify SSP webhook signature using HMAC SHA-256
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/**
 * SSP Webhook endpoint
 *
 * Receives webhooks from SSP for subscribed events.
 * Events are specified during plugin registration via supported_events.
 */
app.post('/webhooks/ssp', (req, res) => {
  // Get signature and event type from headers
  const signature = req.headers['x-ssp-signature'];
  const eventType = req.headers['x-ssp-event'];

  // Verify signature
  if (!verifySignature(req.body, signature, WEBHOOK_SECRET)) {
    console.warn('Invalid webhook signature received');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Extract payload
  const { event, timestamp, installation_id, data } = req.body;

  console.log(`Received webhook: ${event}`);
  console.log(`Installation: ${installation_id}`);
  console.log(`Timestamp: ${timestamp}`);

  // Route to appropriate handler
  try {
    switch (event) {
      // Order Events
      case 'order.created':
        handleOrderCreated(data);
        break;
      case 'order.status_changed':
        handleOrderStatusChanged(data);
        break;
      case 'order.items_added':
        handleOrderItemsAdded(data);
        break;
      case 'order.paid':
        handleOrderPaid(data);
        break;
      case 'order.cancelled':
        handleOrderCancelled(data);
        break;

      // Payment Events
      case 'payment.succeeded':
        handlePaymentSucceeded(data);
        break;
      case 'payment.failed':
        handlePaymentFailed(data);
        break;
      case 'payment.refunded':
        handlePaymentRefunded(data);
        break;

      // Menu Events
      case 'menu.item_created':
        handleMenuItemCreated(data);
        break;
      case 'menu.item_updated':
        handleMenuItemUpdated(data);
        break;
      case 'menu.item_deleted':
        handleMenuItemDeleted(data);
        break;

      // Plugin Lifecycle Events
      case 'plugin.installed':
        handlePluginInstalled(data);
        break;
      case 'plugin.uninstalled':
        handlePluginUninstalled(data);
        break;
      case 'plugin.configuration_updated':
        handleConfigurationUpdated(data);
        break;

      default:
        console.log(`Unhandled event type: ${event}`);
    }

    // Respond quickly - SSP expects response within 5 seconds
    res.json({ status: 'ok', received: event });
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 to prevent retries for application errors
    res.json({ status: 'error', message: error.message });
  }
});

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Order Events
 */

function handleOrderCreated(data) {
  console.log('New order created:', {
    orderId: data.order_id,
    uniqueOrderId: data.unique_orderid,
    status: data.order_status,
    total: data.total_amount,
    location: data.location_id
  });

  // Example: Sync order to external system
  // await externalAPI.createOrder(data);
}

function handleOrderStatusChanged(data) {
  console.log('Order status changed:', {
    orderId: data.order_id,
    oldStatus: data.old_status,
    newStatus: data.new_status
  });

  // Example: Update delivery platform
  // await deliveryPlatform.updateOrderStatus(data.order_id, data.new_status);
}

function handleOrderItemsAdded(data) {
  console.log('Items added to order:', {
    orderId: data.order_id,
    newItems: data.items
  });
}

function handleOrderPaid(data) {
  console.log('Order paid:', {
    orderId: data.order_id,
    amount: data.total_amount,
    paymentMethod: data.payment_method
  });

  // Example: Generate receipt, notify kitchen
  // await receiptService.generate(data);
}

function handleOrderCancelled(data) {
  console.log('Order cancelled:', {
    orderId: data.order_id,
    reason: data.cancellation_reason
  });

  // Example: Process refund, update inventory
  // await refundService.process(data);
}

/**
 * Payment Events
 */

function handlePaymentSucceeded(data) {
  console.log('Payment succeeded:', {
    transactionId: data.transaction_id,
    amount: data.amount,
    method: data.payment_method
  });

  // Example: Record in accounting system
  // await accountingSystem.recordPayment(data);
}

function handlePaymentFailed(data) {
  console.log('Payment failed:', {
    transactionId: data.transaction_id,
    error: data.error_message,
    errorCode: data.error_code
  });

  // Example: Alert staff, log for analysis
  // await alertService.notify('Payment failed', data);
}

function handlePaymentRefunded(data) {
  console.log('Payment refunded:', {
    originalTransactionId: data.original_transaction_id,
    refundAmount: data.refund_amount,
    reason: data.reason
  });

  // Example: Update accounting, notify customer
  // await accountingSystem.recordRefund(data);
}

/**
 * Menu Events
 */

function handleMenuItemCreated(data) {
  console.log('Menu item created:', {
    itemId: data.item_id,
    name: data.name,
    price: data.price,
    category: data.category_name
  });

  // Example: Sync to delivery platform menu
  // await deliveryPlatform.addMenuItem(data);
}

function handleMenuItemUpdated(data) {
  console.log('Menu item updated:', {
    itemId: data.item_id,
    name: data.name,
    changes: data.changes
  });

  // Example: Update external menu listings
  // await deliveryPlatform.updateMenuItem(data);
}

function handleMenuItemDeleted(data) {
  console.log('Menu item deleted:', {
    itemId: data.item_id,
    name: data.name
  });

  // Example: Remove from external platforms
  // await deliveryPlatform.removeMenuItem(data.item_id);
}

/**
 * Plugin Lifecycle Events
 */

function handlePluginInstalled(data) {
  console.log('Plugin installed:', {
    installationId: data.installation_id,
    organizationId: data.organization_id,
    organizationName: data.organization_name,
    locationId: data.location_id
  });

  // Example: Initialize resources for this installation
  // await initializeInstallation(data.installation_id);
}

function handlePluginUninstalled(data) {
  console.log('Plugin uninstalled:', {
    installationId: data.installation_id,
    organizationId: data.organization_id
  });

  // Example: Clean up resources
  // await cleanupInstallation(data.installation_id);
}

function handleConfigurationUpdated(data) {
  console.log('Configuration updated:', {
    installationId: data.installation_id,
    changes: data.configuration
  });

  // Example: Apply new configuration
  // await applyConfiguration(data.installation_id, data.configuration);
}

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`SSP Webhook Handler running on port ${PORT}`);
  console.log(`Webhook endpoint: POST /webhooks/ssp`);
  console.log(`Health check: GET /health`);
});
