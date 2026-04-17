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

// Health check - REQUIRED
$app->get('/health', function (Request $request, Response $response) {
    $data = [
        'status' => 'ok',
        'version' => '1.0.0',
        'timestamp' => gmdate('Y-m-d\TH:i:s\Z')
    ];

    $response->getBody()->write(json_encode($data));
    return $response->withHeader('Content-Type', 'application/json');
});

// Capabilities - REQUIRED
$app->get('/capabilities', function (Request $request, Response $response) {
    $data = [
        'supported_methods' => ['your_methods_here'],
        'supported_currencies' => ['USD', 'INR'],
        'features' => ['feature1', 'feature2']
    ];

    $response->getBody()->write(json_encode($data));
    return $response->withHeader('Content-Type', 'application/json');
});

// Example endpoint - Implement your business logic here
$app->post('/your-endpoint', function (Request $request, Response $response) {
    try {
        $data = $request->getParsedBody();

        // TODO: Implement your logic here
        // 1. Validate input
        // 2. Process request
        // 3. Return response

        $result = [
            'success' => true,
            'message' => 'Request processed successfully',
            'data' => [
                // Your response data
            ]
        ];

        $response->getBody()->write(json_encode($result));
        return $response->withHeader('Content-Type', 'application/json');

    } catch (Exception $e) {
        error_log('Error: ' . $e->getMessage());

        $error = [
            'error' => true,
            'message' => $e->getMessage()
        ];

        $response->getBody()->write(json_encode($error));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(500);
    }
})->add($authMiddleware);

// 404 handler
$app->map(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], '/{routes:.+}', function ($request, $response) {
    throw new HttpNotFoundException($request);
});

$app->run();
