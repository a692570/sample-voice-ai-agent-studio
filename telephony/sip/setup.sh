#!/bin/bash
# Setup script for Jambonz SIP integration
# Run this after `docker compose up -d` to initialize the configuration

set -e

echo "🔧 Setting up Jambonz SIP integration..."

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

API_URL="http://localhost:3002/v1"

# Create service provider
echo "📦 Creating service provider..."
SP_RESPONSE=$(curl -s -X POST "$API_URL/ServiceProviders" \
  -H 'Content-Type: application/json' \
  -d '{"name": "voice-agent-poc"}')
SP_SID=$(echo $SP_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin).get('sid',''))" 2>/dev/null || echo "")

if [ -z "$SP_SID" ]; then
  echo "⚠️  Service provider may already exist, fetching..."
  SP_SID=$(curl -s "$API_URL/ServiceProviders" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['service_provider_sid'] if data else '')" 2>/dev/null || echo "")
fi
echo "   SP SID: $SP_SID"

# Create account
echo "👤 Creating account..."
ACCT_RESPONSE=$(curl -s -X POST "$API_URL/Accounts" \
  -H 'Content-Type: application/json' \
  -d "{
    \"name\": \"default\",
    \"service_provider_sid\": \"$SP_SID\",
    \"webhook_secret\": \"voiceagent123\"
  }")
ACCT_SID=$(echo $ACCT_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin).get('sid',''))" 2>/dev/null || echo "")

if [ -z "$ACCT_SID" ]; then
  echo "⚠️  Account may already exist, fetching..."
  ACCT_SID=$(curl -s "$API_URL/Accounts" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['account_sid'] if data else '')" 2>/dev/null || echo "")
fi
echo "   Account SID: $ACCT_SID"

# Create application
echo "📱 Creating application (call hook)..."
APP_RESPONSE=$(curl -s -X POST "$API_URL/Applications" \
  -H 'Content-Type: application/json' \
  -d "{
    \"name\": \"voice-agent-sip\",
    \"account_sid\": \"$ACCT_SID\",
    \"call_hook\": {
      \"url\": \"http://call-hook:3000/call-hook\",
      \"method\": \"POST\"
    },
    \"call_status_hook\": {
      \"url\": \"http://call-hook:3000/call-status\",
      \"method\": \"POST\"
    }
  }")
APP_SID=$(echo $APP_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin).get('sid',''))" 2>/dev/null || echo "")
echo "   Application SID: $APP_SID"

echo ""
echo "✅ Setup complete!"
echo ""
echo "SIP endpoint: sip:localhost:5060"
echo "Call hook:    http://localhost:3001/health"
echo "Jambonz API: http://localhost:3002"
echo ""
echo "To test: Use a SIP softphone to call sip:test@localhost:5060"
echo "For Twilio: Point your SIP trunk origination to your public IP:5060"
