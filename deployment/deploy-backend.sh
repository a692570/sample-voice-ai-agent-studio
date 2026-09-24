#!/bin/bash
set -e

echo "============================================"
echo "  Voice AI POC-in-a-Box — Backend Only"
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

# Step 1: Set up Python virtual environment and install CDK dependencies
echo "▶ Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q
echo "✓ CDK dependencies installed"
echo ""

# Step 2: Bootstrap CDK (if needed)
echo "▶ Bootstrapping CDK..."
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION 2>/dev/null || true
echo "✓ CDK bootstrapped"
echo ""

# Step 3: Deploy Pre + Agent + Demos stacks
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

echo "============================================"
echo "  ✓ Backend Deployment Complete!"
echo "============================================"
echo ""
echo "Deployed:"
echo "  • Cognito User Pool + Identity Pool"
echo "  • S3 assets bucket"
echo "  • ECR repository"
echo "  • AgentCore Runtime (Nova Sonic voice agent)"
echo "  • DynamoDB demos table + API Gateway + Lambda"
echo ""
echo "Next steps:"
echo "  1. Run the agent locally:  cd ../source/agent && python strands_agent.py"
echo "  2. Or deploy frontend:    bash deploy-frontend.sh"
echo ""
