"""
Lambda handler for Generate Agent Configuration API.

Calls Amazon Bedrock (Claude) to generate a complete voice agent configuration
from a natural language use case description.

Handles:
  POST /generate-agent  — Generate config from description
"""

import json
import os

import boto3

BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", os.environ.get("AWS_REGION", "us-east-1"))

bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}

SYSTEM_PROMPT = """You are an expert at designing conversational AI voice agents. Given a user's description of their use case, generate a complete agent configuration as a JSON object.

You must respond with ONLY a valid JSON object (no markdown, no explanation) matching this exact schema:

{
  "host": "agentcore",
  "framework": "strands-bidiagent",
  "model": ["nova-2-sonic"],
  "pipeline": "speech-to-speech",
  "tools": [],
  "voice": {
    "voiceId": "",
    "language": "en-US",
    "gender": ""
  },
  "prompt": {
    "greeting": "",
    "instructions": ""
  }
}

Rules:
- host: always "agentcore"
- framework: always "strands-bidiagent"
- model: always ["nova-2-sonic"]
- pipeline: always "speech-to-speech"
- tools: choose from ["knowledge-base", "crm", "calendar", "notification", "transfer", "payment", "order-status", "custom"]. Pick the ones most relevant to the use case.
- voice.voiceId: pick from ["tiffany", "matthew", "amy", "gregory"]. Choose one that fits the persona.
- voice.language: use "en-US" unless the description specifies another language
- voice.gender: "female" for tiffany/amy, "male" for matthew/gregory
- prompt.greeting: a natural opening greeting the agent will say when answering (1-2 sentences)
- prompt.instructions: the FULL system prompt for the agent. This should be comprehensive and include:
  - Agent identity and role
  - Conversation flow (step by step how the agent should handle calls)
  - Tool usage instructions (when to use each tool)
  - Guardrails and restrictions (what the agent should never do)
  - Escalation rules (when to transfer to human)
  - Example interactions showing ideal behavior
  Write this as a complete, production-ready system prompt (minimum 10-15 sentences). Use natural conversational language suitable for voice (no bullet points or markdown).
"""


def handler(event, context):
    """Main Lambda entry point."""
    http_method = event.get("httpMethod", "")

    if http_method == "OPTIONS":
        return response(200, {})

    if http_method != "POST":
        return response(405, {"error": "Method not allowed"})

    try:
        body = json.loads(event.get("body") or "{}")
        description = body.get("description", "").strip()

        if not description:
            return response(400, {"error": "description is required"})

        if len(description) > 5000:
            return response(400, {"error": "description must be under 5000 characters"})

        # Call Bedrock
        config = call_bedrock(description)
        return response(200, config)

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": f"Generation failed: {str(e)}"})


def call_bedrock(description: str) -> dict:
    """Call Amazon Bedrock Claude to generate agent configuration."""
    messages = [
        {
            "role": "user",
            "content": f"Generate a voice agent configuration for the following use case:\n\n{description}",
        }
    ]

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2000,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "temperature": 0.7,
    }

    bedrock_response = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(request_body),
    )

    response_body = json.loads(bedrock_response["body"].read())
    content = response_body["content"][0]["text"]

    # Parse the JSON response from Claude
    # Strip any markdown code fences if present
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1]  # remove first line
        content = content.rsplit("```", 1)[0]  # remove last fence
        content = content.strip()

    config = json.loads(content)
    return config


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
