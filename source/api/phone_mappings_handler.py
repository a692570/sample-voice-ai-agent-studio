"""
Lambda handler for Phone Mappings API.

Maps Twilio phone numbers to demo configurations. When a call comes in,
the TAC bridge uses this mapping to load the correct voice/prompt/tools config.

Handles:
  GET    /phone-mappings              — List all mappings
  GET    /phone-mappings/{phone}      — Get mapping for a phone number
  PUT    /phone-mappings/{phone}      — Create/update a mapping
  DELETE /phone-mappings/{phone}      — Delete a mapping
"""

import json
import os
from datetime import datetime, timezone
from urllib.parse import unquote

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

# Secret names that hold the telephony bridge configuration (written by the
# telephony/{pstn,sip}/configure.sh scripts). Used only to report whether each
# provider has been configured — the secret VALUES are never read or returned.
PSTN_SECRET_NAME = os.environ.get("PSTN_CONFIG_SECRET_NAME", "voice-agent-poc/pstn")
SIP_SECRET_NAME = os.environ.get("SIP_CONFIG_SECRET_NAME", "voice-agent-poc/sip")
secretsmanager = boto3.client("secretsmanager")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
}


def handler(event, context):
    """Main Lambda entry point."""
    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}

    try:
        if http_method == "GET" and path.endswith("/status"):
            return config_status()
        elif http_method == "GET" and path == "/phone-mappings":
            return list_mappings()
        elif http_method == "GET" and "phone" in path_params:
            return get_mapping(path_params["phone"])
        elif http_method == "PUT" and "phone" in path_params:
            body = json.loads(event.get("body") or "{}")
            return put_mapping(path_params["phone"], body)
        elif http_method == "DELETE" and "phone" in path_params:
            return delete_mapping(path_params["phone"])
        else:
            return response(404, {"error": "Not found"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def normalize_phone(phone: str) -> str:
    """Normalize phone number to E.164 format.

    The value arrives from an API Gateway path parameter and may still be
    percent-encoded (e.g. a leading "+" as "%2B"), so decode it first —
    otherwise the "+" check below would prepend another "+" and corrupt the
    key (e.g. "+%2B15551234567").
    """
    decoded = unquote(phone)
    cleaned = decoded.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not cleaned.startswith("+"):
        cleaned = f"+{cleaned}"
    return cleaned


def _secret_exists(secret_name: str) -> bool:
    """Return True if the named secret exists. Reports existence only — never
    fetches or returns the secret value."""
    try:
        secretsmanager.describe_secret(SecretId=secret_name)
        return True
    except secretsmanager.exceptions.ResourceNotFoundException:
        return False
    except Exception as e:
        # On any other error (e.g. missing permission), report not-configured
        # rather than failing the whole request.
        print(f"describe_secret({secret_name}) error: {e}")
        return False


def config_status():
    """Report whether each telephony provider has been configured.

    A provider is 'configured' when its bridge config secret exists in Secrets
    Manager (created by telephony/{pstn,sip}/configure.sh). The UI uses this to
    block mapping a number to a provider that has not been set up yet.
    """
    return response(200, {
        "pstn": _secret_exists(PSTN_SECRET_NAME),
        "sip": _secret_exists(SIP_SECRET_NAME),
    })


def list_mappings():
    """List all phone number mappings."""
    result = table.scan()
    items = result.get("Items", [])
    items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    return response(200, items)


def get_mapping(phone: str):
    """Get mapping for a specific phone number."""
    normalized = normalize_phone(phone)
    result = table.get_item(Key={"phoneNumber": normalized})
    item = result.get("Item")
    if not item:
        return response(404, {"error": "Mapping not found"})
    return response(200, item)


def put_mapping(phone: str, body: dict):
    """Create or update a phone number mapping."""
    normalized = normalize_phone(phone)
    now = datetime.now(timezone.utc).isoformat()

    # provider distinguishes how the number is delivered: "pstn" (Twilio PSTN
    # relay) or "sip" (SIP trunk / Chime SDK). Free-form string, defaults to "pstn".
    item = {
        "phoneNumber": normalized,
        "demoId": body.get("demoId", ""),
        "demoName": body.get("demoName", ""),
        "provider": body.get("provider", "pstn"),
        "label": body.get("label", ""),
        "config": body.get("config", {}),
        "updatedAt": now,
    }
    table.put_item(Item=item)
    return response(200, item)


def delete_mapping(phone: str):
    """Delete a phone number mapping."""
    normalized = normalize_phone(phone)
    table.delete_item(Key={"phoneNumber": normalized})
    return response(200, {"message": "Deleted", "phoneNumber": normalized})


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
