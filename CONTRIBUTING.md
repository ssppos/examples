# Contributing to SSP Plugin Examples

Thank you for your interest in contributing! This guide will help you add your plugin example to this repository.

## What We're Looking For

We welcome examples of:
- Payment gateways from different regions
- Delivery platform integrations
- Inventory management systems
- Accounting software integrations
- Marketing and loyalty platforms
- HR and scheduling systems
- Any other creative SSP POS integrations!

## Requirements

Your example must:

1. **Be Complete** - Include all necessary files to run
2. **Be Documented** - Clear README with setup instructions
3. **Follow Standards** - Use consistent API responses
4. **Be Tested** - Include basic test cases
5. **Be Secure** - Follow security best practices
6. **Be Licensed** - Use MIT or similar permissive license

## File Structure

Your example should follow this structure:

```
your-plugin-name/
├── README.md           # Setup and usage instructions
├── index.js            # Main application file (or equivalent)
├── package.json        # Dependencies (or equivalent)
├── .env.example        # Environment variables template
├── .gitignore          # Git ignore file
├── LICENSE             # MIT license
└── tests/              # Test files (optional but recommended)
    └── basic.test.js
```

## README Template

Your README.md should include:

1. **Title and Description**
2. **Features** - What does it support?
3. **Prerequisites** - What's needed to run it?
4. **Installation** - Step-by-step setup
5. **Configuration** - Environment variables explained
6. **Usage** - How to use it
7. **API Endpoints** - What endpoints are implemented
8. **Testing** - How to test
9. **Deployment** - Deployment instructions
10. **Support** - How to get help

## Code Standards

### All Languages

- Use consistent indentation (2 or 4 spaces)
- Include error handling
- Log important events
- Validate all inputs
- Return consistent response formats

### Node.js
```javascript
// Use async/await
// Handle errors properly
try {
  const result = await someFunction();
  res.json({ success: true, data: result });
} catch (error) {
  console.error('Error:', error);
  res.status(500).json({ error: true, message: error.message });
}
```

### Python
```python
# Use type hints
# Follow PEP 8
def process_payment(amount: float, currency: str) -> dict:
    try:
        # Your logic here
        return {"success": True, "data": result}
    except Exception as e:
        logging.error(f"Error: {e}")
        return {"error": True, "message": str(e)}
```

### PHP
```php
// Use type declarations
// Follow PSR-12
function processPayment(float $amount, string $currency): array
{
    try {
        // Your logic here
        return ['success' => true, 'data' => $result];
    } catch (Exception $e) {
        error_log('Error: ' . $e->getMessage());
        return ['error' => true, 'message' => $e->getMessage()];
    }
}
```

## Required Endpoints

All examples must implement:

### GET /health
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2025-11-02T10:30:00Z"
}
```

### GET /capabilities
```json
{
  "supported_methods": ["method1", "method2"],
  "supported_currencies": ["USD", "INR"],
  "features": ["feature1", "feature2"]
}
```

## Security Checklist

- [ ] API keys stored in environment variables
- [ ] Input validation on all endpoints
- [ ] Webhook signature verification
- [ ] HTTPS enforced (in production)
- [ ] Rate limiting implemented
- [ ] Error messages don't expose sensitive data
- [ ] Dependencies are up to date
- [ ] No secrets in code or git history

## Testing

Include at least basic tests:

```javascript
// Example test
describe('Health Check', () => {
  it('should return ok status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
```

## Submission Process

1. **Fork the Repository**
   ```bash
   git clone https://github.com/sspsystems/examples.git
   cd examples
   ```

2. **Create Your Branch**
   ```bash
   git checkout -b add-yourplugin-example
   ```

3. **Add Your Example**
   ```bash
   mkdir your-plugin-name
   # Add all your files
   ```

4. **Test Locally**
   ```bash
   cd your-plugin-name
   npm install  # or equivalent
   npm start
   curl http://localhost:3000/health
   ```

5. **Commit Your Changes**
   ```bash
   git add your-plugin-name/
   git commit -m "Add [Your Plugin] example"
   ```

6. **Push to Your Fork**
   ```bash
   git push origin add-yourplugin-example
   ```

7. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Fill in the template

## Pull Request Template

```markdown
## Description
Brief description of your plugin example.

## Type of Plugin
- [ ] Payment Gateway
- [ ] Delivery Platform
- [ ] Inventory Management
- [ ] Accounting
- [ ] Marketing
- [ ] Other: _______

## Checklist
- [ ] Complete README included
- [ ] All required endpoints implemented
- [ ] Environment variables documented
- [ ] Security best practices followed
- [ ] Tested locally
- [ ] No sensitive data in code
- [ ] MIT License included

## Additional Notes
Any additional information reviewers should know.
```

## Review Process

1. **Automated Checks** - CI/CD will run basic tests
2. **Code Review** - Maintainers will review code quality
3. **Security Review** - Check for security issues
4. **Documentation Review** - Ensure README is clear
5. **Approval** - At least one maintainer approval needed
6. **Merge** - Your example will be merged and published!

## After Your PR is Merged

1. **Tweet About It!** - Share your contribution
2. **Add to Your Portfolio** - Show off your work
3. **Maintain It** - Help with questions and issues
4. **Spread the Word** - Encourage others to contribute

## Questions?

- **Email**: developers@ssppos.com

## Code of Conduct

Be respectful, inclusive, and professional. We're all here to learn and build great things together!

---

Thank you for contributing to SSP Plugin Examples! 🎉
