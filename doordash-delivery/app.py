"""
DoorDash Delivery Integration for SSP POS
Python/Flask implementation
"""

from flask import Flask, request, jsonify
from functools import wraps
from datetime import datetime, timedelta
import os
import hmac
import hashlib
import json
import requests
import logging

app = Flask(__name__)

# Configuration
SSP_PLUGIN_API_KEY = os.getenv('SSP_PLUGIN_API_KEY')
# Sandbox and production share this base URL - your pik_ key decides which
# data plane you reach.
SSP_API_BASE = os.getenv('SSP_API_BASE', 'https://api.ssppos.com/api/plugin/v1')
SSP_WEBHOOK_URL = os.getenv('SSP_WEBHOOK_URL', SSP_API_BASE + '/webhooks/external')
SSP_WEBHOOK_SECRET = os.getenv('SSP_WEBHOOK_SECRET')
DOORDASH_API_URL = os.getenv('DOORDASH_API_URL', 'https://openapi.doordash.com')
DOORDASH_WEBHOOK_SECRET = os.getenv('DOORDASH_WEBHOOK_SECRET')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Authentication decorator — verifies SSP outbound webhook HMAC signature
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        signature = request.headers.get('X-SSP-Signature')

        if not signature or not SSP_WEBHOOK_SECRET:
            return jsonify({
                'error': True,
                'message': 'Unauthorized - Missing signature'
            }), 401

        expected = hmac.new(
            SSP_WEBHOOK_SECRET.encode(),
            request.get_data(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected):
            return jsonify({
                'error': True,
                'message': 'Unauthorized - Invalid signature'
            }), 401

        return f(*args, **kwargs)
    return decorated_function


class DoorDashClient:
    """DoorDash API Client"""

    def __init__(self, developer_id, key_id, signing_secret):
        self.developer_id = developer_id
        self.key_id = key_id
        self.signing_secret = signing_secret
        self.base_url = DOORDASH_API_URL

    def _make_request(self, method, endpoint, data=None):
        """Make authenticated request to DoorDash API"""
        url = f"{self.base_url}{endpoint}"
        headers = {
            'Authorization': f'Bearer {self.key_id}',
            'Content-Type': 'application/json'
        }

        try:
            if method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            else:
                raise ValueError(f'Unsupported method: {method}')

            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f'DoorDash API request failed: {e}')
            raise

    def create_delivery(self, order_data):
        """Create delivery order"""
        payload = {
            'external_delivery_id': order_data['order_id'],
            'pickup_address': order_data['pickup_address'],
            'pickup_business_name': order_data['restaurant_name'],
            'pickup_phone_number': order_data['restaurant_phone'],
            'dropoff_address': order_data['delivery_address']['street'],
            'dropoff_business_name': order_data['customer']['name'],
            'dropoff_phone_number': order_data['customer']['phone'],
            'dropoff_instructions': order_data.get('special_instructions', ''),
            'order_value': int(order_data['total_amount'] * 100),  # cents
            'items': [
                {
                    'name': item['name'],
                    'description': item.get('description', ''),
                    'quantity': item['quantity'],
                    'price': int(item['price'] * 100)
                }
                for item in order_data['items']
            ]
        }

        return self._make_request('POST', '/drive/v2/deliveries', payload)

    def update_delivery_status(self, delivery_id, status):
        """Update delivery status"""
        endpoint = f'/drive/v2/deliveries/{delivery_id}'
        payload = {'status': status}
        return self._make_request('PUT', endpoint, payload)

    def get_delivery_status(self, delivery_id):
        """Get delivery status"""
        endpoint = f'/drive/v2/deliveries/{delivery_id}'
        return self._make_request('GET', endpoint)


# Health check
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    })


# Capabilities
@app.route('/capabilities', methods=['GET'])
def capabilities():
    return jsonify({
        'plugin_type': 'delivery',
        # These are the capability strings SSP actually gates write endpoints on.
        # `orders:create` unlocks POST /orders; `payments:capture` unlocks
        # POST /orders/{id}/payments.
        'supported_features': ['orders:create'],
        'supported_regions': ['US', 'CA'],
        'real_time_tracking': True,
        'estimated_delivery_time': True
    })


