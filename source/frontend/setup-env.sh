#!/bin/bash
#
# Fetches all config from deployed CloudFormation stacks
# and writes .env.local for local frontend development.
#
set -e

PRE_STACK="VoiceAgentPreStack"
AGENT_STACK="VoiceAgentAgentStack"
DEMOS_STACK="VoiceAgentDemosStack"

echo "▶ Fetching outputs from CloudFormation..."

# Cognito from PreStack
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "$PRE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text 2>/dev/null || echo "")
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name "$PRE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text 2>/dev/null || echo "")
IDENTITY_POOL_ID=$(aws cloudformation describe-stacks --stack-name "$PRE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='IdentityPoolId'].OutputValue" --output text 2>/dev/null || echo "")

# AgentCore from AgentStack
AGENTCORE_WS_URL="ws://localhost:8081/ws"
AGENTCORE_RUNTIME_ARN=$(aws cloudformation describe-stacks --stack-name "$AGENT_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" --output text 2>/dev/null || echo "")

# API from DemosStack
API_URL=$(aws cloudformation describe-stacks --stack-name "$DEMOS_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DemosApiUrl'].OutputValue" --output text 2>/dev/null || echo "")

# Region
AWS_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

# Handle "None" values from AWS CLI
[ "$USER_POOL_ID" = "None" ] && USER_POOL_ID=""
[ "$CLIENT_ID" = "None" ] && CLIENT_ID=""
[ "$IDENTITY_POOL_ID" = "None" ] && IDENTITY_POOL_ID=""
[ "$AGENTCORE_WS_URL" = "None" ] && AGENTCORE_WS_URL="ws://localhost:8081/ws"
[ "$AGENTCORE_RUNTIME_ARN" = "None" ] && AGENTCORE_RUNTIME_ARN=""
[ "$API_URL" = "None" ] && API_URL=""

# Default fallbacks for local dev
[ -z "$AGENTCORE_WS_URL" ] && AGENTCORE_WS_URL="ws://localhost:8081/ws"

# Write .env.local
cat > .env.local <<EOF
VITE_COGNITO_USER_POOL_ID=$USER_POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
VITE_API_URL=$API_URL
VITE_AGENTCORE_WS_URL=$AGENTCORE_WS_URL
VITE_AGENTCORE_RUNTIME_ARN=$AGENTCORE_RUNTIME_ARN
VITE_AWS_REGION=$AWS_REGION
EOF

echo ""
echo "✓ .env.local created:"
echo ""
cat .env.local
echo ""
echo "Run 'npm run dev' to start the frontend."
