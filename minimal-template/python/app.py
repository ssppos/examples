from flask import Flask, request, jsonify
from functools import wraps
from datetime import datetime
import os
import hmac
import hashlib
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Configuration
SSP_WEBHOOK_SECRET = os.getenv('SSP_WEBHOOK_SECRET')
PORT = int(os.getenv('PORT', 3000))

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

        # request.get_data() gives the RAW bytes. Never hash a re-serialized
        # copy (json.dumps(request.json)) - the signature covers the exact
        # bytes SSP transmitted.
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

# Health check - the ONE endpoint SSP requires you to expose.
# SSP polls GET {api_endpoint}/health with a 5-second timeout; a response
# slower than 3 seconds is recorded as "degraded" on your marketplace listing,
# so keep this free of database and upstream calls.
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    })

# SSP webhook receiver.
# Subscribe to events via `supported_events` on your plugin listing.
@app.route('/webhooks/ssp', methods=['POST'])
@require_auth
def ssp_webhook():
    envelope = request.get_json()
    event = envelope.get('event')
    installation_id = envelope.get('installation_id')
    data = envelope.get('data', {})

    # `installation_id` is your tenant key - look up that installation's pik_
    # key and act in its context.
    app.logger.info(f'[{installation_id}] {event}')

    # TODO: enqueue the work rather than doing it here. SSP allows 10 seconds
    # and retries 3 times (60s / 300s / 900s) on any non-2xx, so slow
    # processing on the request path turns into duplicate deliveries.
    # Make handling idempotent: duplicates are normal, not exceptional.

    return jsonify({'status': 'ok'})


# Your own endpoints. SSP never calls these - design them as you like.
# Everything beyond /health and the webhook route is YOUR plugin calling SSP:
#
#   requests.get(
#       'https://api.ssppos.com/api/plugin/v1/orders',
#       headers={'X-Plugin-Api-Key': installation_api_key},
#   )
#
# See https://docs.ssppos.com/docs/sdk/plugin-data-api
@app.route('/your-endpoint', methods=['POST'])
def your_endpoint():
    try:
        # TODO: Implement your logic here
        return jsonify({'success': True})

    except Exception as e:
        app.logger.error(f'Error: {str(e)}')
        return jsonify({
            'error': True,
            'message': str(e)
        }), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'error': True,
        'message': 'Endpoint not found'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'error': True,
        'message': 'Internal server error'
    }), 500

if __name__ == '__main__':
    print(f'SSP Plugin running on port {PORT}')
    print(f'Health: http://localhost:{PORT}/health')
    app.run(host='0.0.0.0', port=PORT, debug=os.getenv('DEBUG', 'False') == 'True')
