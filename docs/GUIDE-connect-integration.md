# Amazon Connect Integration Guide

## Overview

Connect Amazon Connect to the Voice Agent POC so callers routed by Connect can interact with the Nova Sonic AI agent. Since Connect doesn't support bidirectional audio streaming to external endpoints, we use Amazon Chime SDK SIP Media Application as a bridge.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Amazon Connect                                   │
│                                                                             │
│  Customer Call → IVR/Queue → Contact Flow → "Transfer to phone number"      │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ Dials Chime SIP number
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Chime SDK SIP Media Application                           │
│                                                                             │
│  Lambda handler → returns CallAndBridge action → Voice Connector             │
│  (bridges the Connect call leg to an outbound SIP INVITE)                   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ SIP INVITE (G.711 μ-law)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SIP Relay Server (EKS)                                    │
│                                                                             │
│  NLB → drachtio (SIP) → bridge (Node.js) → AgentCore (Nova Sonic)          │
│  (Same infrastructure as Twilio SIP — no code changes needed)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Amazon Connect instance with admin access
- SIP relay server deployed (see [`telephony/sip/README.md`](../telephony/sip/README.md)) with NLB IP available
- AWS CLI configured with permissions for Chime SDK Voice, Lambda, and Connect
- A phone number in Connect (for inbound calls) OR a phone number in Chime (for the SIP bridge leg)

## Setup

### Step 1: Create a Chime SDK Voice Connector

The Voice Connector handles outbound SIP to your relay server.

```bash
# Create the voice connector
VC_ID=$(aws chime-sdk-voice create-voice-connector \
  --name "voice-agent-connect-bridge" \
  --no-require-encryption \
  --aws-region us-east-1 \
  --query "VoiceConnector.VoiceConnectorId" --output text)

echo "Voice Connector ID: $VC_ID"

# Configure origination — point to your SIP relay NLB IP
NLB_IP="203.0.113.10"  # Replace with your NLB IP from the SIP deployment output

aws chime-sdk-voice put-voice-connector-origination \
  --voice-connector-id $VC_ID \
  --origination '{
    "Routes": [{
      "Host": "'$NLB_IP'",
      "Port": 5060,
      "Protocol": "UDP",
      "Priority": 1,
      "Weight": 1
    }],
    "Disabled": false
  }'
```

### Step 2: Create the SIP Media Application Lambda

The Lambda handler is at `telephony/sip/chime-sma/sip_handler.py`. Deploy it:

```bash
# Package and create the Lambda
cd telephony/sip/chime-sma
zip -j /tmp/sip_handler.zip sip_handler.py

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Create Lambda execution role
aws iam create-role \
  --role-name voice-agent-sip-handler-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy \
  --role-name voice-agent-sip-handler-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

sleep 10

# Create the Lambda function
aws lambda create-function \
  --function-name voice-agent-connect-sip-handler \
  --runtime python3.12 \
  --handler sip_handler.handler \
  --role "arn:aws:iam::${ACCOUNT}:role/voice-agent-sip-handler-role" \
  --zip-file fileb:///tmp/sip_handler.zip \
  --environment "Variables={VOICE_CONNECTOR_ARN=arn:aws:chime:us-east-1:${ACCOUNT}:vc/${VC_ID}}" \
  --timeout 10

# Grant Chime permission to invoke
aws lambda add-permission \
  --function-name voice-agent-connect-sip-handler \
  --statement-id chime-invoke \
  --action lambda:InvokeFunction \
  --principal voiceconnector.chime.amazonaws.com
```

### Step 3: Create the SIP Media Application

```bash
SMA_ID=$(aws chime-sdk-voice create-sip-media-application \
  --aws-region us-east-1 \
  --name "voice-agent-connect-bridge" \
  --endpoints "LambdaArn=arn:aws:lambda:us-east-1:${ACCOUNT}:function:voice-agent-connect-sip-handler" \
  --query "SipMediaApplication.SipMediaApplicationId" --output text)

echo "SIP Media Application ID: $SMA_ID"
```

### Step 4: Create a SIP Rule (assign a phone number)

You need a phone number that Connect will dial to reach the SIP Media Application.

**Note:** For the Connect integration, you may not need a separate Chime phone number — Connect transfers internally to the SMA. A phone number is only needed if you want direct inbound dialing to Chime.

