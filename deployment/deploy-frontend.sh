#!/bin/bash
set -e

echo "============================================"
echo "  Voice AI POC-in-a-Box — Frontend Only"
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

# Step 1: Fetch env vars from deployed stacks
echo "▶ Fetching config from CloudFormation outputs..."
source .venv/bin/activate 2>/dev/null || true

USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
IDENTITY_POOL_ID=$(aws cloudformation describe-stacks --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs[?OutputKey=='IdentityPoolId'].OutputValue" --output text)
API_URL=$(aws cloudformation describe-stacks --stack-name VoiceAgentDemosStack \
  --query "Stacks[0].Outputs[?OutputKey=='DemosApiUrl'].OutputValue" --output text)
AGENTCORE_WS_URL=$(aws cloudformation describe-stacks --stack-name VoiceAgentAgentStack \
  --query "Stacks[0].Outputs[?OutputKey=='AgentCoreWsUrl'].OutputValue" --output text 2>/dev/null || echo "")
AGENTCORE_RUNTIME_ARN=$(aws cloudformation describe-stacks --stack-name VoiceAgentAgentStack \
  --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" --output text 2>/dev/null || echo "")
AWS_REGION=${CDK_DEFAULT_REGION:-us-east-1}

# Strip trailing slash from API URL
API_URL=${API_URL%/}

echo "  API URL:          $API_URL"
echo "  UserPoolId:       $USER_POOL_ID"
echo "  Region:           $AWS_REGION"
echo "✓ Config fetched"
echo ""

# Step 2: Build frontend
echo "▶ Building frontend..."
cd ../source/frontend

cat > .env.production <<EOF
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
VITE_API_URL=$API_URL
VITE_AGENTCORE_WS_URL=$AGENTCORE_WS_URL
VITE_AGENTCORE_RUNTIME_ARN=$AGENTCORE_RUNTIME_ARN
VITE_AWS_REGION=$AWS_REGION
EOF

npm install
npm run build
cd ../../deployment
echo "✓ Frontend built with production config"
echo ""

# Step 2: Set up Python virtual environment and install CDK dependencies
echo "▶ Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q
echo "✓ CDK dependencies installed"
echo ""

# Step 3: Deploy Frontend + Post stacks
echo "▶ Deploying FrontendStack (CloudFront + S3)..."
npx cdk deploy VoiceAgentFrontendStack --require-approval never
echo "✓ FrontendStack deployed"
echo ""

echo "▶ Deploying PostStack (User creation)..."
npx cdk deploy VoiceAgentPostStack --require-approval never
echo "✓ PostStack deployed"
echo ""

echo "============================================"
echo "  ✓ Frontend Deployment Complete!"
echo "============================================"
echo ""
echo "Your website URL is in the CloudFormation outputs:"
echo "  VoiceAgentFrontendStack → WebsiteUrl"
echo ""
