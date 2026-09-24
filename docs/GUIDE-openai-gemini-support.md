# Adding OpenAI Realtime & Gemini Live Support

Status: **Planned / not yet implemented.** This document captures the current
state, the target design, and a step-by-step plan so the work can be picked up
later.

## Summary

The wizard already lets a user pick **OpenAI Realtime API** or **Gemini Live**
as the speech-to-speech model (with API-key inputs), but the agent runtime does
not actually run them — it logs a warning and falls back to Amazon Nova 2 Sonic.
Strands BidiAgent natively supports all three providers, so enabling them is a
matter of wiring up the shipped model classes rather than building new
integrations.

Estimated effort: ~half a day of coding, plus testing time for each provider's
audio path (audio sample-rate reconciliation is the main risk).

## Current State

### What already works (no change needed)

- **UI model selection** — `source/frontend/src/pages/SpeechToSpeech.tsx` offers
  `nova-2-sonic`, `openai-realtime`, and `gemini-live`, with per-provider
  API-key inputs (OpenAI, Google).
- **Voice configs** — `source/frontend/src/config/voices.ts` has
  `NOVA_SONIC_CONFIG`, `OPENAI_REALTIME_CONFIG`, and `GEMINI_LIVE_CONFIG`.
- **Config plumbing** — `source/frontend/src/context/WizardContext.tsx` carries
  `apiKeys.openai` / `apiKeys.gemini`, and `source/frontend/src/pages/POC.tsx`
  forwards them to the agent at session start.

### What is stubbed (the gap)

Both agent entry points create a Nova Sonic model unconditionally and only log a
warning for the other providers:

- `source/agent/main.py` — the deployed AgentCore entrypoint (the important one).
- `source/agent/strands_agent.py` — the local-dev FastAPI server.

Current logic (paraphrased):

```python
if selected_model == "openai-realtime" and api_keys.get("openai"):
    logger.warning("OpenAI Realtime adapter not yet available — falling back to Nova Sonic")
elif selected_model == "gemini-live" and api_keys.get("gemini"):
    logger.warning("Gemini Live adapter not yet available — falling back to Nova Sonic")

model = BedrockNovaSonicModel(region=..., model_id=..., voice=..., audio={...})
agent = BidiAgent(model=model, tools=tools, system_prompt=system_prompt)
```

No OpenAI/Gemini code paths, and no `openai` / `google-genai` dependencies exist
anywhere in the source.

## Reference Implementation

AWS ships a working example that wires up all three providers:

- Repo: `aws-samples/sample-voice-agent-on-aws`
- Path: `samples/bidi-streaming/strands-sonic/websocket/` (`agent.py`)
- Link: https://github.com/aws-samples/sample-voice-agent-on-aws/tree/main/samples/bidi-streaming/strands-sonic/websocket

Its `_create_model()` selects the model class by `model_id` prefix:

| Prefix | Model class | Module |
|--------|-------------|--------|
| `amazon.nova*` | `BidiNovaSonicModel` | `strands.experimental.bidi.models.nova_sonic` |
| `gpt-*` | `BidiOpenAIRealtimeModel` | `strands.experimental.bidi.models.openai_realtime` |
| `gemini*` | `BidiGeminiLiveModel` | `strands.experimental.bidi.models.gemini_live` |

Reference constructor shape (OpenAI and Gemini):

```python
# OpenAI Realtime
from strands.experimental.bidi.models.openai_realtime import BidiOpenAIRealtimeModel
BidiOpenAIRealtimeModel(
    model_id=model_id,
    provider_config={"audio": {"voice": voice}},
    client_config={"api_key": api_key},
    mcp_gateway_arn=effective_gateway_arns,
)

# Gemini Live
from strands.experimental.bidi.models.gemini_live import BidiGeminiLiveModel
BidiGeminiLiveModel(
    model_id=model_id,
    provider_config={"audio": {"input_rate": in_rate, "output_rate": out_rate}},
    client_config={"api_key": api_key},
    mcp_gateway_arn=effective_gateway_arns,
)
```

Reference dependencies (`requirements.txt`): `openai>=1.0.0`,
`google-genai>=1.32.0`, and the `bidi-openai` / `bidi-gemini` Strands extras.

## Model Versions & IDs

The project's UI currently uses **abstract** model IDs — `openai-realtime` and
`gemini-live` (see `source/frontend/src/config/voices.ts`) — with **no concrete
underlying model version**. When wiring the runtime, each must be mapped to a
real provider model ID. Strands selects the provider by the `model_id` string
(the reference sample keys off prefixes: `gpt-*` → OpenAI, `gemini*` → Gemini).

Concrete model IDs to target (verify current availability at build time — these
providers version rapidly):

| Provider | Example `model_id` | Notes |
|----------|--------------------|-------|
| OpenAI Realtime | `gpt-realtime` | OpenAI's production speech-to-speech model; versioned variants exist (e.g. `gpt-realtime-2.1`). Strands' own docs use `gpt-realtime` as the example id. |
| Gemini Live | `gemini-2.0-flash-live` | The identifier used in Strands' bidi events docs. |
| Gemini Live (native audio) | `gemini-2.5-flash-native-audio-preview-09-2025` | Used in Strands' Gemini Live model docs example (preview, dated — expect churn). |
| Nova Sonic (current) | `amazon.nova-2-sonic-v1:0` | Already used by this project. |