# ---------------------------------------------------------------------------
# The routes below are YOUR OWN API surface. SSP never calls them: on a
# marketplace plugin it only polls GET /health and POSTs to your
# webhook_endpoint. They exist so your own dashboard or ops tooling can drive
# DoorDash. The actual SSP integration lives in the helper functions at the
# bottom of this file (create_order_in_ssp / advance_ssp_order) and in the
# webhook handler.
#
# See https://docs.ssppos.com/docs/sdk/delivery-platforms
# ---------------------------------------------------------------------------

# Create delivery order
@app.route('/orders', methods=['POST'])
@require_auth
def create_order():
    try:
        data = request.json
        provider_config = data.get('provider_config', {})

        # Initialize DoorDash client
        client = DoorDashClient(
            developer_id=provider_config.get('developer_id'),
            key_id=provider_config.get('key_id'),
            signing_secret=provider_config.get('signing_secret')
        )

        # Create delivery
        result = client.create_delivery(data)

        logger.info(f"Delivery created: {result.get('external_delivery_id')}")

        return jsonify({
            'success': True,
            'external_order_id': result.get('external_delivery_id'),
            'status': 'accepted',
            'estimated_pickup_time': result.get('pickup_time_estimated'),
            'estimated_delivery_time': result.get('dropoff_time_estimated'),
            'tracking_url': result.get('tracking_url'),
            'driver_info': {
                'name': result.get('dasher_name'),
                'phone': result.get('dasher_phone')
            } if result.get('dasher_name') else None
        })

    except Exception as e:
        logger.error(f'Order creation failed: {str(e)}')
        return jsonify({
            'error': True,
            'message': str(e),
            'code': 'ORDER_CREATION_FAILED'
        }), 400


# Update order status
@app.route('/orders/<order_id>', methods=['PUT'])
@require_auth
def update_order_status(order_id):
    try:
        data = request.json
        provider_config = data.get('provider_config', {})
        new_status = data.get('status')

        # Initialize DoorDash client
        client = DoorDashClient(
            developer_id=provider_config.get('developer_id'),
            key_id=provider_config.get('key_id'),
            signing_secret=provider_config.get('signing_secret')
        )

        # Map SSP status to DoorDash status
        status_map = {
            'preparing': 'preparing',
            'ready_for_pickup': 'ready_for_pickup',
            'picked_up': 'picked_up',
            'cancelled': 'cancelled'
        }

        doordash_status = status_map.get(new_status, new_status)

        # Update status
        result = client.update_delivery_status(order_id, doordash_status)

        logger.info(f"Order {order_id} updated to {new_status}")

        return jsonify({
            'success': True,
            'order_id': order_id,
            'status': new_status,
            'updated_at': datetime.utcnow().isoformat() + 'Z'
        })

    except Exception as e:
        logger.error(f'Status update failed: {str(e)}')
        return jsonify({
            'error': True,
            'message': str(e),
            'code': 'STATUS_UPDATE_FAILED'
        }), 400


# Get order details
@app.route('/orders/<order_id>', methods=['GET'])
@require_auth
def get_order(order_id):
    try:
        provider_config = request.args.to_dict()

        # Initialize DoorDash client
        client = DoorDashClient(
            developer_id=provider_config.get('developer_id'),
            key_id=provider_config.get('key_id'),
            signing_secret=provider_config.get('signing_secret')
        )

        # Get delivery status
        result = client.get_delivery_status(order_id)

        return jsonify({
            'success': True,
            'order_id': order_id,
            'status': result.get('delivery_status'),
            'tracking_url': result.get('tracking_url'),
            'estimated_delivery_time': result.get('dropoff_time_estimated'),
            'driver': {
                'name': result.get('dasher_name'),
                'phone': result.get('dasher_phone'),
                'location': result.get('dasher_location')
            } if result.get('dasher_name') else None
        })

    except Exception as e:
        logger.error(f'Order fetch failed: {str(e)}')
        return jsonify({
            'error': True,
            'message': str(e),
            'code': 'ORDER_FETCH_FAILED'
        }), 400


