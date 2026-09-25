# Agent — Voice AI POC-in-a-Box

WebSocket voice agent server powered by Strands Agents BidiAgent. Receives configuration from the frontend UI (system prompt, voice, tools, model) and provides bidirectional audio streaming. Supports three speech-to-speech providers, selected per session: **Amazon Nova 2 Sonic** (default, no key), **OpenAI Realtime** (bring your own key), and **Google Gemini Live** (bring your own key). Provider selection happens in `create_model()`.

## Prerequisites

- Python 3.11+
- AWS credentials configured with Bedrock access (`aws configure` or SSO)
- Amazon Nova 2 Sonic model access enabled in your AWS account (us-east-1)

## Start on Local

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python strands_agent.py
```

The server starts at `ws://localhost:8081/ws`.

## Verify It's Running

```bash
curl http://localhost:8081/health
```

Expected response:

```json
{"status": "healthy", "model": "amazon.nova-2-sonic-v1:0", "region": "us-east-1"}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BEDROCK_REGION` | `us-east-1` | AWS region for Bedrock model calls |
| `MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Nova Sonic model ID |
| `OPENAI_REALTIME_MODEL_ID` | `gpt-realtime` | OpenAI Realtime model ID |
| `GEMINI_LIVE_MODEL_ID` | `gemini-2.5-flash-native-audio-preview-09-2025` | Gemini Live model ID |
| `OPENAI_API_KEY` | — | Fallback OpenAI key (per-session key from the UI takes precedence) |
| `GOOGLE_API_KEY` | — | Fallback Google key (per-session key from the UI takes precedence) |
| `PORT` | `8081` | Server port |

Example with custom region:

```bash
BEDROCK_REGION=us-west-2 python strands_agent.py
```

## WebSocket Protocol

The frontend connects and sends a `sessionConfig` JSON event as the first message:

```json
{
  "type": "sessionConfig",
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "host": "agentcore",
  "framework": "strands-bidiagent",
  "model": ["nova-2-sonic"],
  "systemPrompt": "You are a customer service agent for Acme Corp...",
  "tools": ["knowledge-base", "calendar", "crm"],
  "voice": {
    "voiceId": "tiffany",
    "language": "en-US",
    "gender": "female"
  },
  "pipeline": "speech-to-speech",
  "greeting": "Hello! How can I help you today?"
}
```

### Config Fields

| Field | Type | Options |
|-------|------|---------|
| `clientId` | string | UUID generated per session |
| `host` | string | `agentcore`, `eks`, `ecs` |
| `framework` | string | `strands-bidiagent`, `pipecat`, `livekit` |
| `model` | string[] | First entry selects the provider: `nova-2-sonic`, `openai-realtime`, or `gemini-live` |
| `systemPrompt` | string | Generated from prompt builder |
| `tools` | string[] | Tool IDs selected in the UI |
| `voice` | object | `voiceId`, `language`, `gender` |
| `pipeline` | string | `speech-to-speech`, `cascaded` |
| `greeting` | string | Agent greeting message |
```

After that:
- Client streams binary PCM16 audio (16kHz, mono)
- Server streams back binary audio (24kHz) and JSON events (`transcript`, `agentStartSpeaking`, `agentStopSpeaking`, `toolUse`, `error`)
- Client sends `{"type": "sessionEnd"}` to close

## Connecting the Frontend

In the frontend directory, set the agent URL in `.env.local`:

```env
VITE_AGENTCORE_WS_URL=ws://localhost:8081/ws
```

Or run `bash setup-env.sh` from `source/frontend/` to auto-configure.

## Adding Custom Tools

Edit `tools/registry.py` to register new tool functions. Tool IDs must match the ones selected in the frontend UI:

```python
# tools/registry.py
from strands import tool

@tool
def knowledge_base(query: str) -> str:
    """Look up information in the knowledge base."""
    # Your implementation here
    return "Answer from knowledge base"

TOOL_REGISTRY = {
    "knowledge-base": knowledge_base,
    # Add more tools here...
}
```

## Docker

Build and run as a container (same image used for AgentCore deployment):

```bash
docker build -t voice-agent-poc .
docker run -p 8081:8081 \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -e BEDROCK_REGION=us-east-1 \
  voice-agent-poc
```

## Project Structure

```
agent/
├── strands_agent.py      # Main server — WebSocket endpoint + session handling
├── requirements.txt      # Python dependencies
├── Dockerfile            # Container image for AgentCore deployment
└── tools/                # Agent tool implementations
    ├── __init__.py       # Exports TOOL_REGISTRY
    └── registry.py       # Tool ID → function mapping
```
