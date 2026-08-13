package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// Authentication middleware — verifies SSP outbound webhook HMAC signature
func authMiddleware() gin.HandlerFunc {
	webhookSecret := os.Getenv("SSP_WEBHOOK_SECRET")

	return func(c *gin.Context) {
		signature := c.GetHeader("X-SSP-Signature")

		if signature == "" || webhookSecret == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   true,
				"message": "Unauthorized - Missing signature",
			})
			c.Abort()
			return
		}

		// The RAW bytes. Never hash a re-marshalled copy - the signature
		// covers the exact bytes SSP transmitted.
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   true,
				"message": "Unable to read request body",
			})
			c.Abort()
			return
		}
		// Replace the body so downstream handlers can read it
		c.Request.Body = io.NopCloser(bytes.NewBuffer(body))

		mac := hmac.New(sha256.New, []byte(webhookSecret))
		mac.Write(body)
		expected := hex.EncodeToString(mac.Sum(nil))

		if !hmac.Equal([]byte(signature), []byte(expected)) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   true,
				"message": "Unauthorized - Invalid signature",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// Health check - the ONE endpoint SSP requires you to expose.
// SSP polls GET {api_endpoint}/health with a 5-second timeout; a response
// slower than 3 seconds is recorded as "degraded" on your marketplace listing,
// so keep this free of database and upstream calls.
func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"version":   "1.0.0",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// SSP webhook receiver.
// Subscribe to events via `supported_events` on your plugin listing.
func webhookHandler(c *gin.Context) {
	var envelope struct {
		Event          string                 `json:"event"`
		Timestamp      string                 `json:"timestamp"`
		InstallationID int64                  `json:"installation_id"`
		Data           map[string]interface{} `json:"data"`
	}

	if err := c.BindJSON(&envelope); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   true,
			"message": "Invalid JSON request body",
		})
		return
	}

	// InstallationID is your tenant key - look up that installation's pik_ key
	// and act in its context.
	log.Printf("[%d] %s", envelope.InstallationID, envelope.Event)

	// TODO: enqueue the work rather than doing it here. SSP allows 10 seconds
	// and retries 3 times (60s / 300s / 900s) on any non-2xx, so slow
	// processing on the request path turns into duplicate deliveries.
	// Make handling idempotent: duplicates are normal, not exceptional.

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Your own endpoints. SSP never calls these - design them as you like.
// Everything beyond /health and the webhook route is YOUR plugin calling SSP,
// authenticated with the installation's pik_ key against
// https://api.ssppos.com/api/plugin/v1 - see
// https://docs.ssppos.com/docs/sdk/plugin-data-api
func yourEndpointHandler(c *gin.Context) {
	// TODO: Implement your business logic here
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Error handler middleware
func errorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) > 0 {
			err := c.Errors.Last()
			log.Printf("Error: %v", err.Err)

			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   true,
				"message": "Internal server error",
			})
		}
	}
}

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using system environment variables")
	}

	// Validate required environment variables
	if os.Getenv("SSP_WEBHOOK_SECRET") == "" {
		log.Fatal("SSP_WEBHOOK_SECRET environment variable is required")
	}

	// Set Gin mode
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	router := gin.Default()

	// Apply error handler
	router.Use(errorHandler())

	// Health check - polled by SSP
	router.GET("/health", healthHandler)

	// Webhook receiver - signature-verified
	webhooks := router.Group("/webhooks")
	webhooks.Use(authMiddleware())
	{
		webhooks.POST("/ssp", webhookHandler)
	}

	// Your own routes
	router.POST("/your-endpoint", yourEndpointHandler)

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Start server
	log.Printf("SSP Plugin Server starting on port %s", port)
	log.Printf("  Health:  GET  http://localhost:%s/health", port)
	log.Printf("  Webhook: POST http://localhost:%s/webhooks/ssp", port)

	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
