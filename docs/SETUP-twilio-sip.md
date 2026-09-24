# Twilio SIP Trunk Setup

Connect the Voice Agent SIP relay server to Twilio Elastic SIP Trunking for inbound phone calls.

## Prerequisites

- SIP relay server deployed (see [`telephony/sip/README.md`](../telephony/sip/README.md))
- Twilio account with Elastic SIP Trunking enabled
- NLB IP from deployment output (e.g., `203.0.113.10`)

## Console UI Setup

1. Go to [Twilio Console](https://console.twilio.com) → **Elastic SIP Trunking** → **Trunks**
2. Click **Create new SIP Trunk**
3. Give it a name (e.g., "Voice Agent SIP")
4. Go to **Origination** tab → **Add new Origination URI**:
   - URI: `sip:<NLB_IP>:5060;transport=udp` (e.g., `sip:203.0.113.10:5060;transport=udp`)
   - Priority: 10, Weight: 10
5. Go to **Phone Numbers** tab → **Add a Phone Number**
   - Select or buy a phone number to assign to this trunk
6. Save

## CLI Setup

```bash
# Get your NLB IP (use the NLB DNS name from your SIP deployment output)
NLB_DNS="<your-sip-nlb-dns-name>"
NLB_IP=$(nslookup $NLB_DNS | grep "Address:" | tail -1 | awk '{print $2}')
echo "SIP Endpoint: sip:${NLB_IP}:5060;transport=udp"

# Twilio CLI (if installed)
twilio api:trunking:v1:trunks:create --friendly-name "Voice Agent SIP"
twilio api:trunking:v1:trunks:origination-urls:create \
  --trunk-sid TKXXXXXXXX \
  --sip-url "sip:${NLB_IP}:5060;transport=udp" \
  --weight 10 --priority 10 --enabled
```

## Verification

1. Call the Twilio phone number assigned to the trunk
2. You should hear ringback while AgentCore warms up (~3-5 seconds)
3. The AI agent greets you and conversation begins

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Customer unavailable" after long silence | NLB target unhealthy | Register node in target group, open TCP 3000 |
| Call connects but no audio | SDP IP mismatch | Check bridge resolves correct NLB IP |
| Call drops after 32s | ACK timeout (old issue, fixed) | Ensure Contact header has public IP |
| Choppy audio | Port collision from back-to-back calls | Wait a few seconds between calls |

## Architecture

```
Phone → Twilio PSTN → Elastic SIP Trunk → SIP INVITE (UDP 5060)
    → NLB → EKS Node (drachtio) → Bridge (Node.js) → AgentCore (Nova Sonic)
```
