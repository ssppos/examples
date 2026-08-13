/**
 * SSP Webhook Handler Example
 *
 * Demonstrates how to receive and process webhooks from SSP:
 * raw-body signature verification, the real event catalog, and the
 * verify -> acknowledge -> process asynchronously pattern.
 */

const express = require('express');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.SSP_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;

/**
 * Verify an SSP webhook signature.
 *
 * The HMAC covers the EXACT BYTES SSP transmitted. Never hash
 * JSON.stringify(req.body): re-serializing in JavaScript produces different
 * bytes than the sender emitted (forward slashes and non-ASCII characters are
 * escaped differently), so any payload containing a URL or an accented
 * character would fail to verify.
 *
 * @param {Buffer} rawBody   Raw request body — requires express.raw()
 * @param {string} received  The X-SSP-Signature header
 * @param {string} secret    Your plugin's webhook_secret
 */
function verifySignature(rawBody, received, secret) {
  if (!received || !secret) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws when lengths differ, so compare lengths first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Health check.
 *
 * SSP polls GET {api_endpoint}/health periodically with a 5-second timeout.
 * A response slower than 3 seconds is recorded as "degraded" and shown on your
 * marketplace listing, so keep this cheap — no database, no upstream calls.
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * SSP webhook endpoint.
 *
 * express.raw() is mounted on this route specifically so req.body is a Buffer.
 * Subscribe to the events you want via `supported_events` on your plugin
 * listing; wildcards such as `order.*` cover a whole family.
 */
app.post('/webhooks/ssp', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-ssp-signature'];

  if (!verifySignature(req.body, signature, WEBHOOK_SECRET)) {
    console.warn('Rejected webhook: invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let envelope;
  try {
    envelope = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  const { event, timestamp, installation_id: installationId, data } = envelope;

  // Acknowledge FIRST. SSP allows 10 seconds and retries 3 times
  // (60s / 300s / 900s backoff) on any non-2xx, so slow processing on the
  // request path turns into duplicate deliveries.
  res.json({ status: 'ok', received: event });

  setImmediate(() => {
    process_(event, data, installationId, timestamp).catch((err) => {
      // Log and let your own retry/alerting handle it — the response has
      // already gone out, so throwing here cannot trigger an SSP retry.
      console.error(`Failed to process ${event} for installation ${installationId}:`, err);
    });
  });
});

// =============================================================================
// Dispatch
// =============================================================================

/**
 * Every payload carries `installation_id` — that is your tenant key. Look up
 * the matching pik_ key and act in that installation's context.
 */
async function process_(event, data, installationId, timestamp) {
  console.log(`[${installationId}] ${event} at ${timestamp}`);

  // Deliveries can repeat, so make handling idempotent. A natural key from the
  // payload works well; persist the marker in your database, not in memory.
  //
  //   const id = data.transaction_id ?? data.payment_id ?? data.order_id;
  //   const key = `${event}:${installationId}:${id}`;
  //   if (!await db.processedEvents.insertIfAbsent({ key })) return;

  switch (event) {
    // ---- Order events -----------------------------------------------------
    case 'order.created':
      return handleOrderCreated(data, installationId);
    case 'order.status_changed':
      return handleOrderStatusChanged(data, installationId);
    case 'order.items_added':
      return handleOrderItemsAdded(data, installationId);
    case 'order.paid':
      return handleOrderPaid(data, installationId);
    case 'order.cancelled':
      return handleOrderCancelled(data, installationId);

    // ---- Payment events ---------------------------------------------------
    case 'payment.succeeded':
      return handlePaymentSucceeded(data, installationId);
    case 'payment.failed':
      return handlePaymentFailed(data, installationId);
    case 'payment.refunded':
      return handlePaymentRefunded(data, installationId);

    // ---- Menu events ------------------------------------------------------
    case 'menu.item_created':
      return handleMenuItemCreated(data, installationId);
    case 'menu.item_updated':
      return handleMenuItemUpdated(data, installationId);
    case 'menu.item_deleted':
      return handleMenuItemDeleted(data, installationId);

    // ---- Inventory events -------------------------------------------------
    case 'inventory.stock_updated':
      return handleStockUpdated(data, installationId);
    case 'inventory.low_stock':
      return handleLowStock(data, installationId);
    case 'inventory.low_stock_resolved':
      return handleLowStockResolved(data, installationId);

    // ---- Installation lifecycle -------------------------------------------
    case 'installation.created':
      return handleInstallationCreated(data);
    case 'installation.removed':
      return handleInstallationRemoved(data);

    // ---- Subscription and trial lifecycle (paid plugins) ------------------
    case 'trial.started':
      return handleTrialStarted(data);
    case 'trial.ending':
      return handleTrialEnding(data);
    case 'subscription.activated':
      return handleSubscriptionActivated(data);

    // ---- Sandbox lifecycle ------------------------------------------------
    case 'sandbox.expiry_warning':
      return handleSandboxExpiryWarning(data);

    default:
      // Unknown events are normal — SSP adds new ones over time. Ignore them
      // quietly; the 2xx has already been sent.
      console.log(`Ignoring unhandled event: ${event}`);
  }
}

// =============================================================================
// Order events
// =============================================================================

async function handleOrderCreated(data) {
  // `total`, `party_size` and `created_at` are omitted when the event fires
  // from a pending-state transition rather than at creation — treat as optional.
  console.log('Order created:', {
    orderId: data.order_id,
    uniqueOrderId: data.unique_orderid,
    tableNumber: data.table_number, // null for delivery / takeaway
    status: data.order_status, // INTERNAL status, e.g. "CREATED"
    total: data.total,
    partySize: data.party_size,
  });

  // Webhooks are notifications, not data. For line items, the customer, or
  // payments, call GET /api/plugin/v1/orders/{order_id}.
}

async function handleOrderStatusChanged(data) {
  // old_status / new_status are INTERNAL values: CREATED, COOKING, PREPARED,
  // SERVED, COMPLETED, PAID, CANCELLED. REST response bodies, by contrast,
  // return the coarser plugin vocabulary (open, in_progress, ready, ...).
  console.log('Order status changed:', {
    orderId: data.order_id,
    oldStatus: data.old_status,
    newStatus: data.new_status,
  });
}

async function handleOrderItemsAdded(data) {
  // Counts only — fetch the order for the actual items.
  console.log('Items added:', {
    orderId: data.order_id,
    previousItemCount: data.previous_item_count,
    newItemCount: data.new_item_count,
    itemsAdded: data.items_added,
  });
}

async function handleOrderPaid(data) {
  console.log('Order paid:', {
    orderId: data.order_id,
    uniqueOrderId: data.unique_orderid,
    total: data.total,
    paidAt: data.paid_at,
  });
}

async function handleOrderCancelled(data) {
  console.log('Order cancelled:', {
    orderId: data.order_id,
    reason: data.reason, // may be null
    cancelledAt: data.cancelled_at,
  });
}

// =============================================================================
// Payment events
// =============================================================================

/**
 * NOTE: payment.succeeded arrives in TWO different shapes.
 *
 *   observer path  - transaction_id, tip_amount, tax_amount, discount_amount,
 *                    stripe_payment_intent_id, transaction_type, processed_at
 *   capture path   - payment_id, provider, remaining_balance, and none of the above
 *                    (emitted by POST /orders/{id}/payments)
 *
 * A capture your own plugin records also trips the observer, so ONE capture
 * delivers BOTH. Read defensively and deduplicate on the id.
 */
async function handlePaymentSucceeded(data) {
  const transactionId = data.transaction_id ?? data.payment_id;

  console.log('Payment succeeded:', {
    transactionId,
    orderId: data.order_id,
    amount: data.amount,
    currency: data.currency,
    method: data.payment_method,
    // Present on the observer path only.
    tip: data.tip_amount,
    tax: data.tax_amount,
    stripePaymentIntentId: data.stripe_payment_intent_id,
    // Present on the capture path only.
    provider: data.provider,
    remainingBalance: data.remaining_balance,
  });
}

async function handlePaymentFailed(data) {
  console.log('Payment failed:', {
    transactionId: data.transaction_id,
    orderId: data.order_id,
    amount: data.amount,
    error: data.error,
    failedAt: data.failed_at,
  });
}

async function handlePaymentRefunded(data) {
  console.log('Payment refunded:', {
    transactionId: data.transaction_id,
    orderId: data.order_id,
    amount: data.amount,
    reason: data.refund_reason,
    refundedAt: data.refunded_at,
  });
}

// =============================================================================
// Menu events
// =============================================================================

async function handleMenuItemCreated(data) {
  console.log('Menu item created:', {
    itemId: data.item_id,
    name: data.name,
    price: data.price,
    locationId: data.location_id,
    isAvailable: data.is_available,
  });
}

async function handleMenuItemUpdated(data) {
  // `changes` holds only the modified fields — ideal for syncing a delivery
  // platform's menu without re-pushing everything.
  console.log('Menu item updated:', {
    itemId: data.item_id,
    name: data.name,
    changes: data.changes,
  });
}

async function handleMenuItemDeleted(data) {
  console.log('Menu item deleted:', {
    itemId: data.item_id,
    name: data.name,
    deletedAt: data.deleted_at,
  });
}

// =============================================================================
// Inventory events
// =============================================================================

async function handleStockUpdated(data) {
  // Fires on EVERY movement.
  console.log('Stock updated:', {
    movementId: data.movement_id,
    ingredientId: data.ingredient_id,
    locationId: data.location_id,
    delta: data.delta,
    reason: data.reason, // receive | adjust | consume | waste | transfer | count
    onHand: data.stock_level?.on_hand,
  });
}

async function handleLowStock(data) {
  // Crossing event: fires when stock drops to or below the reorder point and
  // no alert is already open — one alert per depletion cycle, not per movement.
  console.log('LOW STOCK:', {
    ingredientId: data.ingredient_id,
    locationId: data.location_id,
    onHand: data.stock_level?.on_hand,
    reorderPoint: data.stock_level?.reorder_point,
  });
}

async function handleLowStockResolved(data) {
  console.log('Low stock resolved:', {
    ingredientId: data.ingredient_id,
    locationId: data.location_id,
    onHand: data.stock_level?.on_hand,
  });
}

// =============================================================================
// Installation lifecycle
// =============================================================================

/**
 * A restaurant installed and activated your plugin — provision their tenant.
 *
 * A plugin with an explicit `supported_events` list must include
 * `installation.*` to receive these; they are not implied.
 */
async function handleInstallationCreated(data) {
  console.log('Installation created:', {
    installationId: data.installation_id,
    pluginId: data.plugin_id,
    organizationId: data.organization_id, // null for sandbox installations
    locationId: data.location_id, // set when pinned to one location
    isTrial: data.is_trial,
    trialEndsAt: data.trial_ends_at,
  });

  // For a PAID plugin, do not unlock paid features here — a paid install sits
  // in pending_payment until checkout completes. Wait for trial.started or
  // subscription.activated instead.
}

/**
 * Fired while the installation is still active, so you can deprovision cleanly.
 */
async function handleInstallationRemoved(data) {
  console.log('Installation removed:', {
    installationId: data.installation_id,
    organizationId: data.organization_id,
  });
}

// =============================================================================
// Subscription and trial lifecycle (paid plugins only)
// =============================================================================

async function handleTrialStarted(data) {
  console.log('Trial started:', {
    installationId: data.installation_id,
    trialEndsAt: data.trial_ends_at,
  });
}

async function handleTrialEnding(data) {
  console.log('Trial ending soon:', {
    installationId: data.installation_id,
    trialEndsAt: data.trial_ends_at,
    daysRemaining: data.days_remaining,
  });
}

async function handleSubscriptionActivated(data) {
  console.log('Subscription activated:', {
    installationId: data.installation_id,
    organizationId: data.organization_id,
  });
}

// =============================================================================
// Sandbox lifecycle
// =============================================================================

/**
 * Fired 7 days before idle expiry would drop your sandbox schema. Any API call
 * with the sandbox's pik_ key resets the clock.
 */
async function handleSandboxExpiryWarning(data) {
  console.warn('Sandbox expiring:', {
    sandboxId: data.sandbox_id,
    lastAccessedAt: data.last_accessed_at,
    wouldExpireAt: data.would_expire_at,
  });
}

// =============================================================================

app.listen(PORT, () => {
  console.log(`SSP webhook handler listening on port ${PORT}`);
  console.log(`  Webhook endpoint: POST /webhooks/ssp`);
  console.log(`  Health check:     GET  /health`);

  if (!WEBHOOK_SECRET) {
    console.warn('  WARNING: SSP_WEBHOOK_SECRET is unset — every webhook will be rejected.');
  }
});

module.exports = app;
