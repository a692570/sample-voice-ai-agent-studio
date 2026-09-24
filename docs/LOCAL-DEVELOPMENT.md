# Local Development Guide

Run the agent and frontend locally for development without deploying all stacks.

## Prerequisites

- AWS credentials configured with Bedrock access (for Nova Sonic)
- Deploy at least `VoiceAgentPreStack` and `VoiceAgentDemosStack` (for Cognito login and API)
- Python 3.11+ and Node.js 18+

## Agent Server

The local agent server uses FastAPI with uvicorn and exposes the same WebSocket interface as the deployed AgentCore runtime.

```bash
cd source/agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python strands_agent.py
```

Runs at `ws://localhost:8081/ws`. The server:
- Accepts the same `sessionConfig` JSON as AgentCore
- Creates a BidiAgent session with Nova Sonic
- Supports Expert Tool mode (pass `reasonerModel` in config)
- Resolves pre-built tools, custom tools, and integration tools (webhooks, Lambda)
- Splits large audio events for WebSocket frame limits

### Environment variables (optional)

```bash
export BEDROCK_REGION=us-east-1       # Default region for Bedrock calls
export MODEL_ID=amazon.nova-2-sonic-v1:0  # Nova Sonic model
export VOICE=tiffany                  # Default voice
export PORT=8081                      # Server port
export API_URL=https://...            # API Gateway URL (for integration tools)
```

## Frontend

```bash
cd source/frontend
bash ./setup-env.sh   # Fetches Cognito + API config from deployed stacks
npm install
npm run dev
```

Runs at http://localhost:3000.

### Connecting to local agent vs. deployed AgentCore

| `VITE_AGENTCORE_RUNTIME_ARN` | Behavior |
|-------------------------------|----------|
| Empty or unset | Connects to `ws://localhost:8081/ws` (local agent) |
| Set to an ARN | Generates SigV4 presigned URL, connects to deployed AgentCore |

For pure UI development without backend:
- Skip `setup-env.sh` — auth is bypassed when Cognito env vars are empty
- The voice test page won't work without a running agent

### Hot reload

- **Frontend**: Vite hot-reloads on file save automatically
- **Agent**: Restart `python strands_agent.py` after code changes

## Running Without Cognito (UI-only development)

If you don't need authentication and just want to iterate on the UI:

```bash
cd source/frontend
npm install
npm run dev
```

Without Cognito environment variables, the app skips the login screen and loads directly. API calls to DynamoDB (demos, tools) will fail, but wizard navigation and UI components work.

## Testing Expert Tool Mode Locally

1. Start the agent: `python strands_agent.py`
2. In the wizard, select Nova 2 Sonic as the model
3. Enable Expert Tool and choose a reasoner (e.g., Claude Sonnet 4)
4. Start a conversation — check the agent terminal for logs:
   ```
   INFO:__main__:Expert Tool: BedrockConverseReasoner with us.anthropic.claude-sonnet-4-20250514-v1:0
   INFO:__main__:Agent ready: model=['nova-2-sonic'], voice=tiffany
   ```

Your AWS credentials must have `bedrock:InvokeModel` permission for both Nova Sonic and the selected reasoner model.

## Testing Tools

### Pre-built tools

Select tools in the wizard Flow step (knowledge-base, calendar, CRM, etc.). These use mock implementations from `source/agent/tools/registry.py`.

### Custom tools

Define tools in the wizard with name, description, and mock response. They're created dynamically at session start.

### Integration tools (webhooks, Lambda)

1. Create a tool in the Integrations → Tools page (requires deployed API stack)
2. Select it in the wizard — it appears with an `int:` prefix
3. The agent fetches the tool config from the API and builds a callable at session start

## Project Layout (Development-relevant files)

```
source/agent/
├── strands_agent.py          # Local dev server — edit this for agent changes
├── main.py                   # AgentCore entrypoint (deployed version)
├── tools/
│   ├── __init__.py           # Exports TOOL_REGISTRY
│   └── registry.py           # Pre-built @tool implementations
├── requirements.txt          # Python dependencies
└── deploy_package/           # Pre-bundled for AgentCore (don't edit directly)

source/frontend/
├── src/
│   ├── config/
│   │   ├── templates.ts      # Industry template presets
│   │   ├── voices.ts         # Voice options per model
│   │   └── reasonerModels.ts # Expert Tool reasoner options
│   ├── context/
│   │   ├── WizardContext.tsx  # All wizard state + reducer
│   │   └── AuthContext.tsx    # Cognito auth state
│   ├── services/
│   │   ├── presignWs.ts      # SigV4 presigned URL generation
│   │   ├── demosApi.ts       # Demos CRUD + config serialization
│   │   ├── toolsApi.ts       # Tools API client
│   │   └── ragApi.ts         # RAG/Knowledge Base API client
│   └── pages/
│       ├── SpeechToSpeech.tsx # Model selection (incl. Expert Tool toggle)
│       ├── Voice1S.tsx        # Voice/language picker
│       ├── POC.tsx            # Live test page (WebSocket + audio)
│       └── ...
├── setup-env.sh              # Fetches config from CloudFormation
└── .env.example              # Template for manual configuration
```

## Debugging

### Agent logs

The local server logs to stdout. Key log lines:
- `Session configured:` — client connected, shows config summary
- `Tools loaded: N total` — how many tools were resolved
- `Expert Tool: BedrockConverseReasoner with ...` — reasoner mode active
- `ERROR:strands.experimental.bidi.expert_tool.manager:` — reasoner call failed

### Frontend debugging

- Browser DevTools → Network → WS tab shows all WebSocket messages
- Console logs `System:` messages from the agent
- `sessionConfig` is the first message sent after connection — inspect it to verify what the agent receives

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Connection closed (code 1006)" | Agent not running or crashed | Check agent terminal for errors |
| "Microphone access denied" | Browser permission | Allow mic in browser settings |
| "Sorry, something went wrong" (voice response) | Expert tool error / invalid model ID | Check agent logs for `ERROR:strands.experimental.bidi.expert_tool` |
| No audio playback | AudioContext suspended | Click the page first (browser autoplay policy) |
| Tools not resolving | `API_URL` not set | Set env var or deploy DemosStack |
