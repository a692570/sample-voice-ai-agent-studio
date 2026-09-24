# Amazon Chime SDK SIP Setup

Connect the Voice Agent SIP relay server to Amazon Chime SDK Voice Connector for inbound phone calls. This is the recommended path for Amazon Connect integration (all AWS, no PSTN hop).

## Prerequisites

- SIP relay server deployed (see [`telephony/sip/README.md`](../telephony/sip/README.md))
- NLB IP from deployment output (e.g., `203.0.113.10`)
- AWS CLI configured with Chime SDK Voice permissions

## Console UI Setup

### 1. Create Voice Connector

1. Go to **AWS Console** → **Amazon Chime SDK** → **Voice connectors**
2. Click **Create voice connector**
   - Name: `voice-agent-sip`
   - Require encryption: **No** (for POC)
3. After creation, go to the **Origination** tab → **Edit**
   - Add route:
     - Host: `203.0.113.10` (your NLB IP)
     - Port: `5060`
     - Protocol: `UDP`
     - Priority: 1
     - Weight: 1
   - Enable origination

### 2. Create Lambda Function

1. Go to **AWS Console** → **Lambda** → **Create function**
   - Name: `voice-agent-connect-sip-handler`
   - Runtime: Python 3.12
   - Upload code from `telephony/sip/chime-sma/sip_handler.py`
2. Under **Configuration** → **Environment variables**, add:
   - `VOICE_CONNECTOR_ARN`: `arn:aws:chime:us-east-1:<ACCOUNT>:vc/<VC_ID>`
   - `SIP_URI`: `+15551234567` (the destination number for the Voice Connector)
3. Under **Configuration** → **Permissions**, add a resource-based policy:
   - Principal: `voiceconnector.chime.amazonaws.com`
   - Action: `lambda:InvokeFunction`

### 3. Create SIP Media Application

1. Go to **Amazon Chime SDK** → **SIP media applications** → **Create**
   - Name: `voice-agent-connect-bridge`
   - Lambda function ARN: the Lambda from step 2
2. Note the SMA ID

### 4. Order a Phone Number

1. Go to **Amazon Chime SDK** → **Phone number management** → **Orders** → **Provision phone numbers**
   - Type: SIP Media Application Dial-In
   - Search by area code (e.g., 571 for Virginia)
   - Order a number

### 5. Create SIP Rule

1. Go to **Amazon Chime SDK** → **SIP rules** → **Create**
   - Name: `connect-to-voice-agent`
   - Trigger type: To phone number
   - Phone number: select the number from step 4
   - Target application: the SMA from step 3

## CLI Setup

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
NLB_IP="203.0.113.10"  # Your SIP relay NLB IP

# 1. Create Voice Connector
VC_ID=$(aws chime-sdk-voice create-voice-connector \
  --name "voice-agent-sip" \
  --no-require-encryption \
  --aws-region us-east-1 \
  --query "VoiceConnector.VoiceConnectorId" --output text)

echo "Voice Connector ID: $VC_ID"

# 2. Configure origination
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

# 3. Create Lambda execution role + function
aws iam create-role \
  --role-name voice-agent-sip-handler-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy \
  --role-name voice-agent-sip-handler-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

sleep 10

cd telephony/sip/chime-sma
zip -j /tmp/sip_handler.zip sip_handler.py

aws lambda create-function \
  --function-name voice-agent-connect-sip-handler \
  --runtime python3.12 \
  --handler sip_handler.handler \
  --role "arn:aws:iam::${ACCOUNT}:role/voice-agent-sip-handler-role" \
  --zip-file fileb:///tmp/sip_handler.zip \
  --environment "Variables={VOICE_CONNECTOR_ARN=arn:aws:chime:us-east-1:${ACCOUNT}:vc/${VC_ID},SIP_URI=+15551234567}" \
  --timeout 10

aws lambda add-permission \
  --function-name voice-agent-connect-sip-handler \
  --statement-id chime-invoke \
  --action lambda:InvokeFunction \
  --principal voiceconnector.chime.amazonaws.com

# 4. Create SIP Media Application
SMA_ID=$(aws chime-sdk-voice create-sip-media-application \
  --aws-region us-east-1 \
  --name "voice-agent-connect-bridge" \
  --endpoints "LambdaArn=arn:aws:lambda:us-east-1:${ACCOUNT}:function:voice-agent-connect-sip-handler" \
  --query "SipMediaApplication.SipMediaApplicationId" --output text)

echo "SMA ID: $SMA_ID"

# 5. Order a phone number
PHONE=$(aws chime-sdk-voice search-available-phone-numbers \
  --phone-number-type "Local" \
  --area-code "571" \
  --max-results 1 \
  --query "E164PhoneNumbers[0]" --output text)

aws chime-sdk-voice create-phone-number-order \
  --product-type "SipMediaApplicationDialIn" \
  --e164-phone-numbers "$PHONE"

echo "Phone number: $PHONE"

# 6. Create SIP Rule
sleep 10  # Wait for phone number provisioning

aws chime-sdk-voice create-sip-rule \
  --name "connect-to-voice-agent" \
  --trigger-type "ToPhoneNumber" \
  --trigger-value "$PHONE" \
  --target-applications "SipMediaApplicationId=${SMA_ID},Priority=1,AwsRegion=us-east-1"

echo "Done! Call $PHONE to reach the voice agent via Chime SDK"
```

## Verification

1. Call the Chime phone number
2. Chime triggers the Lambda → bridges to your SIP relay via Voice Connector
3. SIP relay answers and connects to AgentCore
4. AI agent greets you

## For Amazon Connect Integration

Use the same Chime phone number in a Connect Contact Flow:
1. Open **Amazon Connect** → **Contact Flows**
2. Add a **Transfer to phone number** block
3. Set the number to the Chime phone number from this setup
4. Connect transfers the call to the Chime SMA, which bridges to the SIP relay

See `docs/GUIDE-connect-integration.md` for detailed Connect flow setup.

## Architecture

```
Phone → Chime SDK PSTN → SIP Media Application (Lambda)
    → Voice Connector → SIP INVITE (UDP 5060)
    → NLB → EKS Node (drachtio) → Bridge (Node.js) → AgentCore (Nova Sonic)
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Immediate hangup | Lambda error | Check CloudWatch logs for the Lambda |
| "Invalid URI" error | SIP_URI format wrong | Use E.164 format: `+15551234567` |
| "Invalid Action Parameter" | Missing URI field | Ensure Lambda returns `Uri` in endpoint |
| Choppy audio | Back-to-back call port collision | Wait between calls (single concurrent) |
| No audio | NLB target unhealthy | Register node, open TCP 3000 in SG |
