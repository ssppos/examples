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
import requests
import logging

app = Flask(__name__)

# Configuration
SSP_PLUGIN_API_KEY = os.getenv('SSP_PLUGIN_API_KEY')
SSP_WEBHOOK_URL = os.getenv('SSP_WEBHOOK_URL', 'https://api.ssppos.com/webhooks/external')
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
        'supported_features': ['order_creation', 'status_updates', 'tracking', 'cancellation'],
        'supported_regions': ['US', 'CA'],
        'real_time_tracking': True,
        'estimated_delivery_time': True
    })


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

        # Forward to SSP
        forward_to_ssp({
            'provider': 'doordash',
            'event_type': event_type,
            'event_id': event.get('event_id'),
            'payload': transform_doordash_event(event),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

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


def forward_to_ssp(webhook_data):
    """Forward webhook to SSP Backend"""
    try:
        import json
        body = json.dumps(webhook_data)
        signature = hmac.new(
            SSP_WEBHOOK_SECRET.encode(),
            body.encode(),
            hashlib.sha256
        ).hexdigest()

        response = requests.post(
            SSP_WEBHOOK_URL,
            data=body,
            headers={
                'X-Plugin-Api-Key': SSP_PLUGIN_API_KEY,
                'X-SSP-Signature': signature,
                'Content-Type': 'application/json'
            },
            timeout=5
        )
        response.raise_for_status()
        logger.info('Webhook forwarded to SSP successfully')
    except Exception as e:
        logger.error(f'Failed to forward webhook to SSP: {e}')


if __name__ == '__main__':
    port = int(os.getenv('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=os.getenv('FLASK_ENV') == 'development')
