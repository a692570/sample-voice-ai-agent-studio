"""
Chime SDK SIP Media Application Lambda Handler

Bridges incoming calls (from Amazon Connect or direct dial) to the
Voice Agent SIP relay server via a Chime Voice Connector.

Environment variables:
  VOICE_CONNECTOR_ARN — ARN of the Chime Voice Connector configured
                        with origination pointing to the SIP relay NLB IP.
"""

import json
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

VOICE_CONNECTOR_ARN = os.environ.get("VOICE_CONNECTOR_ARN", "")
SIP_URI = os.environ.get("SIP_URI", "+10000000000")


def handler(event, context):
    """Handle Chime SIP Media Application events."""

    invocation_event = event.get("InvocationEventType", "")
    call_details = event.get("CallDetails", {})
    participants = call_details.get("Participants", [])

    logger.info(f"Event: {invocation_event}, Participants: {len(participants)}")

    if invocation_event == "NEW_INBOUND_CALL":
        # Bridge the call to the SIP relay via Voice Connector
        caller = participants[0]["From"] if participants else "+10000000000"
        called = participants[0]["To"] if participants else "+10000000000"

        logger.info(f"Bridging call from {caller} to SIP URI: {SIP_URI}")

        return {
            "SchemaVersion": "1.0",
            "Actions": [{
                "Type": "CallAndBridge",
                "Parameters": {
                    "CallTimeoutSeconds": 30,
                    "CallerIdNumber": caller,
                    "Endpoints": [{
                        "BridgeEndpointType": "AWS",
                        "Arn": VOICE_CONNECTOR_ARN,
                        "Uri": SIP_URI
                    }],
                    "SipHeaders": {
                        "X-Source": "amazon-connect",
                        "X-Original-Called": called,
                        "X-Caller": caller
                    }
                }
            }]
        }

    elif invocation_event == "ACTION_SUCCESSFUL":
        logger.info("Call bridged successfully")
        return {"SchemaVersion": "1.0", "Actions": []}

    elif invocation_event == "ACTION_FAILED":
        logger.error(f"Action failed: {json.dumps(event.get('ActionData', {}))}")
        return {"SchemaVersion": "1.0", "Actions": []}

    elif invocation_event == "HANGUP":
        logger.info("Call ended")
        return {"SchemaVersion": "1.0", "Actions": []}

    # Default
    return {"SchemaVersion": "1.0", "Actions": []}
