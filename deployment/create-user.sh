#!/bin/bash
# Create a Cognito admin user for the Voice Agent POC.
#
# The user pool uses email as a sign-in alias, so the USERNAME must NOT be an
# email address — we derive it from the email local-part and store the email as
# an attribute. Login then works with either the username or the email.
#
# Usage:
#   bash create-user.sh
# Optionally override via env vars, e.g.:
#   EMAIL=me@example.com PASSWORD='Str0ngPass!' bash create-user.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"

# --- Inputs (edit these or pass as env vars) ---
EMAIL="${EMAIL:-lanaz@amazon.com}"
PASSWORD="${PASSWORD:-YourStr0ng!Pass}"   # min 8 chars; must meet the pool policy
GROUP="${GROUP:-admin}"                    # set to "" to skip group assignment

# --- Auto-discover the user pool id from the deployed stack ---
USER_POOL_ID="$(aws cloudformation describe-stacks \
  --stack-name VoiceAgentPreStack --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)"

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
  echo "Could not find UserPoolId from VoiceAgentPreStack in $REGION. Is it deployed?"
  exit 1
fi

# Username = email local-part, sanitized to allowed characters (no '@').
USERNAME="$(printf '%s' "${EMAIL%@*}" | tr -cd 'a-zA-Z0-9._-')"

echo "Pool:     $USER_POOL_ID"
echo "Username: $USERNAME"
echo "Email:    $EMAIL"
echo ""

# --- Create the user (idempotent: ignore if it already exists) ---
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" --region "$REGION" \
  --username "$USERNAME" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS 2>/dev/null \
  && echo "Created user $USERNAME" \
  || echo "User $USERNAME already exists — continuing to (re)set password."

# --- Set a permanent password (no forced change on first login) ---
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" --region "$REGION" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent
echo "Password set (permanent)."

# --- Optional: add to a group (create the group if it doesn't exist) ---
if [ -n "$GROUP" ]; then
  aws cognito-idp get-group --user-pool-id "$USER_POOL_ID" --region "$REGION" --group-name "$GROUP" >/dev/null 2>&1 \
    || aws cognito-idp create-group --user-pool-id "$USER_POOL_ID" --region "$REGION" --group-name "$GROUP"
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --username "$USERNAME" --group-name "$GROUP"
  echo "Added $USERNAME to group '$GROUP'."
fi

echo ""
echo "Done. Log in with username '$USERNAME' or email '$EMAIL'."
