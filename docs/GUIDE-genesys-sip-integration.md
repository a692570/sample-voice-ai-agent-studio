# Genesys Cloud SIP Integration Guide

## Overview

This guide covers connecting Genesys Cloud CX to the Voice Agent POC via SIP. The same drachtio + bridge infrastructure used for Twilio SIP trunking works for Genesys with minimal configuration changes.

## Prerequisites

- Genesys Cloud org with admin access
- BYOC (Bring Your Own Carrier) Trunk license or External Trunk capability
- Voice Agent SIP relay deployed (see [`telephony/sip/README.md`](../telephony/sip/README.md))
- SIP endpoint IP: your EKS node public IP (e.g., `203.0.113.10`)

## Genesys Cloud Configuration

### Step 1: Create an External Trunk

1. Go to **Admin → Telephony → Trunks → External**
2. Click **Create New**
3. Configure:
   - **Name**: `Voice AI Agent`
   - **Trunk Type**: External (SIP)
   - **Protocol**: SIP
   - **SIP Servers**: Add `sip:<YOUR_NODE_IP>:5060;transport=udp`
   - **Outbound Codec**: G.711 μ-law (PCMU) — must be selected
   - **DTMF Mode**: RFC 2833

### Step 2: Create an Outbound Route

1. Go to **Admin → Telephony → Outbound Routes**
2. Create a route that uses the external trunk
3. Pattern: match the SIP URI or number pattern you want to route to the agent

### Step 3: Create an Architect Flow

1. Go to **Admin → Architect → Inbound Call Flows**
2. Create a flow that transfers to the external trunk:
   - Add a **Transfer to Number** action
   - Set SIP URI: `sip:agent@<YOUR_NODE_IP>:5060`
   - Or use a **Bridge** action pointing to the external trunk

### Step 4: Assign a Queue

1. Create or select a queue
2. Set the queue's routing to use the Architect flow
3. Assign a DID number to the queue

### Step 5: Security Group (AWS Side)

Whitelist Genesys Cloud SIP IPs in the EKS security group. Genesys Cloud uses regional SIP IPs:

| Region | SIP IPs |
|--------|---------|
| US East | Check Genesys docs for current IPs |
| US West | Check Genesys docs for current IPs |

Reference: [Genesys Cloud Firewall Requirements](https://help.mypurecloud.com/articles/ports-and-ip-addresses/)

For POC testing, the current security group allows all IPs on UDP 5060 and 20000-20100.

## What Works Without Changes

- **SIP signaling**: Genesys sends standard SIP INVITE — drachtio handles it identically to Twilio
- **G.711 μ-law audio**: If Genesys is configured to offer PCMU, audio flows directly
- **Call setup/teardown**: BYE handling is standard SIP

## Potential Changes Required

### 1. Codec Negotiation (if G.711 not available)

**Symptom**: Call connects but no audio, or Genesys rejects with "488 Not Acceptable Here"

**Cause**: Genesys may be configured to require G.729, Opus, or G.722 only

**Fix options**:
- **Option A (preferred for POC)**: Configure Genesys trunk to prefer/allow G.711 μ-law
- **Option B**: Re-enable rtpengine for transcoding:

```javascript
// In bridge index.js — use rtpengine offer/answer to handle codec conversion
// rtpengine will transcode G.729 → PCMU automatically
const rtpOffer = await rtpEngine.offer(RTPENGINE_PORT, RTPENGINE_HOST, {
  'call-id': callId,
  'sdp': sdp,
  'from-tag': fromTag,
  'transcode': ['PCMU'],  // Force transcode to PCMU
});
```

### 2. SRTP (Encrypted Media)

**Symptom**: Call connects, SDP accepted, but no audio arrives (packets are encrypted)

**Cause**: Genesys may require SRTP (secure RTP) for media encryption

**Fix options**:
- **Option A (POC)**: Disable SRTP requirement in Genesys trunk settings
- **Option B**: Re-enable rtpengine with SRTP support:

```javascript
// rtpengine can decrypt SRTP to plain RTP for us
const rtpOffer = await rtpEngine.offer(RTPENGINE_PORT, RTPENGINE_HOST, {
  'call-id': callId,
  'sdp': sdp,
  'from-tag': fromTag,
  'SDES': 'off',  // Strip SRTP from our side
});
```

### 3. SIP over TLS (SIPS)

**Symptom**: Genesys cannot reach the SIP endpoint

**Cause**: Genesys may require TLS for SIP signaling (port 5061)

**Fix**:
- Add TLS certificate to drachtio configuration
- Update the DaemonSet to include cert volume mount
- Open port 5061/TCP in security group

```
# drachtio args with TLS
--contact "sips:*:5061;transport=tls"
--tls-cert-file /certs/tls.crt
--tls-key-file /certs/tls.key
```

### 4. Custom SIP Headers (Context Passing)

Genesys can pass context via custom SIP headers. The bridge can read these:

```javascript
srf.invite(async (req, res) => {
  // Read Genesys custom headers
  const customerId = req.get('X-Customer-ID') || '';
  const queueName = req.get('X-Queue-Name') || '';
  const callReason = req.get('X-Call-Reason') || '';
  
  // Pass to agent as context
  const systemPrompt = `Customer ID: ${customerId}. Reason: ${callReason}. ${basePrompt}`;
});
```

### 5. Call Transfer Back (SIP REFER)

To transfer the call back to a Genesys queue/agent:

```javascript
// When agent decides to transfer
dialog.request({
  method: 'REFER',
  headers: {
    'Refer-To': 'sip:billing_queue@genesys.example.com',
    'Referred-By': `sip:agent@${publicIp}`,
  },
});
```

This requires the bridge to handle the agent's transfer intent and send a SIP REFER.

## Architecture Comparison

| Aspect | Current (Twilio POC) | Genesys Production |
|--------|---------------------|-------------------|
| SIP Transport | UDP | UDP or TLS |
| Media Codec | PCMU only | PCMU (configure on trunk) |
| Media Encryption | None (RTP) | SRTP (may need rtpengine) |
| NAT Traversal | Direct public IP | Direct or rtpengine |
| Context Passing | Not used | Custom SIP headers |
| Transfer | Not implemented | SIP REFER |
| Auth | IP ACL (security group) | IP ACL + optional digest |

## Testing Checklist

1. [ ] Genesys trunk created with PCMU codec
2. [ ] Architect flow routes to external trunk
3. [ ] Security group allows Genesys SIP IPs
4. [ ] Call reaches drachtio (check bridge logs)
5. [ ] SDP negotiation succeeds (200 OK sent)
6. [ ] RTP audio flows (check for "First RTP packet received" in logs)
7. [ ] Agent responds with audio
8. [ ] Call teardown clean (BYE handled)

## Estimated Effort

| Task | Time |
|------|------|
| Genesys trunk + flow setup | 1-2 hours |
| Security group update | 10 min |
| Testing basic call | 30 min |
| Add SRTP support (if needed) | 2-4 hours |
| Add SIP REFER transfer | 4-6 hours |
| Add custom header context | 1 hour |
