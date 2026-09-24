# Deployment Guide

This guide covers deploying the Conversational AI Agent Studio to your AWS account using CDK.

## Prerequisites

- AWS CLI v2 installed and configured
- Node.js 18+ and npm
- Python 3.11+ and pip
- AWS CDK v2 (`npm install -g aws-cdk`)
- AWS credentials with permissions for CloudFormation, S3, CloudFront, Cognito, DynamoDB, Lambda, API Gateway, Bedrock, and Bedrock AgentCore
- Amazon Nova 2 Sonic model access enabled in Bedrock console

### Supported Regions

Deploy to **us-east-1** (N. Virginia) for full AgentCore + Nova 2 Sonic support.

## Build the eval runner bundle (required before deploying)

`VoiceAgentDemosStack` includes the eval-runner Lambda, whose code asset lives at
`source/eval-runner/bundled/`. That directory is **generated** — if it's missing,
`cdk synth`/`deploy` fails with `CannotFindAsset: Cannot find asset at
.../source/eval-runner/bundled`. Build it once before deploying (and again
whenever the eval runner or harness changes):

```bash
bash source/eval-runner/bundle.sh
```

The eval runner depends on the **nova-sonic-eval-harness**, which is vendored in
the repo at `source/eval-runner/nova-sonic-eval-harness/` (MIT-0, from
[aws-samples/sample-amazon-nova-sonic-eval-harness](https://github.com/aws-samples/sample-amazon-nova-sonic-eval-harness)).
`bundle.sh` installs its dependencies and copies it into `bundled/` — no clone or
network fetch of the harness is required.

## Quick Start (Full Deployment)

```bash
cd voice-agent-poc-in-a-box

# Cognito login — temporary password sent to these emails
export CDK_INPUT_USER_EMAILS=user1@example.com,user2@example.com

# Optional: set explicitly if not using default AWS profile
export CDK_DEFAULT_ACCOUNT=<your-account-id>
export CDK_DEFAULT_REGION=us-east-1

# Build the eval runner Lambda bundle (see section above) before deploying
bash source/eval-runner/bundle.sh

cd deployment
bash ./deploy.sh
```

This:
1. Sets up a Python venv and installs CDK dependencies
2. Bootstraps CDK (if needed)
3. Deploys all backend stacks (Cognito, AgentCore, DynamoDB, API)
4. Fetches config values from CloudFormation outputs
5. Builds the frontend with those values baked in
6. Deploys the frontend to CloudFront
7. Creates Cognito users

## Deployment Scripts

| Script | What It Does |
|--------|--------------|
| `deploy.sh` | Full end-to-end deployment (all core stacks) |
| `deploy-backend.sh` | Backend infrastructure (Pre + Agent + Demos) |
| `deploy-frontend.sh` | Build and deploy React UI + create Cognito users |

> Telephony (PSTN relay) and SIP are **not** part of this CDK app. They are
> deployed separately — see [`telephony/pstn/`](../telephony/pstn/) and
> [`telephony/sip/`](../telephony/sip/).

## CDK Stacks

| Stack | Resources | Depends On |
|-------|-----------|------------|
| `VoiceAgentPreStack` | Cognito User Pool, Identity Pool (with IAM roles), S3, ECR | — |
| `VoiceAgentAgentStack` | AgentCore Runtime (Nova Sonic BidiAgent, WebSocket) | PreStack |
| `VoiceAgentDemosStack` | DynamoDB tables, Lambda functions, API Gateway (demos, tools, RAG, phone mappings) | PreStack |
| `VoiceAgentFrontendStack` | CloudFront distribution + S3 origin (React app) | PreStack |
| `VoiceAgentPostStack` | Lambda for Cognito user creation | PreStack |

> There is no `VoiceAgentKBStack`. The RAG feature uses an **existing Bedrock
> Knowledge Base in the target account** — this app does not create one. See
> "Knowledge Base configuration" below.

## Knowledge Base configuration (optional, per account)

RAG is optional and the Knowledge Base is **not created by this app**. If you
want the RAG feature, create/choose a Bedrock Knowledge Base in the target
account and pass its id at deploy time. The app defaults to no KB, in which case
the Knowledge Bases page simply shows an empty state.

```bash
# find existing KBs in the account
aws bedrock-agent list-knowledge-bases --query "knowledgeBaseSummaries[].{id:knowledgeBaseId,name:name}"

# deploy with the KB id (and the Demos API URL for the agent's RAG tools)
npx cdk deploy VoiceAgentDemosStack VoiceAgentAgentStack \
  -c kb_id=YOURKBID \
  -c api_url=https://<demos-api-id>.execute-api.<region>.amazonaws.com/prod \
  --require-approval never
```

You can also set these as environment variables (`KB_ID`, `API_URL`) instead of
CDK context. If left unset, RAG-related features are skipped gracefully — no
errors on the Knowledge Bases page.

## Deploying Individual Stacks

If you only need to update a specific component:

```bash
cd deployment
source .venv/bin/activate

# Just the agent runtime (after code changes to source/agent/)
npx cdk deploy VoiceAgentAgentStack --require-approval never

# Just the API (after Lambda handler changes)
npx cdk deploy VoiceAgentDemosStack --require-approval never

# Just the frontend (after UI changes)
bash deploy-frontend.sh
```

## Agent Runtime Deployment

The agent runs on Bedrock AgentCore as a Python 3.12 (Linux/ARM64) runtime.

`VoiceAgentAgentStack` builds the runtime bundle **automatically at deploy
time** — there is no committed package to maintain by hand. On every deploy the
stack (`deployment/agent_stack/agent_stack.py`):

1. Recreates a clean `source/agent/package/` directory (a generated artifact,
   not committed to git).
2. Installs the agent's dependencies from `source/agent/requirements.txt` into
   it, targeting `aarch64` / CPython 3.12 wheels (`--only-binary=:all:`).
3. Copies the application code (`main.py`, `strands_agent.py`,
   `call_history_logger.py`, `rag_tools.py`, and the `tools/` package) on top.
4. Strips any `__pycache__` directories.

### Changing the agent

Edit the source under `source/agent/` and redeploy — the bundle is rebuilt for
you:

```bash
cd deployment
npx cdk deploy VoiceAgentAgentStack --require-approval never
```

### Adding Python dependencies

Add the package to `source/agent/requirements.txt` and redeploy. The stack pins
`--platform manylinux2014_aarch64` (plus `manylinux_2_17`/`manylinux_2_28`) and
`--python-version 3.12`, so only wheels compatible with the AgentCore runtime
are installed. Manual `pip install --target` steps are not required.

## Environment Variables

### Agent Runtime (set via CDK stack)

| Variable | Default | Description |
|----------|---------|-------------|
| `BEDROCK_REGION` | `us-east-1` | Region for Bedrock API calls |
| `MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Nova Sonic model ID |
| `VOICE` | `tiffany` | Default voice when not specified by client |

### Frontend (set via `.env.local`, `.env.production`, or `setup-env.sh`)

`deploy.sh` writes these into `source/frontend/.env.production` automatically
from the CloudFormation outputs. See `source/frontend/.env.example` for the full
list.

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Demos/tools API Gateway endpoint |
| `VITE_RAG_API_URL` | Knowledge Base / RAG API endpoint (same API as `VITE_API_URL`) |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID |
| `VITE_COGNITO_IDENTITY_POOL_ID` | Cognito Identity Pool ID |
| `VITE_COGNITO_DOMAIN` | Cognito hosted-UI domain (federated SSO; empty disables it) |
| `VITE_AGENTCORE_RUNTIME_ARN` | AgentCore Runtime ARN (empty = connect to localhost) |
| `VITE_AGENTCORE_WS_URL` | AgentCore WebSocket URL; local dev fallback `ws://localhost:8081/ws` |
| `VITE_AWS_REGION` | AWS region |

## IAM Permissions

The AgentCore Runtime role is granted:

```
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModelWithBidirectionalStream
```

On `Resource: *` — this covers Nova Sonic, Claude, Nova Pro, and any other Bedrock model used as a reasoner in Expert Tool mode.

## Presigned WebSocket URLs

The browser connects to AgentCore using SigV4-presigned URLs:

1. User logs in → Cognito User Pool returns JWT ID token
2. Frontend sends ID token to Cognito Identity Pool → gets temporary AWS credentials
3. Frontend signs the WebSocket URL with SigV4 (`@smithy/signature-v4`)
4. Browser connects: `wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<arn>/ws?X-Amz-...`

No AWS credentials stored in env files. Everything derived from the authenticated Cognito session.

## Cleanup

```bash
cd deployment
source .venv/bin/activate
npx cdk destroy --all
```

Note: Some resources (S3 buckets with data, DynamoDB tables) may require manual deletion if they contain data and have removal policies set to RETAIN.
