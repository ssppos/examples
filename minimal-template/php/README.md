# PHP (Slim) Minimal Template

Minimal SSP Plugin template using PHP and Slim Framework.

## Quick Start

### 1. Install Dependencies

```bash
composer install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your SSP API key
```

### 3. Run

```bash
php -S localhost:3000 index.php
```

Or using composer:
```bash
composer start
```

Server starts at `http://localhost:3000`

### 4. Test

```bash
# Health check
curl http://localhost:3000/health

# Test with authentication (X-SSP-Signature = HMAC-SHA256 of body using your webhook secret)
curl -X POST http://localhost:3000/your-endpoint \
  -H "X-SSP-Signature: <hmac-hex>" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## Requirements

- PHP 8.1 or higher
- Composer

## Deployment

### Heroku

```bash
# Create Procfile
echo "web: vendor/bin/heroku-php-apache2" > Procfile

heroku create your-plugin-name
git push heroku main
heroku config:set SSP_WEBHOOK_SECRET=your-secret
```

### Traditional Hosting

Upload files and point web server to `index.php`.

## Project Structure

```
php/
├── index.php          # Main application
├── composer.json      # Dependencies
├── .env.example      # Environment template
└── README.md         # This file
```

## Next Steps

1. Implement your business logic in the `/your-endpoint` route
2. Add more routes as needed
3. Add validation
4. Write tests
5. Deploy!
