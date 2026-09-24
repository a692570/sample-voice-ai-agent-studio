#!/bin/bash
set -e

echo "============================================"
echo "  Voice AI POC-in-a-Box — Full Deployment"
echo "============================================"
echo ""

# Validate environment
if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    echo "Auto-detected AWS Account: $CDK_DEFAULT_ACCOUNT"
fi

if [ -z "$CDK_DEFAULT_REGION" ]; then
    export CDK_DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
    echo "Auto-detected AWS Region: $CDK_DEFAULT_REGION"
fi

echo ""
echo "Account: $CDK_DEFAULT_ACCOUNT"
echo "Region:  $CDK_DEFAULT_REGION"
echo ""

# Step 1: Set up Python virtual environment
echo "▶ Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q
echo "✓ CDK dependencies installed"
echo ""

# Step 2: Bootstrap CDK
echo "▶ Bootstrapping CDK..."
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION 2>/dev/null || true
echo "✓ CDK bootstrapped"
echo ""

# Step 3: Deploy backend stacks first (needed for env vars)
echo "▶ Deploying PreStack (Cognito, S3, ECR)..."
npx cdk deploy VoiceAgentPreStack --require-approval never
echo "✓ PreStack deployed"
echo ""

echo "▶ Deploying AgentStack (Voice Agent Runtime)..."
npx cdk deploy VoiceAgentAgentStack --require-approval never
echo "✓ AgentStack deployed"
echo ""

echo "▶ Deploying DemosStack (DynamoDB + API Gateway)..."
npx cdk deploy VoiceAgentDemosStack --require-approval never
echo "✓ DemosStack deployed"
echo ""

# NOTE: The Bedrock Knowledge Base + RAG API are part of DemosStack (deployed
# above) — there is no separate KBStack in the CDK app.
echo ""

# NOTE: Telephony (PSTN relay) and SIP are deployed separately — see the
# telephony/pstn/ and telephony/sip/ folders. They are not part of this CDK app.

# Step 4: Fetch env vars from deployed stacks for frontend build
echo "▶ Fetching config for frontend build..."
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
IDENTITY_POOL_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='IdentityPoolId'].OutputValue" --output text)
API_URL=$(aws cloudformation describe-stacks --stack-name VoiceAgentDemosStack \
  --query "Stacks[0].Outputs[?OutputKey=='DemosApiUrl'].OutputValue" --output text)
# RAG API is served by the Demos API (same endpoint), so reuse API_URL.
RAG_API_URL="$API_URL"
AGENTCORE_WS_URL=$(aws cloudformation describe-stacks --stack-name VoiceAgentAgentStack \
  --query "Stacks[0].Outputs[?OutputKey=='AgentCoreWsUrl'].OutputValue" --output text 2>/dev/null || echo "")
AGENTCORE_RUNTIME_ARN=$(aws cloudformation describe-stacks --stack-name VoiceAgentAgentStack \
  --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" --output text 2>/dev/null || echo "")
# Telephony is deployed separately (see telephony/). Optionally supply the
# webhook URL via the TWILIO_WEBHOOK_URL env var; defaults to blank.
TWILIO_WEBHOOK_URL="${TWILIO_WEBHOOK_URL:-}"
AWS_REGION=${CDK_DEFAULT_REGION:-us-east-1}

echo "  UserPoolId:       $USER_POOL_ID"
echo "  ClientId:         $CLIENT_ID"
echo "  IdentityPoolId:   $IDENTITY_POOL_ID"
echo "  API URL:          $API_URL"
echo "  RAG API URL:      $RAG_API_URL"
echo "  AgentCore WS:     $AGENTCORE_WS_URL"
echo "  AgentCore ARN:    $AGENTCORE_RUNTIME_ARN"
echo "  Twilio Webhook:   $TWILIO_WEBHOOK_URL"
echo "  Region:           $AWS_REGION"
echo ""

# Step 5: Build frontend with env vars
echo "▶ Building frontend..."
cd ../source/frontend

cat > .env.production <<EOF
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
VITE_API_URL=$API_URL
VITE_RAG_API_URL=$RAG_API_URL
VITE_AGENTCORE_WS_URL=$AGENTCORE_WS_URL
VITE_AGENTCORE_RUNTIME_ARN=$AGENTCORE_RUNTIME_ARN
VITE_TWILIO_WEBHOOK_URL=$TWILIO_WEBHOOK_URL
VITE_AWS_REGION=$AWS_REGION
EOF

npm install
npm run build
cd ../../deployment
echo "✓ Frontend built with production config"
echo ""

# Step 6: Deploy frontend
echo "▶ Deploying FrontendStack (CloudFront + S3)..."
npx cdk deploy VoiceAgentFrontendStack --require-approval never
echo "✓ FrontendStack deployed"
echo ""

# Step 7: Post-deployment (user creation)
echo "▶ Deploying PostStack (User creation)..."
npx cdk deploy VoiceAgentPostStack --require-approval never
echo "✓ PostStack deployed"
echo ""

# Get website URL
WEBSITE_URL=$(aws cloudformation describe-stacks --stack-name VoiceAgentFrontendStack \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" --output text 2>/dev/null || echo "Check CloudFormation outputs")

echo "============================================"
echo "  ✓ Deployment Complete!"
echo "============================================"
echo ""
echo "  🌐 Website:  $WEBSITE_URL"
echo "  🔑 API:      $API_URL"
echo ""
echo "--------------------------------------------"
echo "  📧 Share this with your users"
echo "--------------------------------------------"
echo "  Cognito emailed a username + temporary password to:"
echo "    $CDK_INPUT_USER_EMAILS"
echo ""
echo "  That email does NOT contain the sign-in URL. Send users the site:"
echo ""
echo "    👉  $WEBSITE_URL"
echo ""
echo "  They log in there with the emailed credentials and set a new password."
echo "--------------------------------------------"
echo ""
echo "Tip: Deploy independently with:"
echo "  Backend only:   bash deploy-backend.sh"
echo "  Frontend only:  bash deploy-frontend.sh"
echo ""
