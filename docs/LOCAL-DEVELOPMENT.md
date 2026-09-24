# Local Development Guide

Local dev mode runs two things on your machine: the **frontend React app** (Vite
dev server) and the **voice agent** (a FastAPI/uvicorn server exposing the same
WebSocket interface as the deployed AgentCore runtime). The browser connects
straight to the local agent over `ws://localhost:8081/ws`, so you can change the
agent code and test voice behavior end-to-end without deploying anything.

This is the fast inner loop for iterating on the voice agent — edit
`source/agent/strands_agent.py`, restart, and talk to it in the browser. The
heavier backend (auth and the data APIs) can stay undeployed; see
[What works locally vs. what needs the backend](#what-works-locally-vs-what-needs-the-backend)
for the trade-offs.

## What works locally vs. what needs the backend

The frontend talks to **two separate backends**, and they have different local-dev requirements. Knowing which is which explains why some pages work while others error out.

| Backend | Env var | Local dev | Powers |
|---------|---------|-----------|--------|
| **WebSocket agent** | `VITE_AGENTCORE_WS_URL` | ✅ Runs locally (`ws://localhost:8081/ws`) | Live voice test on the POC page |
| **REST API** (API Gateway + Lambda + DynamoDB) | `VITE_API_URL` | ❌ Must be deployed (`VoiceAgentDemosStack`) | Agent list, demos, tools, RAG/Knowledge Base, eval, phone mappings |

**With only the local agent running (no stacks deployed):**

- ✅ Works: wizard navigation, model/voice/tool configuration, and the **live voice test** against the local agent.
- ❌ Fails: any page that reads or writes saved data — the **Agents list**, **Tools**, **Knowledge Bases**, **Eval Suites**, and **saving** an agent. These call the REST API.

> **Why the Agents page shows `JSON.parse: unexpected character at line 1 column 1`:**
> when `VITE_API_URL` is empty, the API client falls back to the Vite dev-server
> origin (`http://localhost:3001`). A request like `GET /demos` then returns the
> SPA's `index.html` (`<!DOCTYPE html>`), and parsing that as JSON fails on the
> first `<`. It's the expected result of running the UI without the REST API — not
> a bug. To make those pages work, deploy `VoiceAgentPreStack` +
> `VoiceAgentDemosStack` and re-run `setup-env.sh` so `VITE_API_URL` is populated.

For full functionality (saved agents, tools, RAG, auth), deploy the backend
stacks — see [DEPLOYMENT.md](DEPLOYMENT.md) — then run `setup-env.sh` to wire the
frontend to them. You can still run the agent locally and point
`VITE_AGENTCORE_WS_URL` at `ws://localhost:8081/ws` while using the deployed API.

## Prerequisites

- **Valid** AWS credentials with Bedrock access for Nova Sonic (see the note in
  [Agent Server](#agent-server) — stale/expired keys cause a 403 at call time,
  not at startup)
- To exercise the data-driven pages (agent list, tools, RAG, eval), deploy at
  least `VoiceAgentPreStack` and `VoiceAgentDemosStack` (Cognito login + REST API)
- Python 3.11+ and Node.js 18+

## Agent Server

The local agent server uses FastAPI with uvicorn and exposes the same WebSocket interface as the deployed AgentCore runtime.

```bash
cd source/agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Launch. If your default AWS profile isn't the one with Bedrock access,
# pass an explicit profile (see the credentials note below):
python strands_agent.py
# or:  AWS_PROFILE=your-profile python strands_agent.py
```

Runs at `ws://localhost:8081/ws`. The server:
- Accepts the same `sessionConfig` JSON as AgentCore
- Creates a Strands BidiAgent session with Amazon Nova 2 Sonic (speech-to-speech)
- Resolves the reserved tools (`endCallTool`, `transferCall`), custom tools, and integration tools (webhooks, Lambda, RAG)
- Splits large audio events for WebSocket frame limits

> **AWS credentials must be valid at call time.** The agent connects fine even
> with bad credentials — the failure only surfaces when it opens the Bedrock
> stream on the first voice turn, as a deeply nested error whose root cause is
> `403 UnrecognizedClientException` (invalid/unknown key) or `ExpiredToken`.
> The credentials come from the shell that launched the server (default profile,
> `AWS_PROFILE`, or `AWS_*` env vars). Verify before starting:
>
> ```bash
> aws sts get-caller-identity            # should print your account, not an error
> # or with a specific profile:
> AWS_PROFILE=your-profile python strands_agent.py
> ```
>
> If `get-caller-identity` returns `InvalidClientTokenId`, your default profile's
> keys are stale — pick a profile that works (`aws configure list-profiles`) and
> launch the agent with `AWS_PROFILE=<that-profile>`. The credentials also need
> Nova 2 Sonic access and `bedrock:InvokeModelWithBidirectionalStream`.

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
bash ./setup-env.sh   # Writes .env.local from deployed-stack outputs (safe to run with no stacks)
npm install
npm run dev
```

Runs at http://localhost:3000 (Vite auto-picks the next free port, e.g. 3001, if
3000 is taken — use the URL it prints).

`setup-env.sh` is safe to run even with nothing deployed: missing stack outputs
resolve to empty values, and `VITE_AGENTCORE_WS_URL` defaults to
`ws://localhost:8081/ws`. Empty Cognito/API values mean auth is bypassed and the
data-driven pages will error (see "What works locally vs. what needs the
backend").

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

## Testing Tools

### Reserved tools

Every session automatically includes the two reserved tools from
`source/agent/tools/registry.py`: `endCallTool` (end the call) and
`transferCall` (transfer to a human). There is no larger catalog of pre-built
tools — knowledge base, CRM, calendar, etc. are set up as **custom tools** in the
UI, not shipped in the registry.

### Custom tools

Define tools in the wizard with name, description, and mock response. They're created dynamically at session start.

### Integration tools (webhooks, Lambda)

1. Create a tool in the Integrations → Tools page (requires deployed API stack)
2. Select it in the wizard — it appears with an `int:` prefix
3. The agent fetches the tool config from the API and builds a callable at session start

## Project Layout (Development-relevant files)

```
source/agent/
├── strands_agent.py          # Local dev server (FastAPI) — edit this for agent changes
├── main.py                   # AgentCore entrypoint (deployed version)
├── rag_tools.py              # RAG / Knowledge Base tool builder
├── call_history_logger.py    # Optional call-history logging
├── tools/
│   ├── __init__.py           # Exports TOOL_REGISTRY + RESERVED_TOOL_IDS
│   └── registry.py           # Reserved tools: endCallTool, transferCall
└── requirements.txt          # Python dependencies
                              # (the deployed bundle is built by the CDK
                              #  AgentStack at deploy time — no committed package)

source/frontend/
├── src/
│   ├── config/
│   │   ├── templates.ts      # Industry template presets
│   │   ├── voices.ts         # Voice options per model
│   │   └── reservedTools.ts  # Reserved-tool definitions for the UI
│   ├── context/
│   │   ├── WizardContext.tsx  # All wizard state + reducer
│   │   └── AuthContext.tsx    # Cognito auth state
│   ├── services/
│   │   ├── presignWs.ts      # SigV4 presigned URL generation
│   │   ├── demosApi.ts       # Demos CRUD + config serialization
│   │   ├── toolsApi.ts       # Tools API client
│   │   └── ragApi.ts         # RAG/Knowledge Base API client
│   └── pages/
│       ├── SpeechToSpeech.tsx # Model selection
│       ├── Voice1S.tsx        # Voice/language picker
│       ├── POC.tsx            # Live test page (WebSocket + audio)
│       └── ...
├── setup-env.sh              # Fetches config from CloudFormation
└── .env.example              # Template for manual configuration
```

## Debugging

### Agent logs

The local server logs to stdout. Key log lines:
- `🚀 Starting Nova Sonic Voice Agent server...` — server started
- `WebSocket connection established` — a client connected
- `Session configured: {...}` — config received, shows a sanitized summary
- `✅ Agent ready: model=[...], voice=...` — BidiAgent created for the session
- `Tools loaded: N total` — how many tools were resolved

### Frontend debugging

- Browser DevTools → Network → WS tab shows all WebSocket messages
- Console logs `System:` messages from the agent
- `sessionConfig` is the first message sent after connection — inspect it to verify what the agent receives

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `JSON.parse: unexpected character at line 1 column 1` on Agents/Tools/RAG pages | `VITE_API_URL` empty → request hits the Vite dev server, which returns `index.html` instead of JSON | Deploy `VoiceAgentDemosStack` and re-run `setup-env.sh` (see "What works locally vs. what needs the backend") |
| `403 UnrecognizedClientException` / `InvalidClientTokenId` (nested in a WS error) | Agent's AWS credentials are invalid or expired | Run `aws sts get-caller-identity`; relaunch with `AWS_PROFILE=<valid-profile>` |
| `ExpiredToken` (nested in a WS error) | Temporary/SSO credentials expired | Refresh credentials (e.g. `aws sso login`) and restart the agent |
| `AccessDenied` on `InvokeModelWithBidirectionalStream` | Missing Bedrock permission or Nova Sonic not enabled | Grant `bedrock:InvokeModelWithBidirectionalStream` and enable Nova 2 Sonic in the Bedrock console |
| "Connection closed (code 1006)" | Agent not running or crashed | Check agent terminal for errors |
| "Microphone access denied" | Browser permission | Allow mic in browser settings |
| "Sorry, something went wrong" (voice response) | Nova Sonic stream error (often credentials/permissions) | Check the agent terminal for the underlying Bedrock error |
| No audio playback | AudioContext suspended | Click the page first (browser autoplay policy) |
| Integration tools not resolving | `API_URL` not set | Set the `API_URL` env var or deploy DemosStack |
| Frontend starts on `:3001` instead of `:3000` | Port 3000 already in use | Free port 3000, or just use the URL Vite prints |