```bash
# Search for available numbers (try different states/types if none available)
PHONE=$(aws chime-sdk-voice search-available-phone-numbers \
  --phone-number-type "Local" \
  --state "VA" \
  --max-results 1 \
  --query "E164PhoneNumbers[0]" --output text)

# If Local returns None, try TollFree:
# PHONE=$(aws chime-sdk-voice search-available-phone-numbers \
#   --phone-number-type "TollFree" \
#   --max-results 1 \
#   --query "E164PhoneNumbers[0]" --output text)

echo "Found number: $PHONE"

# Order the phone number
aws chime-sdk-voice create-phone-number-order \
  --product-type "SipMediaApplicationDialIn" \
  --e164-phone-numbers "$PHONE"

# Create the SIP rule
aws chime-sdk-voice create-sip-rule \
  --name "connect-to-voice-agent" \
  --trigger-type "ToPhoneNumber" \
  --trigger-value "$PHONE" \
  --target-applications "SipMediaApplicationId=${SMA_ID},Priority=1,AwsRegion=us-east-1"

echo "Chime SIP number: $PHONE"
```

### Step 5: Configure Amazon Connect Contact Flow

1. Open **Amazon Connect** → **Routing** → **Contact Flows**
2. Create or edit a flow
3. Add a **Transfer to phone number** block:
   - Phone number: the Chime SIP number from Step 4
   - Country: US (+1)
4. Connect this block to the appropriate point in your IVR flow (e.g., after queue timeout, after "Press 1 for AI agent")

```
[Start] → [Play prompt: "Connecting you to our AI assistant..."]
       → [Transfer to phone number: +1XXXXXXXXXX (Chime)]
       → [Disconnect]
```

### Step 6: Test

1. Call your Connect phone number
2. Navigate the IVR to reach the transfer block
3. You should hear ringback while Chime bridges to your SIP relay
4. The AI agent greets you and the conversation begins

## Passing Context from Connect to the Agent

Connect contact attributes can be passed to the agent via custom SIP headers:

**In the Lambda handler:**
```python
"SipHeaders": {
    "X-Source": "amazon-connect",
    "X-Customer-ID": contact_attributes.get("CustomerID", ""),
    "X-Queue-Name": contact_attributes.get("QueueName", ""),
    "X-Reason": contact_attributes.get("ContactReason", "")
}
```

**In the SIP bridge (index.js):**
```javascript
srf.invite(async (req, res) => {
  const customerId = req.get('X-Customer-ID') || '';
  const queueName = req.get('X-Queue-Name') || '';
  // Use in system prompt or agent config lookup
});
```

## Transfer Back to Connect

When the AI agent determines it needs to escalate to a human:

1. Agent signals transfer intent (via tool call or keyword detection)
2. Bridge sends SIP BYE to end the Chime leg
3. Chime reports HANGUP to Connect
4. Connect Contact Flow continues to the next block (e.g., transfer to agent queue)

For seamless transfer, design the Connect flow with a "Check contact attributes" block after the transfer — if the AI set an attribute like "transfer_reason", route accordingly.

## Cost Estimate

| Component | Cost |
|-----------|------|
| Connect (per minute) | ~$0.018/min |
| Chime SDK SIP (per minute) | ~$0.004/min |
| SIP relay (EKS t3.medium) | ~$30/month |
| AgentCore + Nova Sonic | Per-session |
| **Total per call** | **~$0.03/min + agent cost** |

No PSTN charges between Connect and the agent (stays within AWS network).

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Transfer fails in Connect | Chime SIP number not correct | Verify SIP rule + phone number |
| Chime Lambda not triggered | Permission issue | Check Lambda resource policy |
| SIP INVITE doesn't reach relay | Voice Connector origination wrong | Verify NLB IP in origination routes |
| Call connects but no audio | NLB target unhealthy | Re-register EKS node + open port 3000 |
| Agent doesn't respond | AgentCore cold start | Call again — second call will be warm |

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Chime SDK SIP (recommended)** | All AWS, no PSTN hop, low latency | Requires Chime setup |
| Transfer to Twilio number | Simple, works today | Extra PSTN hop, latency, cost |
| Connect + Lex bot wrapper | Native integration | Can't use custom BidiAgent |
| Connect KVS media streams | Direct audio access | One-directional only (no playback) |
