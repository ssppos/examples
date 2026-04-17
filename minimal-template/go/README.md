# Go (Gin) Minimal Template

Minimal SSP Plugin template using Go and Gin Framework.

## Quick Start

### 1. Install Dependencies

```bash
go mod download
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your SSP API key
```

### 3. Run

```bash
go run main.go
```

Or build and run:
```bash
go build -o ssp-plugin
./ssp-plugin
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

- Go 1.21 or higher

## Deployment

### Build for Production

```bash
# Build for current OS
go build -o ssp-plugin main.go

# Build for Linux
GOOS=linux GOARCH=amd64 go build -o ssp-plugin-linux main.go

# Run
./ssp-plugin
```

### Docker Deployment

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN go build -o ssp-plugin main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/ssp-plugin .
COPY .env .
EXPOSE 3000
CMD ["./ssp-plugin"]
```

### Heroku

```bash
# Create Procfile
echo "web: ./ssp-plugin" > Procfile

heroku create your-plugin-name
heroku buildpacks:set heroku/go
git push heroku main
heroku config:set SSP_WEBHOOK_SECRET=your-secret
```

## Project Structure

```
go/
├── main.go           # Main application
├── go.mod            # Dependencies
├── .env.example      # Environment template
└── README.md         # This file
```

## Next Steps

1. Implement your business logic in the `/your-endpoint` route
2. Add more routes as needed
3. Add validation using struct tags
4. Write tests
5. Deploy!
