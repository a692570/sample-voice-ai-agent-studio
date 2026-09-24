#!/bin/bash
#
# Interactive configuration for the PSTN (Twilio) telephony bridge.
#
# Stores the bridge configuration as a single JSON secret in AWS Secrets Manager
# (default name: voice-agent-poc/pstn). Nothing is written to disk. The bridge
# reads this secret at startup when CONFIG_SECRET_NAME is set (see tac_server.py).
#
# Non-secret AWS values (runtime ARN, region, demos table) are auto-detected from
# the deployed CloudFormation stacks and only need confirmation.
#
# Re-running this script updates the existing secret.
#
set -euo pipefail

SECRET_NAME="${CONFIG_SECRET_NAME:-voice-agent-poc/pstn}"

echo "=================================================="
echo "  PSTN (Twilio) Bridge — Configuration"
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

DEMOS_TABLE="$(aws cloudformation describe-stacks \
  --stack-name VoiceAgentDemosStack --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DemosTableName'].OutputValue" \
  --output text 2>/dev/null || echo "voice-agent-poc-demos")"

if [ -z "$RUNTIME_ARN" ] || [ "$RUNTIME_ARN" = "None" ]; then
  echo "  Could not auto-detect the AgentCore runtime ARN."
  read -r -p "  Enter AGENTCORE_RUNTIME_ARN: " RUNTIME_ARN
else
  echo "  AgentCore runtime ARN: $RUNTIME_ARN"
fi
echo "  Demos table:           $DEMOS_TABLE"

# --- Prompt for PSTN-specific values (non-secret) ---
echo ""
echo "Twilio / bridge settings:"
read -r -p "  Public HTTPS domain the bridge is reachable at (e.g. d123.cloudfront.net): " PUBLIC_DOMAIN
while [ -z "$PUBLIC_DOMAIN" ]; do
  read -r -p "  This is required. Public HTTPS domain: " PUBLIC_DOMAIN
done

read -r -p "  Default voice [tiffany]: " DEFAULT_VOICE
DEFAULT_VOICE="${DEFAULT_VOICE:-tiffany}"

# --- Build JSON (no secrets for PSTN; the bridge uses Twilio's signed webhook) ---
CONFIG_JSON="$(cat <<EOF
{
  "AGENTCORE_RUNTIME_ARN": "$RUNTIME_ARN",
  "AWS_REGION": "$REGION",
  "DEMOS_TABLE_NAME": "$DEMOS_TABLE",
  "TWILIO_VOICE_PUBLIC_DOMAIN": "$PUBLIC_DOMAIN",
  "DEFAULT_VOICE": "$DEFAULT_VOICE"
}
EOF
)"

echo ""
echo "About to store this configuration in Secrets Manager as: $SECRET_NAME"
echo "$CONFIG_JSON"
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
    --description "PSTN (Twilio) telephony bridge configuration" \
    --secret-string "$CONFIG_JSON" >/dev/null
  echo "Created secret: $SECRET_NAME"
fi

echo ""
echo "Done. Start the bridge with:"
echo "  CONFIG_SECRET_NAME=$SECRET_NAME AWS_REGION=$REGION uvicorn tac_server:app --host 0.0.0.0 --port 8080"
echo ""
echo "The bridge's IAM role needs: secretsmanager:GetSecretValue on $SECRET_NAME"
echo "Next: point your Twilio number's Voice webhook at https://$PUBLIC_DOMAIN/twiml"
