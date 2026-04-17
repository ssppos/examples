# Python (Flask) Minimal Template

Minimal SSP Plugin template using Python and Flask.

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your SSP API key
```

### 3. Run

```bash
python app.py
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

## Deployment

### Heroku

```bash
# Create Procfile
echo "web: gunicorn app:app" > Procfile

heroku create your-plugin-name
git push heroku main
heroku config:set SSP_WEBHOOK_SECRET=your-secret
```

### DigitalOcean App Platform

Use `gunicorn app:app` as the run command.

## Project Structure

```
python/
├── app.py              # Main application
├── requirements.txt    # Dependencies
├── .env.example       # Environment template
└── README.md          # This file
```

## Next Steps

1. Implement your business logic in `your_endpoint()`
2. Add more endpoints as needed
3. Add error handling
4. Write tests
5. Deploy!