# Cancel order
@app.route('/orders/<order_id>/cancel', methods=['POST'])
@require_auth
def cancel_order(order_id):
    try:
        data = request.json
        provider_config = data.get('provider_config', {})
        reason = data.get('reason', 'Customer request')

        # Initialize DoorDash client
        client = DoorDashClient(
            developer_id=provider_config.get('developer_id'),
            key_id=provider_config.get('key_id'),
            signing_secret=provider_config.get('signing_secret')
        )

        # Cancel delivery
        result = client.update_delivery_status(order_id, 'cancelled')

        logger.info(f"Order {order_id} cancelled: {reason}")

        return jsonify({
            'success': True,
            'order_id': order_id,
            'status': 'cancelled',
            'cancelled_at': datetime.utcnow().isoformat() + 'Z'
        })

    except Exception as e:
        logger.error(f'Cancellation failed: {str(e)}')
        return jsonify({
            'error': True,
            'message': str(e),
            'code': 'CANCELLATION_FAILED'
        }), 400


# Webhook from DoorDash
@app.route('/webhooks/doordash', methods=['POST'])
def doordash_webhook():
    try:
        # Verify webhook signature
        signature = request.headers.get('X-DoorDash-Signature')

        if not verify_doordash_signature(request.data, signature):
            logger.warning('Invalid webhook signature')
            return jsonify({'error': 'Invalid signature'}), 401

        event = request.json
        event_type = event.get('event_type')

        logger.info(f"Webhook received: {event_type}")

        # Forward the raw provider event to SSP for audit.
        forward_to_ssp(
            event_type,
            transform_doordash_event(event),
            idempotency_key=event.get('event_id'),
        )

        # Reflect the delivery's progress on the SSP order so the kitchen and
        # the back office stay in step. Map the platform's vocabulary onto the
        # plugin state machine.
        ssp_order_id = event.get('ssp_order_id')
        if ssp_order_id:
            status_map = {
                'delivery.status.update': {
                    'picked_up': 'completed',
                    'delivered': 'completed',
                },
                'delivery.cancelled': {None: 'cancelled'},
            }
            mapping = status_map.get(event_type, {})
            target = mapping.get(event.get('status')) or mapping.get(None)
            if target:
                advance_ssp_order(
                    ssp_order_id,
                    target,
                    cancellation_reason=event.get('cancellation_reason'),
                )

        return jsonify({'status': 'ok'})

    except Exception as e:
        logger.error(f'Webhook processing failed: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500


def verify_doordash_signature(payload, signature):
    """Verify DoorDash webhook signature"""
    if not signature or not DOORDASH_WEBHOOK_SECRET:
        return False

    expected_signature = hmac.new(
        DOORDASH_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected_signature)


def transform_doordash_event(event):
    """Transform DoorDash event to SSP format"""
    event_type = event.get('event_type')
    data = event.get('data', {})

    if event_type == 'delivery.status.update':
        return {
            'order_id': data.get('external_delivery_id'),
            'status': data.get('delivery_status'),
            'estimated_delivery_time': data.get('dropoff_time_estimated')
        }
    elif event_type == 'delivery.driver.assigned':
        return {
            'order_id': data.get('external_delivery_id'),
            'driver': {
                'name': data.get('dasher_name'),
                'phone': data.get('dasher_phone'),
                'vehicle': data.get('dasher_vehicle_make')
            }
        }
    elif event_type == 'delivery.cancelled':
        return {
            'order_id': data.get('external_delivery_id'),
            'cancellation_reason': data.get('cancellation_reason')
        }

    return data


def forward_to_ssp(event_type, payload, idempotency_key=None):
    """Forward a DoorDash event to SSP for audit.

    The body shape is fixed: `event_type` (required), `payload` (required),
    `idempotency_key` (optional, deduplicates for 24h per installation).

    `event_type` must be a catalog event, match a wildcard family, or start
    with `external.`. DoorDash's own names (delivery.status.update, ...) are
    none of those, so they are namespaced under `external.` here - sending
    them raw returns 400 unknown_event_type.
    """
    body = json.dumps({
        'event_type': 'external.doordash_' + event_type.replace('.', '_'),
        'payload': payload,
        **({'idempotency_key': idempotency_key} if idempotency_key else {}),
    })

    signature = hmac.new(
        SSP_WEBHOOK_SECRET.encode(),
        body.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    try:
        response = requests.post(
            SSP_WEBHOOK_URL,
            data=body,  # send the exact bytes that were hashed
            headers={
                'X-Plugin-Api-Key': SSP_PLUGIN_API_KEY,
                'X-SSP-Signature': signature,
                'Content-Type': 'application/json'
            },
            timeout=10
        )
        response.raise_for_status()
        logger.info('Event forwarded to SSP')
    except Exception as e:
        logger.error(f'Failed to forward event to SSP: {e}')


def create_order_in_ssp(location_id, doordash_order):
    """Push a DoorDash order into SSP so the kitchen can prepare it.

    This is the core of a delivery integration and requires the
    `orders:create` capability on your plugin listing.

    Notes:
      * Totals are server-authoritative - SSP recomputes subtotal, tax and
        total from menu prices. Anything sent here is ignored.
      * `external_order_id` makes the call idempotent per organization, so
        DoorDash's retries are harmless: a repeat returns 200 with the
        original order instead of creating a duplicate.
      * The order always starts in `open`; advance it with PUT /orders/{id}.
      * DINE_IN is rejected - table management belongs to the POS register.
    """
    payload = {
        'location_id': location_id,
        'order_type': 'DELIVERY',
        'external_order_id': doordash_order['external_delivery_id'],
        'customer': {
            'first_name': doordash_order.get('dropoff_contact_given_name'),
            'last_name': doordash_order.get('dropoff_contact_family_name'),
            'phone': doordash_order.get('dropoff_phone_number'),
            'delivery_address': doordash_order.get('dropoff_address'),
        },
        'items': [
            {
                'menu_item_id': item['ssp_menu_item_id'],
                'quantity': item['quantity'],
                'notes': item.get('special_instructions'),
            }
            for item in doordash_order.get('items', [])
        ],
        'metadata': {
            'delivery_platform': 'doordash',
            'tracking_url': doordash_order.get('tracking_url'),
        },
    }

    response = requests.post(
        SSP_API_BASE + '/orders',
        json=payload,
        headers={'X-Plugin-Api-Key': SSP_PLUGIN_API_KEY},
        timeout=10
    )

    # 201 = created, 200 = idempotency replay. Both are success.
    if response.status_code not in (200, 201):
        # 403 feature_not_enabled  -> missing the orders:create capability
        # 422 validation_error     -> bad menu_item_id, quantity, etc.
        logger.error(f'SSP order creation failed: {response.status_code} {response.text}')
        response.raise_for_status()

    order = response.json()['data']
    logger.info(f"SSP order {order['id']} created for DoorDash delivery "
                f"{doordash_order['external_delivery_id']}")
    return order


def advance_ssp_order(ssp_order_id, plugin_status, cancellation_reason=None):
    """Drive an SSP order through the plugin-facing state machine.

    Allowed transitions:
        open        -> in_progress | cancelled
        in_progress -> ready       | cancelled
        ready       -> completed   | cancelled
        completed   -> paid
        paid, cancelled are terminal

    An illegal target returns 422 invalid_transition WITH the legal next
    states, so prefer recovering from `allowed_next_states` over hardcoding
    the graph.
    """
    body = {'order_status': plugin_status}
    if plugin_status == 'cancelled':
        body['cancellation_reason'] = cancellation_reason or 'Cancelled on DoorDash'

    response = requests.put(
        SSP_API_BASE + f'/orders/{ssp_order_id}',
        json=body,
        headers={'X-Plugin-Api-Key': SSP_PLUGIN_API_KEY},
        timeout=10
    )

    if response.status_code == 422:
        detail = response.json()
        logger.warning(
            f"Transition to {plugin_status} rejected for order {ssp_order_id}; "
            f"allowed: {detail.get('allowed_next_states')}"
        )
        return None

    response.raise_for_status()
    return response.json()['data']


if __name__ == '__main__':
    port = int(os.getenv('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=os.getenv('FLASK_ENV') == 'development')
