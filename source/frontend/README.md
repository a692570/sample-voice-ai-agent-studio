# Frontend — Voice AI POC-in-a-Box

React UI for configuring and testing voice agents. This guide covers how to launch the frontend locally and connect it to the deployed backend.

## Prerequisites

- Node.js 18+ and npm
- Backend deployed via `deployment/deploy-backend.sh` (Cognito User Pool must exist)

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Connecting to the Deployed Backend

### 1. Get Cognito credentials from the backend stack

```bash
aws cloudformation describe-stacks \
  --stack-name VoiceAgentPreStack \
  --query "Stacks[0].Outputs" \
  --output table
```

You'll see output like:

| OutputKey | OutputValue |
|-----------|-------------|
| UserPoolId | us-east-1_AbCdEfGhI |
| UserPoolClientId | 1a2b3c4d5e6f7g8h9i0j |
| IdentityPoolId | us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx |
| AssetsBucket | voice-agent-poc-307857433580-us-east-1 |
| EcrRepository | 307857433580.dkr.ecr.us-east-1.amazonaws.com/voice-agent-poc |

### 2. Create a `.env.local` file

**Option A — Automatic (recommended):**

```bash
bash ./setup-env.sh
```

This script fetches the Cognito values from CloudFormation and writes `.env.local` for you.

**Option B — Manual:**

```bash
cp .env.example .env.local
```

Edit `.env.local` with the values from step 1:

```env
VITE_COGNITO_USER_POOL_ID=us-east-1_AbCdEfGhI
VITE_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
```

### 3. Start the dev server

```bash
npm run dev
```

You'll now see the Cognito login page. Use the credentials sent to the email address you configured in `CDK_INPUT_USER_EMAILS` during backend deployment.

## Local Development Without Auth

If you want to skip Cognito login for quick UI development, simply **don't create a `.env.local` file** (or leave the values empty). The app will bypass authentication and log you in as `local-dev@example.com`.

## Connecting to the Voice Agent Server

On the "Try It Out" page, the WebSocket URL defaults to the value of `VITE_AGENTCORE_WS_URL` from your `.env.local`. You can also override it directly in the UI.

| Scenario | `VITE_AGENTCORE_WS_URL` value |
|----------|-------------------------------|
| Agent running locally | `ws://localhost:8081/ws` |
| Agent on AgentCore (deployed) | `wss://<runtime-id>.runtime.bedrock-agentcore.<region>.amazonaws.com/ws` |

### Running the agent server locally

In a separate terminal:

```bash
cd ../agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python strands_agent.py
```

The agent starts at `ws://localhost:8080/ws`. The frontend will connect and send all wizard configuration (prompt, voice, tools) as a `sessionConfig` event on connection.

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. This is what gets deployed to S3/CloudFront via `deploy-frontend.sh`.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID from PreStack | No (auth bypassed if empty) |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID from PreStack | No (auth bypassed if empty) |
| `VITE_AGENTCORE_WS_URL` | WebSocket URL for the voice agent server | No (defaults to `ws://localhost:8081/ws`) |

## Project Structure

```
src/
├── main.tsx                  # Entry point
├── App.tsx                   # Auth gate + router
├── context/
│   ├── AuthContext.tsx       # Cognito authentication state
│   └── WizardContext.tsx     # Wizard configuration state
├── components/
│   ├── Layout.tsx            # App shell (header + user info)
│   └── PageWrapper.tsx       # Shared page template
├── pages/
│   ├── Login.tsx             # Cognito sign-in / new password
│   ├── Launch.tsx            # Industry template selection
│   ├── Home.tsx              # Path choice (minimal vs technical)
│   ├── Voice1S.tsx           # Voice/language picker
│   ├── PipelineSelection.tsx # S2S vs Cascaded
│   ├── SpeechToSpeech.tsx    # Nova Sonic config
│   ├── CascadedSpeech.tsx    # STT/LLM/TTS model selection
│   ├── PromptBuilder.tsx     # System prompt generation
│   ├── Agents.tsx            # Tool selection
│   ├── Phone.tsx             # Twilio config
│   ├── Summary.tsx           # Review all selections
│   └── POC.tsx               # Live voice test + technical report
└── styles/
    └── global.css            # Design tokens
```

## Tech Stack

- React 19 + TypeScript
- Vite (dev server + bundler)
- React Router (page navigation)
- CSS Modules (scoped styles)
- amazon-cognito-identity-js (Cognito auth)
- Web Audio API + WebSocket (voice streaming on POC page)
