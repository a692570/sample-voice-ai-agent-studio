"""
AgentCore Stream Adapter for Eval Runner.

Provides a WebSocket-based connection to Bedrock AgentCore Runtime that is
compatible with the eval harness's SonicStreamManager interface. Instead of
connecting directly to Nova Sonic via Bedrock bidirectional streaming API,
this adapter connects to the AgentCore Runtime WebSocket endpoint — which
wraps Nova Sonic with the agent's full config (system prompt, tools, voice,
Strands BidiAgent logic).

This allows the eval harness to test the deployed agent end-to-end.
"""

import asyncio
import base64
import json
import os
import time
import uuid
import logging
from typing import Optional, Callable, Dict, Any

import boto3

logger = logging.getLogger(__name__)

# Try importing websockets for async WebSocket client
try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False


def generate_presigned_ws_url(runtime_arn: str, region: str, session_id: Optional[str] = None) -> str:
    """
    Generate a SigV4-presigned WebSocket URL for AgentCore Runtime.
    Based on: https://github.com/aws-samples/sample-voice-agent-on-aws/blob/main/deployment/agentcore/websocket_helpers.py
    """
    from urllib.parse import urlparse
    from botocore.auth import SigV4QueryAuth
    from botocore.awsrequest import AWSRequest

    session = boto3.Session()
    credentials = session.get_credentials()

    # Build the base WebSocket URL with qualifier
    base_wss_url = f"wss://bedrock-agentcore.{region}.amazonaws.com/runtimes/{runtime_arn}/ws?qualifier=DEFAULT"

    # Convert to https for signing
    https_url = base_wss_url.replace("wss://", "https://")
    parsed_url = urlparse(https_url)

    request = AWSRequest(
        method='GET',
        url=https_url,
        headers={'Host': parsed_url.netloc}
    )
    SigV4QueryAuth(credentials, 'bedrock-agentcore', region, expires=300).add_auth(request)

    # Convert back to wss://
    return request.url.replace("https://", "wss://")