Sources (verify before implementing, versions change):
- OpenAI Realtime models — https://developers.openai.com/api/docs/guides/realtime-conversations and https://openai.com/index/introducing-gpt-realtime/
- Strands bidi model ids (`gpt-realtime`, `gemini-2.0-flash-live`) — https://strandsagents.com/docs/api/python/strands.experimental.bidi.types.events/
- Strands Gemini Live model docs — https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/models/google/

Decision to make: either (a) map the UI's abstract IDs to fixed provider model
IDs in the runtime, or (b) surface a concrete model-version selector in the
wizard so operators can choose (and update) the exact version. Option (a) is
simpler for now; option (b) ages better as providers release new versions.

Client library versions (from the reference sample's `requirements.txt`):
`openai>=1.0.0`, `google-genai>=1.32.0`. Pin these to known-good versions when
adding them.

## ⚠️ Version Caveat (read before coding)

The reference sample and this project are on **different Strands versions**, and
the bidi model API changed between them:

| | This project | Reference sample |
|---|---|---|
| `strands-agents` | `1.57.0` (with `[bidi]` extra) | `1.25.0` |
| Nova Sonic class | `BedrockNovaSonicModel` (from `...bidi.models`) | `BidiNovaSonicModel` (from `...bidi.models.nova_sonic`) |
| Constructor | flat kwargs: `voice=`, `audio={...}` | `provider_config={"audio": {...}}`, `client_config={...}` |

**Do not copy the sample's constructor calls verbatim.** Constructor shapes
differ across versions/docs — the 1.25.0 sample uses
`provider_config={"audio": {...}}` + `client_config={"api_key": ...}`, while the
current Strands Gemini docs example uses a flat `voice=` kwarg with
`client_args={"api_key": ...}`. Before implementing, confirm the actual
OpenAI/Gemini class names and constructor signatures in the installed
`strands-agents==1.57.0` (e.g. inspect the installed package or its release
notes). Two viable paths:

- **Path A — stay on 1.57.0:** verify 1.57.0's OpenAI/Gemini bidi classes and
  their kwargs, then add branches matching 1.57.0's contract (likely the flatter
  `voice=` / `audio=` style used by the existing Nova Sonic code).
- **Path B — align to the sample:** bump/adjust to the sample's known-working
  pattern (`BidiNovaSonicModel` + `provider_config`). Lower API-uncertainty, but
  requires re-testing the existing Nova Sonic path and re-validating the pinned
  input contract noted in `source/agent/requirements.txt`.

## Implementation Plan

1. **Confirm the API** for `strands-agents==1.57.0`:
   - OpenAI/Gemini bidi model class names + import paths.
   - Constructor kwargs (flat vs `provider_config`/`client_config`).
   - Whether the `[bidi]` extra bundles the OpenAI/Gemini clients or whether
     `bidi-openai` / `bidi-gemini` extras are required.

2. **Dependencies** — update `source/agent/requirements.txt`:
   - Add the OpenAI/Gemini Strands extras and/or `openai` + `google-genai`.
   - Re-pin to a known-good set (mirror the pin discipline already in the file).

3. **Runtime wiring** — extract a `create_model(selected_model, config, api_keys)`
   helper and use it in **both**:
   - `source/agent/main.py` (deployed AgentCore entrypoint), and
   - `source/agent/strands_agent.py` (local dev server).

   Select by model id/prefix; pass the API key from `config["apiKeys"]`; raise a
   clear error if the selected provider's key is missing (instead of silently
   falling back). Keep tools, hooks, and event streaming unchanged — they are
   model-agnostic.

4. **Audio sample rates** — the main functional risk:
   - Nova Sonic uses 16 kHz PCM in/out (currently hardcoded).
   - OpenAI Realtime commonly expects 24 kHz PCM16; Gemini has its own rates.
   - Make the per-model `audio` config provider-specific and confirm the
     frontend capture/playback matches, or audio will be garbled.

5. **API key handling / security**:
   - Keys arrive in the session config from the browser. Confirm they are not
     logged (`config_summary()` in `strands_agent.py` should stay sanitized).
   - Decide whether to also support `OPENAI_API_KEY` / `GOOGLE_API_KEY` env vars
     as a server-side fallback (the reference sample does).

6. **Testing** (per provider, over a real session):
   - Session starts, model connects, greeting plays.
   - Two-way audio is clean (no distortion / wrong pitch → sample-rate mismatch).
   - Tool calls fire and results are spoken back.
   - Barge-in / interruption works.
   - Missing/invalid API key produces a clear error, not a silent Nova fallback.

## Docs to update once implemented

- `README.md` — the "Speech & Reasoning" bullet, the "Bidirectional Streaming"
  note, and the Tech Stack "Speech-to-Speech" row currently state that OpenAI /
  Gemini fall back to Nova Sonic. Update them once the providers actually run.
- `source/agent/README.md` — model/config reference, if it lists supported models.
