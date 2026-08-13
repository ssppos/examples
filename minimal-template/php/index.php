<?php

require 'vendor/autoload.php';

use Slim\Factory\AppFactory;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Exception\HttpNotFoundException;

// Load environment variables
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$app = AppFactory::create();
$app->addBodyParsingMiddleware();
$app->addErrorMiddleware(true, true, true);

// Authentication middleware — verifies SSP outbound webhook HMAC signature
$authMiddleware = function (Request $request, $handler) {
    $signature = $request->getHeaderLine('X-SSP-Signature');
    $webhookSecret = $_ENV['SSP_WEBHOOK_SECRET'] ?? '';

    if (empty($signature) || empty($webhookSecret)) {
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode([
            'error' => true,
            'message' => 'Unauthorized - Missing signature'
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(401);
    }

    // The RAW body. Never hash a re-encoded copy (json_encode of the parsed
    // array) - the signature covers the exact bytes SSP transmitted.
    $body = (string) $request->getBody();
    $expected = hash_hmac('sha256', $body, $webhookSecret);

    if (!hash_equals($expected, $signature)) {
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode([
            'error' => true,
            'message' => 'Unauthorized - Invalid signature'
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(401);
    }

    return $handler->handle($request);
};

// Health check - the ONE endpoint SSP requires you to expose.
// SSP polls GET {api_endpoint}/health with a 5-second timeout; a response
// slower than 3 seconds is recorded as "degraded" on your marketplace listing,
// so keep this free of database and upstream calls.
$app->get('/health', function (Request $request, Response $response) {
    $data = [
        'status' => 'ok',
        'version' => '1.0.0',
        'timestamp' => gmdate('Y-m-d\TH:i:s\Z')
    ];

    $response->getBody()->write(json_encode($data));
    return $response->withHeader('Content-Type', 'application/json');
});

// SSP webhook receiver.
// Subscribe to events via `supported_events` on your plugin listing.
$app->post('/webhooks/ssp', function (Request $request, Response $response) {
    $envelope = json_decode((string) $request->getBody(), true);

    $event = $envelope['event'] ?? null;
    $installationId = $envelope['installation_id'] ?? null;
    $data = $envelope['data'] ?? [];

    // `installation_id` is your tenant key - look up that installation's pik_
    // key and act in its context.
    error_log("[{$installationId}] {$event}");

    // TODO: enqueue the work rather than doing it here. SSP allows 10 seconds
    // and retries 3 times (60s / 300s / 900s) on any non-2xx, so slow
    // processing on the request path turns into duplicate deliveries.
    // Make handling idempotent: duplicates are normal, not exceptional.

    $response->getBody()->write(json_encode(['status' => 'ok']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

// Your own endpoints. SSP never calls these - design them as you like.
// Everything beyond /health and the webhook route is YOUR plugin calling SSP:
//
//   $client->get('https://api.ssppos.com/api/plugin/v1/orders', [
//       'headers' => ['X-Plugin-Api-Key' => $installationApiKey],
//   ]);
//
// See https://docs.ssppos.com/docs/sdk/plugin-data-api
$app->post('/your-endpoint', function (Request $request, Response $response) {
    try {
        // TODO: Implement your logic here
        $response->getBody()->write(json_encode(['success' => true]));
        return $response->withHeader('Content-Type', 'application/json');

    } catch (Exception $e) {
        error_log('Error: ' . $e->getMessage());

        $response->getBody()->write(json_encode([
            'error' => true,
            'message' => $e->getMessage()
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
});

// 404 handler
$app->map(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], '/{routes:.+}', function ($request, $response) {
    throw new HttpNotFoundException($request);
});

$app->run();