class AgentCoreStreamManager:
    """
    WebSocket-based stream manager that connects to AgentCore Runtime.
    Compatible with the eval harness's SonicStreamManager interface.

    Instead of using Bedrock's bidirectional streaming API directly,
    this connects to the AgentCore WebSocket which wraps Nova Sonic
    with the full agent config (system prompt, tools, BidiAgent logic).
    """

    def __init__(
        self,
        runtime_arn: str,
        region: str = "us-east-1",
        agent_config: Optional[Dict[str, Any]] = None,
        event_callback: Optional[Callable] = None,
        tool_handler: Optional[Callable] = None,
        voice_id: str = "tiffany",
        system_prompt: str = "",
        **kwargs,  # Accept extra kwargs for compatibility with SonicStreamManager
    ):
        """
        Args:
            runtime_arn: AgentCore Runtime ARN
            region: AWS region
            agent_config: Full agent DemoConfig (system prompt, tools, voice, etc.)
            event_callback: Callback for events (same interface as SonicStreamManager)
            tool_handler: Tool call handler (tools are handled by AgentCore, not here)
            voice_id: Voice ID (sent in session config)
            system_prompt: System prompt (sent in session config)
        """
        self.runtime_arn = runtime_arn
        self.region = region
        self.agent_config = agent_config or {}
        self.event_callback = event_callback
        self.tool_handler = tool_handler
        self.voice_id = voice_id
        self.system_prompt = system_prompt

        self.ws = None
        self.is_active = False
        self.receive_task = None
        self.sonic_session_id = None
        self._audio_paused = False

        # Tool event tracking (for inclusion in eval interaction log)
        self._tool_events: list = []  # All tool events across turns
        self._current_turn_tools: list = []  # Tool events for current turn

        # --- Latency instrumentation ---
        self._latency_events: list = []  # Timestamped event log
        self._turn_latencies: list = []  # Per-turn latency breakdown
        self._current_turn_start: float = 0.0  # When current turn's user input started
        self._user_input_end_ts: float = 0.0  # When user input completed
        self._first_text_ts: float = 0.0  # First assistant text in current turn
        self._first_audio_ts: float = 0.0  # First audio byte in current turn
        self._tool_call_start_ts: float = 0.0  # When tool_call event received
        self._last_tool_result_ts: float = 0.0  # When last tool_result received in this turn
        self._first_audio_after_tool_ts: float = 0.0  # First audio after tool result
        self._agent_speaking_end_ts: float = 0.0  # When agent's last audio in previous turn ended
        self._prev_agent_speaking_end_ts: float = 0.0  # Agent speaking end from previous turn (for turn-taking latency)
        self._interruption_count: int = 0  # Total barge-in interruptions
        self._current_turn_tool_latencies: list = []  # Tool latencies for current turn

        # Audio recording buffers
        self._output_audio_chunks: list = []  # Agent's audio output (current turn)
        self._input_audio_chunks: list = []   # User's audio input (current turn, from Polly TTS)
        self._turn_audio: list = []           # Completed turn audio [(turn_num, output_bytes, input_bytes)]
        self._current_turn_num: int = 0

        # Compatibility attributes expected by the eval harness
        self.prompt_name = str(uuid.uuid4())
        self.event_logger = None
        self.input_audio_callback = None

    async def initialize_stream(self):
        """Connect to AgentCore WebSocket and send session config."""
        if not WEBSOCKETS_AVAILABLE:
            raise ImportError("websockets package required. Install with: pip install websockets")

        from urllib.parse import urlparse
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        import secrets as _secrets

        # Use header-based SigV4 auth (more reliable than query-string presigning)
        url = f"wss://bedrock-agentcore.{self.region}.amazonaws.com/runtimes/{self.runtime_arn}/ws?qualifier=DEFAULT"
        parsed_url = urlparse(url)

        # Sign the request with SigV4 (header-based)
        session = boto3.Session()
        credentials = session.get_credentials()
        sign_url = url.replace("wss://", "https://")
        request = AWSRequest(method='GET', url=sign_url, headers={'Host': parsed_url.netloc})
        SigV4Auth(credentials, 'bedrock-agentcore', self.region).add_auth(request)

        # Build headers: SigV4 auth headers + WebSocket upgrade headers
        ws_key = base64.b64encode(_secrets.token_bytes(16)).decode('utf-8')
        headers = dict(request.headers)
        headers.update({
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': ws_key,
            'User-Agent': 'AWS-SigV4-WebSocket-Client/1.0',
        })

        logger.info(f"Connecting to AgentCore: {self.runtime_arn}")

        self.ws = await websockets.connect(
            url,
            max_size=10 * 1024 * 1024,
            additional_headers=headers,
            open_timeout=60,  # AgentCore cold starts can take 30-60s
        )
        self.is_active = True

        # Send session configuration (same protocol as the frontend)
        session_config = {
            "type": "sessionConfig",
            "clientId": f"eval-{uuid.uuid4().hex[:8]}",
            "systemPrompt": self.system_prompt,
            "voice": {"voiceId": self.voice_id},
            "agentStartFirst": True,  # Agent greets first — warms up Nova Sonic stream
            "tools": self.agent_config.get("tools", []),
            "customTools": self.agent_config.get("customTools", []),
            "useMock": self.agent_config.get("useMock", True),
            "greeting": json.dumps({"customTools": self.agent_config.get("customTools", [])}) if self.agent_config.get("customTools") else "",
        }
        # Include modelId if specified (Sonic model override)
        if self.agent_config.get("modelId"):
            session_config["modelId"] = self.agent_config["modelId"]

        await self.ws.send(json.dumps(session_config))

        # Wait for "system" acknowledgment
        try:
            ack = await asyncio.wait_for(self.ws.recv(), timeout=30)
            ack_msg = json.loads(ack)
            if ack_msg.get("type") == "system":
                logger.info(f"AgentCore ready: {ack_msg.get('message', '')}")
            elif ack_msg.get("type") == "error":
                raise RuntimeError(f"AgentCore error: {ack_msg.get('message')}")
        except asyncio.TimeoutError:
            raise RuntimeError("Timed out waiting for AgentCore session acknowledgment")

        # Start background receive loop
        self.receive_task = asyncio.create_task(self._receive_loop())

        # Send silent audio to keep Nova Sonic alive (matches original eval harness pattern).
        # Pattern: 512-frame chunks (~32ms at 16kHz) every 30ms.
        # This is the exact pattern used by the Nova Sonic eval harness that talks directly to Sonic.
        self._silent_audio_task = asyncio.create_task(self._send_silent_audio())

    async def _send_silent_audio(self):
        """Send silent audio to keep Nova Sonic alive.
        
        Matches the original Nova Sonic eval harness pattern:
        - 512-frame chunks (~32ms at 16kHz)
        - 30ms interval between chunks
        - Comfort noise dither on near-zero samples (from SIP bridge pattern)
        
        Reference: https://github.com/aws-samples/sample-amazon-nova-sonic-eval-harness
        "Audio chunking: 512-frame chunks (~32ms at 16kHz), Silent audio interval: 30ms"
        """
        import random
        import struct

        NUM_SAMPLES = 512  # 512 frames = ~32ms at 16kHz (matches original harness)
        INTERVAL = 0.03   # 30ms between chunks (matches original harness)

        def _generate_silence_with_dither():
            """Generate near-silent audio with comfort noise dither (SIP bridge pattern).
            
            Mostly zero with dither applied to near-zero samples (±10 range).
            This matches how the SIP bridge processes decoded μ-law silence.
            """
            # Start with zeros (like decoded μ-law silence from a phone line)
            samples = [0] * NUM_SAMPLES
            # Apply comfort noise dither to all samples (same as SIP bridge)
            for i in range(NUM_SAMPLES):
                if samples[i] > -10 and samples[i] < 10:
                    samples[i] = random.randint(-10, 10)
            return struct.pack(f'<{NUM_SAMPLES}h', *samples)

        try:
            while self.is_active and self.ws:
                if self._audio_paused:
                    await asyncio.sleep(0.01)
                    continue

                audio_data = _generate_silence_with_dither()
                message = {
                    "type": "bidi_audio_input",
                    "audio": base64.b64encode(audio_data).decode("utf-8"),
                    "format": "pcm",
                    "sample_rate": 16000,
                    "channels": 1,
                }
                try:
                    await self.ws.send(json.dumps(message))
                except Exception:
                    break
                await asyncio.sleep(INTERVAL)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"Silent audio loop ended: {e}")

    async def _receive_loop(self):
        """Background task that receives messages from AgentCore and dispatches events."""
        try:
            async for message in self.ws:
                if not self.is_active:
                    break
                try:
                    data = json.loads(message)
                    msg_type = data.get("type", "unknown")
                    # Print non-audio messages for debugging
                    if msg_type not in ("bidi_audio_stream",):
                        print(f"[ADAPTER_RECV] type={msg_type} keys={list(data.keys())}")
                    await self._handle_message(data)
                except json.JSONDecodeError:
                    print(f"[ADAPTER] Non-JSON message: {message[:100]}")
        except websockets.exceptions.ConnectionClosed:
            print("[ADAPTER] WebSocket connection closed")
        except Exception as e:
            print(f"[ADAPTER] Receive loop error: {e}")
        finally:
            self.is_active = False

    async def _handle_message(self, data: Dict[str, Any]):
        """Convert BidiAgent WebSocket messages to eval harness event format.

        BidiAgent event types (from frontend POC.tsx and tac_server.py):
          - bidi_audio_stream: {type, audio} — PCM audio output
          - bidi_transcript_stream: {type, role, text, is_final} — text transcript
          - bidi_interruption: {} — user barge-in
          - system: {type, message} — system messages
          - transcript: {type, role, text} — legacy format (greeting)
          - tool_call: {type, tool, args} — tool invocation started
          - tool_result: {type, tool, result} — tool returned result
          - tool_use_stream: {type, delta, current_tool_use} — tool use streaming
          - sessionEnd: agent/server ended the session — stop conversation loop
        """
        msg_type = data.get("type", "")

        if msg_type == "sonic_session_info":
            # Capture the Sonic completion/session ID from the agent
            self.sonic_session_id = data.get("sonic_session_id")
            logger.info(f"Captured Sonic session ID: {self.sonic_session_id}")
            return

        if msg_type == "sessionEnd":
            reason = data.get("reason", "unknown")
            logger.info(f"Received sessionEnd from agent (reason={reason}) — stopping conversation loop")
            self.is_active = False
            if self.event_callback:
                await self.event_callback({
                    "type": "session_end",
                    "reason": reason,
                    "message": data.get("message", "Session ended by agent."),
                    "sonic_session_id": self.sonic_session_id,
                })
            return

        if msg_type == "tool_call":
            logger.info(f"Tool call: {data.get('tool','')}")
            now = time.time()
            self._tool_call_start_ts = now
            # Track tool event for current turn
            self._current_turn_tools.append({
                "tool_name": data.get("tool", ""),
                "tool_args": data.get("args", {}),
                "tool_result": None,  # Will be filled by tool_result event
                "call_ts": now,
                "result_ts": None,
            })
            self._latency_events.append({"type": "tool_call", "tool": data.get("tool", ""), "ts": now})
            # Fire tool_use event to eval harness for inclusion in conversation log
            if self.event_callback:
                tool_event = {
                    "type": "tool_use",
                    "tool_name": data.get("tool", ""),
                    "tool_args": data.get("args", {}),
                    "sonic_session_id": self.sonic_session_id,
                }
                await self.event_callback(tool_event)

        elif msg_type == "tool_result":
            tool_name = data.get("tool", data.get("tool_result", ""))
            result_text = data.get("result", "")
            now = time.time()
            logger.info(f"Tool result: {tool_name}")
            # Update the last tool event with its result and timestamp
            tool_latency_ms = 0
            if self._current_turn_tools:
                for te in reversed(self._current_turn_tools):
                    if te["tool_name"] == tool_name and te["tool_result"] is None:
                        te["tool_result"] = result_text
                        te["result_ts"] = now
                        tool_latency_ms = int((now - te["call_ts"]) * 1000)
                        self._current_turn_tool_latencies.append({
                            "tool_name": tool_name,
                            "latency_ms": tool_latency_ms,
                        })
                        break
                else:
                    # No matching tool_call found — append as standalone
                    self._current_turn_tools.append({
                        "tool_name": tool_name,
                        "tool_args": {},
                        "tool_result": result_text,
                        "call_ts": self._tool_call_start_ts or now,
                        "result_ts": now,
                    })
            self._latency_events.append({"type": "tool_result", "tool": tool_name, "ts": now, "latency_ms": tool_latency_ms})
            self._last_tool_result_ts = now
            # Fire tool_result event to eval harness
            if self.event_callback:
                result_event = {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "tool_result": result_text,
                    "sonic_session_id": self.sonic_session_id,
                }
                await self.event_callback(result_event)

        elif msg_type == "tool_use_stream":
            pass  # Tool streaming — no action needed

        if msg_type == "bidi_transcript_stream":
            # This is the key event — agent's text response
            role = data.get("role", "assistant")
            text = data.get("text", "")
            is_final = data.get("is_final", True)
            now = time.time()

            if role in ("assistant", "agent", "ASSISTANT"):
                # Track time to first token
                if text and self._first_text_ts == 0.0:
                    self._first_text_ts = now
                    self._latency_events.append({"type": "first_text", "ts": now})

                # Map to eval harness's expected text_output event
                generation_stage = "FINAL" if is_final else "SPECULATIVE"

                # Fire content_start before text (harness needs this to set current_role)
                if text:
                    start_event = {
                        "type": "content_start",
                        "role": "ASSISTANT",
                        "generation_stage": generation_stage,
                        "sonic_session_id": self.sonic_session_id,
                    }
                    if self.event_callback:
                        await self.event_callback(start_event)

                # Fire text_output with 'content' field (harness reads event['content'])
                event = {
                    "type": "text_output",
                    "content": text,
                    "role": "ASSISTANT",
                    "generation_stage": generation_stage,
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(event)

                # Fire content_end after text
                if text:
                    end_event = {
                        "type": "content_end",
                        "generation_stage": generation_stage,
                        "sonic_session_id": self.sonic_session_id,
                    }
                    if self.event_callback:
                        await self.event_callback(end_event)

            elif role == "user":
                # User transcription (Nova Sonic echoes back what it heard)
                start_event = {
                    "type": "content_start",
                    "role": "USER",
                    "generation_stage": "FINAL",
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(start_event)

                event = {
                    "type": "text_output",
                    "content": text,
                    "role": "USER",
                    "generation_stage": "FINAL",
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(event)

        elif msg_type == "bidi_audio_stream":
            # Audio output from the agent — capture for recording
            audio_b64 = data.get("audio", "")
            now = time.time()
            if audio_b64:
                self._output_audio_chunks.append(base64.b64decode(audio_b64))
                # Track time to first audio byte
                if self._first_audio_ts == 0.0:
                    self._first_audio_ts = now
                    self._latency_events.append({"type": "first_audio", "ts": now})
                # Track tool-to-speech: first audio after last tool result
                if self._last_tool_result_ts > 0 and self._first_audio_after_tool_ts == 0.0:
                    self._first_audio_after_tool_ts = now
                    self._latency_events.append({"type": "first_audio_after_tool", "ts": now})
                # Update agent speaking end timestamp (last audio received)
                self._agent_speaking_end_ts = now
            event = {
                "type": "audio_output",
                "audio": audio_b64,
                "sonic_session_id": self.sonic_session_id,
            }
            if self.event_callback:
                await self.event_callback(event)

        elif msg_type == "bidi_interruption":
            # User barged in
            self._interruption_count += 1
            self._latency_events.append({"type": "interruption", "ts": time.time()})
            event = {
                "type": "content_end",
                "generation_stage": "INTERRUPTED",
                "sonic_session_id": self.sonic_session_id,
            }
            if self.event_callback:
                await self.event_callback(event)

        elif msg_type == "transcript":
            # Legacy format (greeting text)
            text = data.get("text", "")
            role = data.get("role", "agent")
            if text and role in ("assistant", "agent"):
                start_event = {
                    "type": "content_start",
                    "role": "ASSISTANT",
                    "generation_stage": "FINAL",
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(start_event)

                event = {
                    "type": "text_output",
                    "content": text,
                    "role": "ASSISTANT",
                    "generation_stage": "FINAL",
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(event)

                end_event = {
                    "type": "content_end",
                    "generation_stage": "FINAL",
                    "sonic_session_id": self.sonic_session_id,
                }
                if self.event_callback:
                    await self.event_callback(end_event)

        elif msg_type == "error":
            logger.error(f"AgentCore error: {data.get('message', '')}")

        elif msg_type == "system":
            logger.info(f"AgentCore system: {data.get('message', '')}")

    async def send_text(self, text: str):
        """Send text input to the agent (simulating user speech transcription)."""
        if not self.ws or not self.is_active:
            raise RuntimeError("WebSocket not connected")

        # Mark user input timing
        now = time.time()
        self._user_input_end_ts = now
        self._first_text_ts = 0.0  # Reset for new turn
        self._first_audio_ts = 0.0
        self._tool_call_start_ts = 0.0
        self._last_tool_result_ts = 0.0
        self._first_audio_after_tool_ts = 0.0
        self._agent_speaking_end_ts = 0.0  # Reset so we capture fresh end for this turn
        self._current_turn_tool_latencies = []
        self._latency_events.append({"type": "user_input_end", "ts": now})

        message = {
            "type": "bidi_text_input",
            "text": text,
        }
        await self.ws.send(json.dumps(message))
        print(f"[ADAPTER] Sent text to agent: {text[:80]}...")

    async def send_text_message(self, text: str):
        """Alias for send_text — matches SonicStreamManager interface."""
        await self.send_text(text)

    async def send_audio(self, audio_data: bytes):
        """Send audio input to the agent."""
        if not self.ws or not self.is_active:
            raise RuntimeError("WebSocket not connected")

        # Capture user audio for recording (Polly TTS audio)
        self._input_audio_chunks.append(audio_data)

        message = {
            "type": "bidi_audio_input",
            "audio": base64.b64encode(audio_data).decode("utf-8"),
            "format": "pcm",
            "sample_rate": 16000,
            "channels": 1,
        }
        await self.ws.send(json.dumps(message))

        if self.input_audio_callback:
            self.input_audio_callback(audio_data)

    async def send_audio_input(self, audio_data: bytes, **kwargs):
        """Send audio input to the agent in chunks — matches SonicStreamManager.send_audio_input interface."""
        # Pause silent audio while sending real audio
        self._audio_paused = True
        await asyncio.sleep(0.1)

        # Capture user audio for recording
        self._input_audio_chunks.append(audio_data)

        # Mark user input timing (audio completion happens after all chunks sent)
        self._first_text_ts = 0.0  # Reset for new turn
        self._first_audio_ts = 0.0
        self._tool_call_start_ts = 0.0
        self._last_tool_result_ts = 0.0
        self._first_audio_after_tool_ts = 0.0
        self._agent_speaking_end_ts = 0.0  # Reset so we capture fresh end for this turn
        self._current_turn_tool_latencies = []

        # Send in chunks (3200 bytes = 100ms at 16kHz 16-bit mono)
        CHUNK_SIZE = 3200
        for i in range(0, len(audio_data), CHUNK_SIZE):
            chunk = audio_data[i:i + CHUNK_SIZE]
            message = {
                "type": "bidi_audio_input",
                "audio": base64.b64encode(chunk).decode("utf-8"),
                "format": "pcm",
                "sample_rate": 16000,
                "channels": 1,
            }
            if self.ws and self.is_active:
                await self.ws.send(json.dumps(message))
            await asyncio.sleep(0.01)  # ~10ms between chunks (simulates real-time)

        # Mark end of user audio input
        now = time.time()
        self._user_input_end_ts = now
        self._latency_events.append({"type": "user_input_end", "ts": now})

        # Resume silent audio after a pause for the agent to process
        await asyncio.sleep(0.5)
        self._audio_paused = False

    async def close_stream(self):
        """Close the WebSocket connection."""
        self.is_active = False

        # Stop silent audio
        if hasattr(self, '_silent_audio_task') and self._silent_audio_task and not self._silent_audio_task.done():
            self._silent_audio_task.cancel()
            try:
                await self._silent_audio_task
            except (asyncio.CancelledError, Exception):
                pass

        if self.ws:
            try:
                # Send session end
                await self.ws.send(json.dumps({"type": "sessionEnd"}))
                await self.ws.close()
            except Exception:
                pass
            self.ws = None

        if self.receive_task and not self.receive_task.done():
            self.receive_task.cancel()
            try:
                await self.receive_task
            except (asyncio.CancelledError, Exception):
                pass

    # --- Compatibility methods expected by eval harness ---

    def get_output_audio_wav(self) -> bytes:
        """Get all captured agent output audio as a WAV file (16kHz 16-bit mono)."""
        # Flush current turn
        if self._output_audio_chunks or self._input_audio_chunks:
            self.mark_turn_boundary()

        # Combine all output turns
        all_pcm = b''.join(output_pcm for _, output_pcm, _ in self._turn_audio if output_pcm)
        if not all_pcm:
            return b''

        return self._pcm_to_wav(all_pcm)

    def get_turn_audio_wavs(self) -> list:
        """Get per-turn audio as list of (turn_number, output_wav_bytes, input_wav_bytes)."""
        # Flush current turn
        if self._output_audio_chunks or self._input_audio_chunks:
            self.mark_turn_boundary()

        result = []
        for turn_num, output_pcm, input_pcm in self._turn_audio:
            output_wav = self._pcm_to_wav(output_pcm) if output_pcm else b''
            input_wav = self._pcm_to_wav(input_pcm) if input_pcm else b''
            result.append((turn_num, output_wav, input_wav))
        return result

    def mark_turn_boundary(self):
        """Mark the end of a conversation turn — saves current audio buffer and computes latencies."""
        self._current_turn_num += 1
        output_pcm = b''.join(self._output_audio_chunks) if self._output_audio_chunks else b''
        input_pcm = b''.join(self._input_audio_chunks) if self._input_audio_chunks else b''
        self._turn_audio.append((self._current_turn_num, output_pcm, input_pcm))
        self._output_audio_chunks = []
        self._input_audio_chunks = []

        # Compute latency metrics for this turn
        turn_latency = {
            "turn": self._current_turn_num,
            "ttft_ms": None,  # Time to first token (user input end → first text)
            "ttfb_ms": None,  # Time to first byte (user input end → first audio)
            "turn_response_ms": None,  # User input end → first audio (same as TTFB for voice)
            "turn_taking_ms": None,  # Previous agent speaking end → current first audio (full gap)
            "tool_to_speech_ms": None,  # Last tool_result → first audio after tool
            "total_turn_ms": None,  # User input end → agent last audio
            "tool_latencies": self._current_turn_tool_latencies.copy(),
            "total_tool_ms": 0,  # Sum of all tool execution times
        }

        if self._user_input_end_ts > 0:
            if self._first_text_ts > 0:
                turn_latency["ttft_ms"] = int((self._first_text_ts - self._user_input_end_ts) * 1000)
            if self._first_audio_ts > 0:
                turn_latency["ttfb_ms"] = int((self._first_audio_ts - self._user_input_end_ts) * 1000)
                turn_latency["turn_response_ms"] = turn_latency["ttfb_ms"]
            if self._agent_speaking_end_ts > 0 and self._agent_speaking_end_ts > self._user_input_end_ts:
                turn_latency["total_turn_ms"] = int((self._agent_speaking_end_ts - self._user_input_end_ts) * 1000)

        # Turn-taking latency: previous agent speaking end → current agent first audio
        # This measures the full conversational gap the caller experiences
        if self._prev_agent_speaking_end_ts > 0 and self._first_audio_ts > 0:
            turn_latency["turn_taking_ms"] = int((self._first_audio_ts - self._prev_agent_speaking_end_ts) * 1000)

        # Tool-to-speech: time from last tool result to first audio after that tool
        if self._last_tool_result_ts > 0 and self._first_audio_after_tool_ts > 0:
            turn_latency["tool_to_speech_ms"] = int((self._first_audio_after_tool_ts - self._last_tool_result_ts) * 1000)

        if self._current_turn_tool_latencies:
            turn_latency["total_tool_ms"] = sum(t["latency_ms"] for t in self._current_turn_tool_latencies)

        self._turn_latencies.append(turn_latency)

        # Save current agent speaking end for next turn's turn-taking calculation
        if self._agent_speaking_end_ts > 0:
            self._prev_agent_speaking_end_ts = self._agent_speaking_end_ts

        # Reset per-turn timing
        self._user_input_end_ts = 0.0
        self._first_text_ts = 0.0
        self._first_audio_ts = 0.0
        self._tool_call_start_ts = 0.0
        self._last_tool_result_ts = 0.0
        self._first_audio_after_tool_ts = 0.0
        self._current_turn_tool_latencies = []

    def get_latency_metrics(self) -> dict:
        """Get aggregated latency metrics across all turns.

        Returns a dict with:
          - turnLatencies: per-turn breakdown
          - summary: aggregated min/max/avg/p95 for each metric
          - toolLatencies: all tool calls with individual execution times
        """
        # Flush current turn if needed
        if self._user_input_end_ts > 0 or self._output_audio_chunks:
            self.mark_turn_boundary()

        # Collect non-null values for each metric
        ttft_values = [t["ttft_ms"] for t in self._turn_latencies if t["ttft_ms"] is not None]
        ttfb_values = [t["ttfb_ms"] for t in self._turn_latencies if t["ttfb_ms"] is not None]
        all_tool_latencies = []
        for t in self._turn_latencies:
            all_tool_latencies.extend(t.get("tool_latencies", []))

        tool_ms_values = [tl["latency_ms"] for tl in all_tool_latencies]

        def _stats(values):
            if not values:
                return None
            sorted_vals = sorted(values)
            n = len(sorted_vals)
            return {
                "min": sorted_vals[0],
                "max": sorted_vals[-1],
                "avg": int(sum(sorted_vals) / n),
                "p50": sorted_vals[n // 2],
                "p95": sorted_vals[int(n * 0.95)] if n > 1 else sorted_vals[-1],
                "count": n,
            }

        return {
            "turnLatencies": self._turn_latencies,
            "summary": {
                "ttft": _stats(ttft_values),
                "ttfb": _stats(ttfb_values),
                "toolExecution": _stats(tool_ms_values),
                "toolToSpeech": _stats([t["tool_to_speech_ms"] for t in self._turn_latencies if t.get("tool_to_speech_ms") is not None]),
                "totalTurnDuration": _stats([t["total_turn_ms"] for t in self._turn_latencies if t.get("total_turn_ms") is not None]),
                "turnTaking": _stats([t["turn_taking_ms"] for t in self._turn_latencies if t.get("turn_taking_ms") is not None]),
            },
            "toolLatencies": all_tool_latencies,
            "interruptionCount": self._interruption_count,
            "interruptionRate": round((self._interruption_count / len(self._turn_latencies) * 100) if self._turn_latencies else 0, 1),
            "coldStartDeltaMs": (ttfb_values[0] - int(sum(ttfb_values[1:]) / len(ttfb_values[1:]))) if len(ttfb_values) >= 2 else None,
        }

    @staticmethod
    def _pcm_to_wav(pcm_data: bytes) -> bytes:
        """Convert raw PCM to WAV (16kHz, 16-bit, mono)."""
        import struct
        import io

        sample_rate = 16000
        bits_per_sample = 16
        channels = 1
        byte_rate = sample_rate * channels * bits_per_sample // 8
        block_align = channels * bits_per_sample // 8
        data_size = len(pcm_data)

        buf = io.BytesIO()
        buf.write(b'RIFF')
        buf.write(struct.pack('<I', 36 + data_size))
        buf.write(b'WAVE')
        buf.write(b'fmt ')
        buf.write(struct.pack('<I', 16))
        buf.write(struct.pack('<H', 1))
        buf.write(struct.pack('<H', channels))
        buf.write(struct.pack('<I', sample_rate))
        buf.write(struct.pack('<I', byte_rate))
        buf.write(struct.pack('<H', block_align))
        buf.write(struct.pack('<H', bits_per_sample))
        buf.write(b'data')
        buf.write(struct.pack('<I', data_size))
        buf.write(pcm_data)
        return buf.getvalue()

    async def end_audio_content(self):
        """No-op for compatibility — AgentCore handles audio lifecycle."""
        pass

    async def mark_turn_complete(self, *args, **kwargs):
        """Mark a turn as complete — saves audio buffer and tool events for this turn."""
        # Save tool events for this turn
        if self._current_turn_tools:
            self._tool_events.append(self._current_turn_tools[:])
        else:
            self._tool_events.append([])
        self._current_turn_tools = []
        self.mark_turn_boundary()

    async def start_audio_input(self):
        """No-op for compatibility."""
        pass

    async def inject_audio(self, audio_data: bytes):
        """Send real audio (e.g., from Polly TTS) to AgentCore."""
        await self.send_audio(audio_data)

    def pause_silent_audio(self):
        """No-op for compatibility."""
        pass

    def resume_silent_audio(self):
        """No-op for compatibility."""
        pass
