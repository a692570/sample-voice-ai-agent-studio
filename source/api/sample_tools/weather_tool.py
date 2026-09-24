"""
Sample Lambda tool: Weather Query

Accepts a location parameter and returns current weather from wttr.in.
Deploy this Lambda to test the Lambda tool integration in the Tools management page.

Expected input:
  {"location": "seattle"}

Returns:
  {"location": "seattle", "weather": "Seattle: ☀️ +18°C", "source": "wttr.in"}
"""

import json
import urllib.request
import urllib.parse


def handler(event, context):
    """Lambda handler for weather queries."""
    # Parse input - accept both direct JSON and API Gateway event format
    if isinstance(event, str):
        event = json.loads(event)

    location = event.get("location", "seattle")

    try:
        # Call wttr.in for a short weather summary
        url = f"https://wttr.in/{urllib.parse.quote(location)}?format=3"
        req = urllib.request.Request(url, headers={"User-Agent": "curl/7.0"})

        with urllib.request.urlopen(req, timeout=10) as resp:
            weather_text = resp.read().decode().strip()

        return {
            "statusCode": 200,
            "body": json.dumps({
                "location": location,
                "weather": weather_text,
                "source": "wttr.in",
            })
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": str(e),
                "location": location,
            })
        }
