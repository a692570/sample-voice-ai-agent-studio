"""
Lambda handler for Generate System Prompt API.

Takes workflow steps (nodes, edges, tools) from the conversation flow canvas
and uses Amazon Bedrock (Claude) to compose a well-structured, production-quality
system prompt with example interaction flows.

Handles:
  POST /generate-prompt  — Generate formatted system prompt from workflow data
"""

import json
import os

import boto3

BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"
)
BEDROCK_REGION = os.environ.get(
    "BEDROCK_REGION", os.environ.get("AWS_REGION", "us-east-1")
)

bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}

SYSTEM_PROMPT = """You are an expert prompt engineer specializing in conversational AI voice agents. Your job is to take a structured conversation flow (defined as steps with instructions, tools, and transitions) and produce a polished, production-ready system prompt.

The output system prompt should follow this structure:

1. **Role & Identity** — A clear opening sentence defining who the agent is (e.g., "You are a helpful customer service assistant for [Business].")
2. **Numbered Conversation Flow** — Each step becomes a numbered section with:
   - A descriptive heading
   - Clear behavioral instructions in natural language
   - Tool references formatted as [tool_name] when the step uses tools
   - Conditional logic expressed as plain-English rules
3. **Important Notices / Guardrails** — Any boundaries the agent must respect
4. **Example Interaction Flows** — 2-3 realistic multi-turn example dialogues that demonstrate the flow in action, including tool calls where appropriate

Rules:
- Write the prompt in second person ("You are...", "You should...")
- Use natural, conversational language — not bullet-point-heavy robotic instructions
- Integrate tool usage naturally into the flow (e.g., "call [tool_name] to retrieve...")
- Include realistic example conversations that show the complete happy path
- Reference the user's name naturally once obtained (show personalization)
- Keep the voice warm and professional unless otherwise indicated
- Preserve all conditional branching from the workflow
- Do NOT include meta-commentary or explanations — output ONLY the system prompt text
- The output should be a single continuous system prompt ready to paste directly into an agent config

Respond with ONLY the formatted system prompt text. No JSON wrapping, no markdown code fences, no explanations."""


def handler(event, context):
    """Main Lambda entry point."""
    http_method = event.get("httpMethod", "")

    if http_method == "OPTIONS":
        return response(200, {})

    if http_method != "POST":
        return response(405, {"error": "Method not allowed"})

    try:
        body = json.loads(event.get("body") or "{}")
        workflow = body.get("workflow")

        if not workflow:
            return response(400, {"error": "workflow is required"})

        nodes = workflow.get("nodes", [])
        edges = workflow.get("edges", [])
        tools = body.get("tools", [])
        context_info = body.get("context", {})

        if not nodes or len(nodes) < 1:
            return response(400, {"error": "workflow must contain at least one step node"})

        # Build a human-readable workflow description for the LLM
        workflow_description = build_workflow_description(nodes, edges, tools, context_info)

        # Call Bedrock to generate formatted prompt
        generated_prompt = call_bedrock(workflow_description)

        return response(200, {
            "systemPrompt": generated_prompt,
            "tools": tools,
        })

    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": f"Prompt generation failed: {str(e)}"})


def build_workflow_description(nodes, edges, tools, context_info):
    """Convert workflow nodes/edges into a structured description for the LLM."""
    # Build adjacency map
    adjacency = {}
    for edge in edges:
        source = edge.get("source", "")
        target = edge.get("target", "")
        label = edge.get("label", "")
        if source not in adjacency:
            adjacency[source] = []
        adjacency[source].append({"target": target, "label": label})

    lines = []

    # Add context if provided
    if context_info:
        if context_info.get("businessName"):
            lines.append(f"Business Name: {context_info['businessName']}")
        if context_info.get("agentRole"):
            lines.append(f"Agent Role: {context_info['agentRole']}")
        if context_info.get("personality"):
            lines.append(f"Personality/Tone: {context_info['personality']}")
        if lines:
            lines.append("")

    lines.append("CONVERSATION FLOW STEPS:")
    lines.append("")

    # Process step nodes in order
    step_nodes = [n for n in nodes if n.get("type") not in ("start", "end")]
    node_map = {n.get("id", ""): n for n in nodes}

    for i, node in enumerate(step_nodes, 1):
        data = node.get("data", {})
        name = data.get("name", f"Step {i}")
        instructions = data.get("instructions", "")
        step_tools = data.get("tools", [])

        lines.append(f"Step {i}: {name}")
        if instructions:
            lines.append(f"  Instructions: {instructions}")
        if step_tools:
            lines.append(f"  Tools to use: {', '.join(step_tools)}")

        # Transitions
        node_id = node.get("id", "")
        outgoing = adjacency.get(node_id, [])
        if outgoing:
            for out in outgoing:
                target_node = node_map.get(out["target"])
                if target_node:
                    target_name = "End conversation" if target_node.get("type") == "end" else target_node.get("data", {}).get("name", "next")
                    if out["label"]:
                        lines.append(f"  Transition: If {out['label']} → {target_name}")
                    else:
                        lines.append(f"  Transition: → {target_name}")
        lines.append("")

    if tools:
        lines.append(f"AVAILABLE TOOLS: {', '.join(tools)}")

    return "\n".join(lines)


def call_bedrock(workflow_description):
    """Call Amazon Bedrock Claude to generate a formatted system prompt."""
    messages = [
        {
            "role": "user",
            "content": (
                "Generate a production-ready system prompt for a voice agent based on "
                "this conversation flow:\n\n"
                f"{workflow_description}\n\n"
                "Remember: output ONLY the system prompt text, ready to use as-is."
            ),
        }
    ]

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4000,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "temperature": 0.6,
    }

    bedrock_response = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(request_body),
    )

    response_body = json.loads(bedrock_response["body"].read())
    content = response_body["content"][0]["text"]

    # Strip any accidental markdown fences
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
        content = content.rsplit("```", 1)[0]
        content = content.strip()

    return content


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
