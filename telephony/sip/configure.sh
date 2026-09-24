#!/bin/bash
#
# Interactive configuration for the SIP telephony bridge.
#
# Stores the bridge configuration as a single JSON secret in AWS Secrets Manager
# (default name: voice-agent-poc/sip). Nothing sensitive is written to disk. The
# bridge reads this secret at startup when CONFIG_SECRET_NAME is set (see
# bridge/index.js).
#
# The Jambonz webhook secret is generated randomly by default (this replaces the
# previously hardcoded value). Non-secret AWS values are auto-detected from the
# deployed CloudFormation stacks.
#
# Re-running this script updates the existing secret.
#
set -euo pipefail

SECRET_NAME="${CONFIG_SECRET_NAME:-voice-agent-poc/sip}"

echo "=================================================="
echo "  SIP Bridge — Configuration"
echo "=================================================="
echo ""

# --- Region ---
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-east-1)}"
read -r -p "AWS region [$REGION]: " input_region
REGION="${input_region:-$REGION}"

# --- Auto-detect from CloudFormation ---
echo ""
echo "Detecting deployed values from CloudFormation..."
RUNTIME_ARN="$(aws cloudformation describe-stacks \
  --stack-name VoiceAgentAgentStack --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" \
  --output text 2>/dev/null || echo "")"

if [ -z "$RUNTIME_ARN" ] || [ "$RUNTIME_ARN" = "None" ]; then
  echo "  Could not auto-detect the AgentCore runtime ARN."
  read -r -p "  Enter AGENTCORE_RUNTIME_ARN: " RUNTIME_ARN
else
  echo "  AgentCore runtime ARN: $RUNTIME_ARN"
fi

# --- Prompt for SIP-specific values (non-secret) ---
echo ""
echo "SIP / media settings:"
read -r -p "  Public IP of this server (for RTP media, e.g. Elastic IP): " PUBLIC_IP
while [ -z "$PUBLIC_IP" ]; do
  read -r -p "  This is required. Public IP: " PUBLIC_IP
done

read -r -p "  Agent WebSocket URL [wss://bedrock-agentcore.$REGION.amazonaws.com/...]: " AGENT_WS_URL
read -r -p "  Log level [info]: " LOG_LEVEL
LOG_LEVEL="${LOG_LEVEL:-info}"

# --- Secrets: webhook secret + drachtio secret ---
echo ""
echo "Secrets (stored only in Secrets Manager):"
DEFAULT_WEBHOOK_SECRET="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p | tr -d '\n')"
read -r -s -p "  Jambonz webhook secret [press Enter to generate a random one]: " WEBHOOK_SECRET
echo ""
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$DEFAULT_WEBHOOK_SECRET}"

read -r -s -p "  drachtio admin secret [press Enter to keep default 'cymru']: " DRACHTIO_SECRET
echo ""
DRACHTIO_SECRET="${DRACHTIO_SECRET:-cymru}"

# --- Build JSON ---
CONFIG_JSON="$(cat <<EOF
{
  "AGENTCORE_RUNTIME_ARN": "$RUNTIME_ARN",
  "AWS_REGION": "$REGION",
  "PUBLIC_IP": "$PUBLIC_IP",
  "AGENT_WS_URL": "$AGENT_WS_URL",
  "LOG_LEVEL": "$LOG_LEVEL",
  "WEBHOOK_SECRET": "$WEBHOOK_SECRET",
  "DRACHTIO_SECRET": "$DRACHTIO_SECRET"
}
EOF
)"

# Summary hides the secret values.
echo ""
echo "About to store SIP configuration in Secrets Manager as: $SECRET_NAME"
echo "  AGENTCORE_RUNTIME_ARN: $RUNTIME_ARN"
echo "  AWS_REGION:            $REGION"
echo "  PUBLIC_IP:             $PUBLIC_IP"
echo "  AGENT_WS_URL:          ${AGENT_WS_URL:-(unset)}"
echo "  LOG_LEVEL:             $LOG_LEVEL"
echo "  WEBHOOK_SECRET:        (hidden, $([ "$WEBHOOK_SECRET" = "$DEFAULT_WEBHOOK_SECRET" ] && echo generated || echo provided))"
echo "  DRACHTIO_SECRET:       (hidden)"
echo ""
read -r -p "Proceed? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted. Nothing was written."
  exit 1
fi

# --- Create or update the secret ---
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" --region "$REGION" \
    --secret-string "$CONFIG_JSON" >/dev/null
  echo "Updated existing secret: $SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" --region "$REGION" \
    --description "SIP telephony bridge configuration" \
    --secret-string "$CONFIG_JSON" >/dev/null
  echo "Created secret: $SECRET_NAME"
fi

echo ""
echo "Done. Start the bridge with:"
echo "  CONFIG_SECRET_NAME=$SECRET_NAME AWS_REGION=$REGION node index.js"
echo ""
echo "The bridge's IAM role needs: secretsmanager:GetSecretValue on $SECRET_NAME"
echo "Next: point your SIP trunk origination at this server's public IP on port 5060."
