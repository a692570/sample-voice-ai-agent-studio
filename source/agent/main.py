"""
AgentCore Runtime entrypoint.

Uses BedrockAgentCoreApp for WebSocket support on AgentCore Runtime.
The WebSocket is already accepted by the framework before the handler is called.
"""

import asyncio
import json
import logging
import os

from bedrock_agentcore.runtime import BedrockAgentCoreApp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
VOICE = os.environ.get("VOICE", "tiffany")

app = BedrockAgentCoreApp()


@app.websocket
async def websocket_handler(websocket, request_context=None):
    """Handle bidirectional voice streaming via WebSocket."""
    logger.info("WebSocket connection established")
    call_logger = None

    try:
        # Accept the WebSocket connection
        await websocket.accept()

        # Wait for session config message
        raw = await websocket.receive_text()
        config_msg = json.loads(raw)

        if config_msg.get("type") not in ("sessionConfig", "config"):
            await websocket.send_text(json.dumps({"type": "error", "message": "Expected sessionConfig event"}))
            return

        logger.info(f"Session configured: {config_msg.get('clientId', 'unknown')}")
        logger.info(f"Session config keys: {list(config_msg.keys())}, tools_count={len(config_msg.get('customTools',[]))}")
        if config_msg.get('customTools'):
            logger.info(f"CustomTools received: {[t.get('name','?') for t in config_msg.get('customTools',[])]}")
        else:
            logger.warning(f"No customTools in session config! Full config (truncated): {json.dumps(config_msg, default=str)[:500]}")

        # Import and create BidiAgent
        from strands.experimental.bidi import BidiAgent
        from strands.experimental.bidi.models import BedrockNovaSonicModel

        voice_id = config_msg.get("voice", {}).get("voiceId", VOICE) or VOICE
        system_prompt = config_msg.get("systemPrompt", "You are a helpful voice assistant.")
        agent_start_first = config_msg.get("agentStartFirst", True)
        sonic_model_id = config_msg.get("modelId", MODEL_ID) or MODEL_ID
        inference_config = config_msg.get("inferenceConfig", {})

        # ── Initialize call history logger (enabled by default) ────────────────────
        if config_msg.get("callHistoryEnabled", True) is not False:
            try:
                from call_history_logger import CallHistoryLogger
                call_history_bucket = os.environ.get("CALL_HISTORY_BUCKET", "")
                source = config_msg.get("source", "webchat")
                call_logger = CallHistoryLogger(
                    agent_id=config_msg.get("agentId", "unknown"),
                    s3_bucket=call_history_bucket,
                    user_id=config_msg.get("userId", ""),
                    source=source,
                    caller_id=config_msg.get("callerId", ""),
                )
                # Per-turn audio tracking
                call_logger._agent_turn_audio = []  # list of (turn_index, chunks[])
                call_logger._user_turn_audio = []   # list of (turn_index, chunks[])
                call_logger._current_agent_chunks = []
                call_logger._current_user_chunks = []
                call_logger._audio_turn_index = 0
                logger.info(f"📝 Call history logging enabled (session={call_logger.session_id}, source={source})")
            except Exception as e:
                logger.warning(f"Call history logger init failed: {e}")
                call_logger = None

        # ── Resolve tools ─────────────────────────────────────────────────
        tool_ids = config_msg.get("tools", [])
        custom_tool_specs = config_msg.get("customTools", [])
        gateway_ids = config_msg.get("gateways", [])  # Auto-discover tools from gateways

        # Extract gateway IDs from tools array (frontend passes them as "gateway:ID")
        tools_array_gateways = [t.replace("gateway:", "") for t in tool_ids if isinstance(t, str) and t.startswith("gateway:")]
        if tools_array_gateways:
            gateway_ids = list(set(gateway_ids + tools_array_gateways))
            tool_ids = [t for t in tool_ids if not (isinstance(t, str) and t.startswith("gateway:"))]
            logger.info(f"Extracted gateway IDs from tools array: {tools_array_gateways}")

        # Extract gateway IDs from system prompt (most reliable — AgentCore always passes systemPrompt)
        import re
        gw_matches = re.findall(r'\[GATEWAY:([^\]]+)\]', system_prompt)
        if gw_matches:
            gateway_ids = list(set(gateway_ids + gw_matches))
            logger.info(f"Extracted gateway IDs from system prompt: {gw_matches}")
            # Remove the gateway tags from the prompt sent to the model
            system_prompt = re.sub(r'\s*\[GATEWAY:[^\]]+\]\s*', ' ', system_prompt).strip()

        # Extract tool config from greeting field (encoded as JSON string to bypass AgentCore field filtering)
        greeting_raw = config_msg.get("greeting", "")
        if greeting_raw and greeting_raw.startswith("{"):
            try:
                tool_payload = json.loads(greeting_raw)
                embedded_tools = tool_payload.get("customTools", [])
                if embedded_tools and not custom_tool_specs:
                    custom_tool_specs = embedded_tools
                    logger.info(f"Extracted {len(embedded_tools)} tools from greeting payload: {[t.get('name','?') for t in embedded_tools]}")
                # Also extract gateway IDs from embedded tools
                for t in embedded_tools:
                    gw = t.get("gatewayId", "")
                    if gw and gw not in gateway_ids:
                        gateway_ids.append(gw)
            except json.JSONDecodeError:
                pass  # greeting is a normal greeting string, not tool config

        tools = []

        # Auto-discover tools from AgentCore MCP Gateways using MCPClient
        if gateway_ids:
            from strands.tools.mcp.mcp_client import MCPClient
            from mcp.client.streamable_http import streamablehttp_client
            import boto3

            region = os.environ.get("AWS_REGION", "us-east-1")

            for gw_id in gateway_ids:
                try:
                    # Get gateway URL
                    agentcore = boto3.client("bedrock-agentcore-control", region_name=region)
                    gw = agentcore.get_gateway(gatewayIdentifier=gw_id)
                    gateway_url = gw.get("gatewayUrl", "")
                    if not gateway_url:
                        logger.warning(f"Gateway {gw_id} has no URL, skipping")
                        continue

                    from botocore.auth import SigV4Auth
                    from botocore.awsrequest import AWSRequest

                    mcp_endpoint = gateway_url if gateway_url.endswith("/mcp") else f"{gateway_url}/mcp"

                    # Create MCPClient with SigV4 auth transport
                    def make_transport(endpoint=mcp_endpoint):
                        _session = boto3.Session()
                        _creds = _session.get_credentials().get_frozen_credentials()
                        _req = AWSRequest(method="POST", url=endpoint, data="", headers={"Content-Type": "application/json"})
                        SigV4Auth(_creds, "bedrock-agentcore", region).add_auth(_req)
                        headers = {k: v for k, v in _req.headers.items() if k.lower() != "content-length"}
                        return streamablehttp_client(endpoint, headers=headers)

                    mcp_client = MCPClient(make_transport)
                    mcp_client.start()
                    mcp_tools = mcp_client.list_tools_sync()
                    logger.info(f"Gateway {gw_id}: discovered {len(mcp_tools)} tools via MCPClient")
                    tools.extend(mcp_tools)
                    # Don't stop the client — tools need it alive for invocation

                except Exception as e:
                    logger.error(f"Failed to connect to gateway {gw_id} via MCPClient: {e}")

        # Pre-built tools from registry
        try:
            from tools import TOOL_REGISTRY
            for tool_id in tool_ids:
                if not tool_id.startswith("int:") and tool_id in TOOL_REGISTRY:
                    tools.append(TOOL_REGISTRY[tool_id])
        except ImportError:
            logger.warning("Could not import TOOL_REGISTRY — no pre-built tools")

        # Dynamic tools from custom specs
        if custom_tool_specs:
            from strands import tool as strands_tool

            for spec in custom_tool_specs:
                name = spec.get("name", "").strip()
                description = spec.get("description", "") or f"Tool: {name}"
                mock_response = spec.get("mockResponse", "")
                endpoint = spec.get("endpoint", "")
                method = spec.get("method", "POST")
                function_arn = spec.get("functionArn", "")
                if not name:
                    continue

                if endpoint and not mock_response:
                    # Live mode: call real webhook endpoint
                    def make_webhook_tool(tool_name, tool_desc, url, http_method):
                        @strands_tool(name=tool_name, description=tool_desc)
                        async def dynamic_tool(**kwargs) -> str:
                            """Tool function."""
                            import urllib.request
                            import urllib.error
                            try:
                                req = urllib.request.Request(
                                    url,
                                    data=json.dumps(kwargs).encode("utf-8") if kwargs else None,
                                    headers={"Content-Type": "application/json"},
                                    method=http_method,
                                )
                                with urllib.request.urlopen(req, timeout=30) as resp:
                                    result = resp.read().decode("utf-8")
                                    return result
                            except Exception as e:
                                err = f"Error calling tool: {str(e)}"
                                return err
                                return f"Error calling tool: {str(e)}"
                        return dynamic_tool
                    tools.append(make_webhook_tool(name, description, endpoint, method))

                elif function_arn and not mock_response:
                    # Live mode: invoke Lambda function
                    def make_lambda_tool(tool_name, tool_desc, arn):
                        @strands_tool(name=tool_name, description=tool_desc)
                        async def dynamic_tool(**kwargs) -> str:
                            """Tool function."""
                            try:
                                lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
                                resp = lambda_client.invoke(
                                    FunctionName=arn,
                                    InvocationType="RequestResponse",
                                    Payload=json.dumps(kwargs).encode("utf-8"),
                                )
                                result = resp["Payload"].read().decode("utf-8")
                                return result
                            except Exception as e:
                                err = f"Error invoking Lambda: {str(e)}"
                                return err
                        return dynamic_tool
                    tools.append(make_lambda_tool(name, description, function_arn))

                elif spec.get("gatewayId") and not mock_response:
                    # Live mode: MCP Gateway — auto-discover tools from gateway
                    gateway_id = spec.get("gatewayId", "")
                    # Skip if already discovered by MCPClient in the gateway_ids section above
                    if gateway_id in gateway_ids:
                        logger.info(f"Skipping gateway {gateway_id} in custom tools — already discovered via MCPClient")
                        continue
                    try:
                        import boto3 as _boto3
                        from botocore.auth import SigV4Auth
                        from botocore.awsrequest import AWSRequest
                        import urllib.request as _urllib_request

                        region = os.environ.get("AWS_REGION", "us-east-1")
                        _agentcore = _boto3.client("bedrock-agentcore-control", region_name=region)
                        _gw = _agentcore.get_gateway(gatewayIdentifier=gateway_id)
                        _gateway_url = _gw.get("gatewayUrl", "")

                        if _gateway_url:
                            _mcp_endpoint = _gateway_url if _gateway_url.endswith("/mcp") else f"{_gateway_url}/mcp"
                            _session = _boto3.Session()
                            _creds = _session.get_credentials().get_frozen_credentials()
                            _list_payload = json.dumps({"jsonrpc": "2.0", "id": "discover", "method": "tools/list"})

                            _aws_req = AWSRequest(method="POST", url=_mcp_endpoint, data=_list_payload, headers={"Content-Type": "application/json"})
                            SigV4Auth(_creds, "bedrock-agentcore", region).add_auth(_aws_req)
                            _req = _urllib_request.Request(url=_mcp_endpoint, data=_list_payload.encode(), headers=dict(_aws_req.headers), method="POST")
                            with _urllib_request.urlopen(_req, timeout=10) as _resp:
                                _mcp_response = json.loads(_resp.read().decode())
                                _discovered = _mcp_response.get("result", {}).get("tools", [])

                            logger.info(f"MCP gateway {gateway_id}: discovered {len(_discovered)} tools")

                            for _tool_def in _discovered:
                                _t_name = _tool_def.get("name", "")
                                _t_desc = _tool_def.get("description", "") or f"Tool from {name}"
                                _t_schema = _tool_def.get("inputSchema", None)
                                if not _t_name:
                                    continue

                                def make_mcp_tool(tool_name, tool_desc, endpoint, schema):
                                    async def dynamic_tool(**kwargs) -> str:
                                        """MCP gateway tool."""
                                        # Handle case where BidiAgent passes all args as single 'kwargs' string
                                        if 'kwargs' in kwargs and len(kwargs) == 1 and isinstance(kwargs['kwargs'], str):
                                            parsed = {}
                                            for pair in kwargs['kwargs'].split(','):
                                                if '=' in pair:
                                                    k, v = pair.strip().split('=', 1)
                                                    parsed[k.strip()] = v.strip()
                                            kwargs = parsed

                                        try:
                                            _s = _boto3.Session()
                                            _c = _s.get_credentials().get_frozen_credentials()
                                            _payload = json.dumps({
                                                "jsonrpc": "2.0",
                                                "id": f"call-{tool_name}",
                                                "method": "tools/call",
                                                "params": {"name": tool_name, "arguments": kwargs},
                                            })
                                            _ar = AWSRequest(method="POST", url=endpoint, data=_payload, headers={"Content-Type": "application/json"})
                                            SigV4Auth(_c, "bedrock-agentcore", region).add_auth(_ar)
                                            _r = _urllib_request.Request(url=endpoint, data=_payload.encode(), headers=dict(_ar.headers), method="POST")
                                            with _urllib_request.urlopen(_r, timeout=30) as _rsp:
                                                _mcp_rsp = json.loads(_rsp.read().decode())
                                            result = _mcp_rsp.get("result", {})
                                            content = result.get("content", [])
                                            if content:
                                                texts = [c.get("text", "") for c in content if c.get("type") == "text"]
                                                result_str = "\n".join(texts) if texts else json.dumps(result)
                                            else:
                                                result_str = json.dumps(result) if result else "Tool returned no content."
                                            return result_str
                                        except Exception as e:
                                            err = f"Error calling MCP tool {tool_name}: {str(e)}"
                                            return err

                                    # Apply decorator WITHOUT inputSchema to avoid Pydantic **kwargs conflict
                                    decorated = strands_tool(name=tool_name, description=tool_desc)(dynamic_tool)
                                    return decorated
                                tools.append(make_mcp_tool(_t_name, _t_desc, _mcp_endpoint, _t_schema))
                        else:
                            logger.warning(f"MCP gateway {gateway_id} has no URL, registering as mock")
                            def make_mock_gw(tool_name, tool_desc):
                                @strands_tool(name=tool_name, description=tool_desc)
                                async def dynamic_tool(**kwargs) -> str:
                                    r = f"[Gateway {gateway_id} not reachable]"
                                    return r
                                return dynamic_tool
                            tools.append(make_mock_gw(name, description))
                    except Exception as e:
                        logger.error(f"Failed to discover tools from gateway {gateway_id}: {e}")
                        # Fallback: register the tool with its spec name
                        def make_fallback_mcp_tool(tool_name, tool_desc, gw_id):
                            @strands_tool(name=tool_name, description=tool_desc)
                            async def dynamic_tool(**kwargs) -> str:
                                err = f"MCP gateway {gw_id} unreachable. Could not discover tools."
                                return err
                            return dynamic_tool
                        tools.append(make_fallback_mcp_tool(name, description, gateway_id))

                elif spec.get("subagentArn") and not mock_response:
                    # Live mode: Sub-agent (A2A) — invoke another AgentCore runtime
                    subagent_arn = spec.get("subagentArn", "")
                    def make_subagent_tool(tool_name, tool_desc, arn):
                        @strands_tool(name=tool_name, description=tool_desc)
                        async def dynamic_tool(**kwargs) -> str:
                            """Tool function."""
                            try:
                                import boto3 as _boto3
                                region = os.environ.get("AWS_REGION", "us-east-1")
                                client = _boto3.client("bedrock-agentcore", region_name=region)
                                # Build natural language query from kwargs
                                query = kwargs.get("query", "")
                                if not query:
                                    if 'kwargs' in kwargs and isinstance(kwargs['kwargs'], str):
                                        # Parse "account_id=123,query=check balance" or "account_id: 123, query: check balance" format
                                        parts = {}
                                        raw = kwargs['kwargs']
                                        # Detect separator: '=' or ': '
                                        if '=' in raw:
                                            for pair in raw.split(','):
                                                if '=' in pair:
                                                    k, v = pair.strip().split('=', 1)
                                                    parts[k.strip()] = v.strip()
                                        elif ': ' in raw:
                                            # Colon-space separated (BidiAgent format)
                                            # Split on ", key:" pattern to handle values with commas
                                            import re as _re
                                            tokens = _re.split(r',\s*(?=\w+:)', raw)
                                            for token in tokens:
                                                if ':' in token:
                                                    k, v = token.strip().split(':', 1)
                                                    parts[k.strip()] = v.strip()
                                        # Build natural language query with context
                                        query_text = parts.get('query', '')
                                        account_id = parts.get('account_id', '')
                                        if query_text and account_id:
                                            query = f"{query_text} for account {account_id}"
                                        elif query_text:
                                            query = query_text
                                        elif account_id:
                                            query = f"Check account {account_id}"
                                        else:
                                            query = ', '.join(f"{k}: {v}" for k, v in parts.items()) if parts else raw
                                    else:
                                        query = json.dumps(kwargs)

                                # A2A protocol requires JSON-RPC with method "message/send"
                                import uuid as _uuid
                                a2a_payload = {
                                    "jsonrpc": "2.0",
                                    "id": "1",
                                    "method": "message/send",
                                    "params": {
                                        "message": {
                                            "messageId": str(_uuid.uuid4()),
                                            "role": "user",
                                            "parts": [{"kind": "text", "text": query}]
                                        }
                                    }
                                }

                                response = client.invoke_agent_runtime(
                                    agentRuntimeArn=arn,
                                    accountId=os.environ.get("AWS_ACCOUNT_ID", "307857433580"),
                                    payload=json.dumps(a2a_payload).encode("utf-8"),
                                    contentType="application/json",
                                    accept="application/json",
                                )
                                # Read response body
                                output = ""
                                resp_body = response.get("response", response.get("body", response.get("payload", b"")))

                                if hasattr(resp_body, "read"):
                                    raw = resp_body.read()
                                    output = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
                                elif isinstance(resp_body, bytes):
                                    output = resp_body.decode("utf-8")
                                elif isinstance(resp_body, str):
                                    output = resp_body
                                else:
                                    output = str(resp_body)

                                # Parse A2A response to extract agent's text
                                if output:
                                    try:
                                        a2a_resp = json.loads(output)
                                        result = a2a_resp.get("result", {})
                                        # Try artifacts (newer A2A format)
                                        artifacts = result.get("artifacts", [])
                                        if artifacts:
                                            parts = artifacts[0].get("parts", [])
                                            texts = [p.get("text", "") for p in parts if p.get("kind") == "text"]
                                            if texts:
                                                output = "\n".join(texts)
                                        # Try status.message (task format)
                                        elif result.get("status", {}).get("message", {}).get("parts"):
                                            parts = result["status"]["message"]["parts"]
                                            texts = [p.get("text", "") for p in parts if p.get("kind") == "text"]
                                            if texts:
                                                output = "\n".join(texts)
                                        # Try history (last agent message)
                                        elif result.get("history"):
                                            for msg in reversed(result["history"]):
                                                if msg.get("role") == "agent":
                                                    parts = msg.get("parts", [])
                                                    texts = [p.get("text", "") for p in parts if p.get("kind") == "text"]
                                                    if texts:
                                                        output = "\n".join(texts)
                                                        break
                                    except (json.JSONDecodeError, KeyError, IndexError):
                                        pass  # Keep raw output

                                if not output:
                                    output = "Sub-agent returned no response."
                                return output
                            except Exception as e:
                                err = f"Error invoking sub-agent: {str(e)}"
                                return err
                        return dynamic_tool
                    tools.append(make_subagent_tool(name, description, subagent_arn))

                elif spec.get("skillPath") and not mock_response:
                    # Live mode: Skill — load skill document and return content
                    skill_path = spec.get("skillPath", "")
                    def make_skill_tool(tool_name, tool_desc, path):
                        @strands_tool(name=tool_name, description=tool_desc)
                        def dynamic_tool(**kwargs) -> str:
                            """Tool function."""
                            try:
                                # Try loading from local bundled file first
                                import os as _os
                                local_path = _os.path.join(_os.path.dirname(__file__), "skills", path)
                                if _os.path.exists(local_path):
                                    with open(local_path, "r") as f:
                                        return f.read()
                                # Try S3
                                import boto3 as _boto3
                                bucket = _os.environ.get("SKILLS_BUCKET", "")
                                if bucket:
                                    s3 = _boto3.client("s3")
                                    obj = s3.get_object(Bucket=bucket, Key=path)
                                    return obj["Body"].read().decode("utf-8")
                                return f"Skill file not found: {path}"
                            except Exception as e:
                                return f"Error loading skill: {str(e)}"
                        return dynamic_tool
                    tools.append(make_skill_tool(name, description, skill_path))

                else:
                    # Mock mode: return static response
                    response_text = mock_response or f"[MOCK] No mock response configured for tool '{name}'. Add one in Tool Management to get realistic test results."
                    def make_tool(tool_name, tool_desc, response):
                        @strands_tool(name=tool_name, description=tool_desc)
                        async def dynamic_tool(**kwargs) -> str:
                            """Tool function."""
                            return response
                        return dynamic_tool
                    tools.append(make_tool(name, description, response_text))

        # ── Resolve RAG knowledge base tools ─────────────────────────────
        rag_ids = [tid for tid in tool_ids if isinstance(tid, str) and tid.startswith("rag:")]
        if rag_ids:
            try:
                from rag_tools import build_rag_tools
                api_url = os.environ.get("API_URL", "")
                rag_tools = build_rag_tools(rag_ids, api_url)
                tools.extend(rag_tools)
                logger.info(f"RAG tools loaded: {len(rag_tools)}")
            except Exception as e:
                logger.warning(f"RAG tool resolution failed: {e}")

        # ── Default built-in tools (available to all agents) ──────────────
        from strands import tool as _strands_tool

        @_strands_tool
        def end_call() -> str:
            """End the call and close the session gracefully. Use this when: the customer says thank you and indicates they are done, the customer says that's all they need, the customer says goodbye, or the conversation has naturally concluded. Before calling this tool, always say a brief closing like 'Thank you for calling, have a great day!' then invoke this tool to disconnect."""
            return "__SESSION_END__"

        @_strands_tool
        def transfer_to_human(reason: str = "") -> str:
            """Transfer the caller to a human agent. Use when the customer explicitly requests a human, or when you cannot resolve their issue after multiple attempts (e.g., failed authentication 3 times)."""
            return f"__TRANSFER__{reason}"

        tools.append(end_call)
        tools.append(transfer_to_human)

        logger.info(f"Tools loaded: {len(tools)} total (including 2 built-in)")

        # ── Create the Nova Sonic model (direct mode) ─────────────────────
        # Nova Sonic handles ASR/TTS and reasons over tools directly.
        _params = {}
        if inference_config:
            _params = {k: v for k, v in {
                "temperature": inference_config.get("temperature"),
                "top_p": inference_config.get("topP"),
                "max_tokens": inference_config.get("maxTokens"),
            }.items() if v is not None}

        model = BedrockNovaSonicModel(
            region=BEDROCK_REGION,
            model_id=sonic_model_id,
            voice=voice_id,
            audio={
                "input": {"sample_rate": 16000},
                "output": {"sample_rate": 16000},
            },
            **({"params": _params} if _params else {}),
        )
        agent = BidiAgent(
            model=model,
            tools=tools if tools else [],
            system_prompt=system_prompt,
        )

        # Emit tool_call / tool_result events over the WebSocket so the UI can
        # show tool activity. Uses the core Strands tool-call hooks.
        from strands.hooks import BeforeToolCallEvent, AfterToolCallEvent

        def _on_before_tool(event: BeforeToolCallEvent):
            nonlocal _tool_executing
            _tool_executing = True  # Block audio during tool execution
            tool_name = event.tool_use.get("name", "unknown")
            tool_input = event.tool_use.get("input", {})
            try:
                import asyncio
                msg = json.dumps({"type": "tool_call", "tool": tool_name, "args": {k: str(v)[:200] for k, v in tool_input.items()} if isinstance(tool_input, dict) else {}})
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(websocket.send_text(msg))
            except Exception:
                pass

        def _on_after_tool(event: AfterToolCallEvent):
            nonlocal _tool_executing
            _tool_executing = False  # Resume audio after tool completes
            tool_name = event.tool_use.get("name", "unknown")
            result = event.result
            result_str = ""
            if isinstance(result, dict):
                content = result.get("content", [])
                if content:
                    result_str = str(content[0].get("text", ""))[:2000]
                else:
                    result_str = json.dumps(result)[:2000]
            elif isinstance(result, Exception):
                result_str = f"Error: {str(result)}"
            else:
                result_str = str(result)[:2000]
            try:
                import asyncio
                msg = json.dumps({"type": "tool_result", "tool": tool_name, "result": result_str})
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(websocket.send_text(msg))
            except Exception:
                pass

        agent.add_hook(_on_before_tool, BeforeToolCallEvent)
        agent.add_hook(_on_after_tool, AfterToolCallEvent)

        logger.info(f"Agent ready [v20]: voice={voice_id}")

        # Acknowledge
        await websocket.send_text(json.dumps({
            "type": "system",
            "message": f"Ready: {sonic_model_id} with voice={voice_id}",
        }))

        # Run bidirectional streaming
        first_input = True
        _tool_executing = False  # Flag to block audio during tool calls

        async def handle_input():
            nonlocal first_input, _tool_executing
            # On first call, trigger agent to speak first based on system prompt
            if first_input and agent_start_first:
                first_input = False
                await agent.send("hi")

            raw_msg = await websocket.receive_text()
            message = json.loads(raw_msg)
            msg_type = message.get("type", "")

            if msg_type == "sessionEnd":
                logger.info("Client requested session end")
                session_ended = True
                # Send acknowledgment and close - finalize happens in finally block
                await websocket.send_text(json.dumps({
                    "type": "sessionEnd",
                    "reason": "client_ended",
                    "message": "Client ended the session.",
                }))
                await websocket.close(1000, "client_ended")
                return None
                await websocket.send_text(json.dumps({
                    "type": "sessionEnd",
                    "reason": "client_ended",
                    "message": "Client ended the session.",
                }))
                await websocket.close(1000, "client_ended")
                return None
            if msg_type == "bidi_audio_input":
                # Drop audio during tool execution to prevent Nova Sonic stream death
                if _tool_executing:
                    # Silently consume the message — don't forward to BidiAgent/Nova Sonic
                    return await handle_input()  # Get next message instead
                # Capture user audio for call history (per-turn)
                if call_logger and message.get("audio"):
                    import base64
                    try:
                        user_audio = base64.b64decode(message["audio"])
                        call_logger._current_user_chunks.append(user_audio)
                        # Log first capture for debugging
                        if len(call_logger._current_user_chunks) == 1:
                            logger.info(f"[user_audio] First chunk captured: {len(user_audio)} bytes, first 10 bytes: {user_audio[:10].hex()}")
                    except Exception as e:
                        logger.warning(f"[user_audio] decode error: {e}")
                # strands 1.57.0 input contract: send an audio_delta dict with the
                # RAW audio bytes (base64-decoded), not the browser's base64 string.
                import base64 as _b64
                try:
                    _audio_bytes = _b64.b64decode(message.get("audio", ""))
                except Exception:
                    _audio_bytes = b""
                return {
                    "audio_delta": {
                        "format": message.get("format", "pcm"),
                        "source": {"bytes": _audio_bytes},
                    }
                }
            elif msg_type in ("bidi_text_input", "text_input"):
                text = message.get("text", "")
                if text:
                    # Return text string — BidiAgent processes it as text input
                    # (transcript is captured from bidi_transcript_stream in send_output)
                    return text
                # Empty text — skip and get next message
                return await handle_input()
            else:
                # Unknown message type — skip it and wait for next valid input
                # (prevents BidiAgent crash on unrecognized event types)
                return await handle_input()

        session_ended = False

        async def send_output(event_dict):
            nonlocal session_ended
            if session_ended:
                return

            # Check for session control signals from built-in tools
            content = str(event_dict.get("content", ""))
            if "__SESSION_END__" in content:
                session_ended = True
                await websocket.send_text(json.dumps({
                    "type": "sessionEnd",
                    "reason": "agent_ended",
                    "message": "The agent has ended the call.",
                }))
                await websocket.close(1000, "agent_ended")
                return
            if "__TRANSFER__" in content:
                session_ended = True
                reason = content.split("__TRANSFER__", 1)[1] if "__TRANSFER__" in content else ""
                await websocket.send_text(json.dumps({
                    "type": "transfer",
                    "reason": reason.strip(),
                    "message": "Transferring to a human agent.",
                }))
                await websocket.close(1000, "transfer")
                return

            # Log output for call history BEFORE sending (send can throw if client disconnected)
            if call_logger and isinstance(event_dict, dict):
                evt_type = event_dict.get("type", "")
                if evt_type == "bidi_transcript_stream":
                    role = event_dict.get("role", "assistant").lower()
                    is_final = event_dict.get("is_final", False)
                    current_transcript = event_dict.get("current_transcript", "")
                    if is_final and current_transcript:
                        if role == "assistant":
                            call_logger.log_assistant_text(current_transcript)
                            call_logger.log_event("out", "text_output", text=current_transcript[:500])
                            turn_idx = len(call_logger.transcript_turns) - 1
                            if call_logger._current_agent_chunks:
                                call_logger._agent_turn_audio.append((turn_idx, list(call_logger._current_agent_chunks)))
                                call_logger._current_agent_chunks = []
                        elif role == "user":
                            call_logger.log_user_text(current_transcript)
                            call_logger.log_event("in", "user_transcript", text=current_transcript[:500])
                            turn_idx = len(call_logger.transcript_turns) - 1
                            if call_logger._current_user_chunks:
                                call_logger._user_turn_audio.append((turn_idx, list(call_logger._current_user_chunks)))
                                call_logger._current_user_chunks = []
                        # Clear pending transcript since final was logged
                        call_logger._last_transcript = None
                    elif not is_final and current_transcript:
                        call_logger._last_transcript = (role, current_transcript)
                elif evt_type == "text" and event_dict.get("text"):
                    call_logger.log_assistant_text(event_dict["text"])
                    call_logger.log_event("out", "text_output", text=event_dict["text"][:500])
                elif evt_type == "bidi_audio_stream" and event_dict.get("audio"):
                    import base64
                    try:
                        audio_bytes = base64.b64decode(event_dict["audio"])
                        call_logger._current_agent_chunks.append(audio_bytes)
                        call_logger.log_audio_chunk(audio_bytes)  # Also keep combined for backward compat
                    except Exception:
                        pass
                elif evt_type == "bidi_audio_output" and event_dict.get("data"):
                    import base64
                    try:
                        audio_bytes = base64.b64decode(event_dict["data"])
                        call_logger._current_agent_chunks.append(audio_bytes)
                        call_logger.log_audio_chunk(audio_bytes)
                    except Exception:
                        pass
                elif evt_type == "tool_use_stream":
                    call_logger.log_event("out", "tool_call", tool=event_dict.get("tool", ""), args=event_dict.get("args", {}))

            await websocket.send_text(json.dumps(event_dict))

        await agent.run(inputs=[handle_input], outputs=[send_output])

    except Exception as e:
        logger.error(f"Session error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        if call_logger:
            try:
                # Flush any pending non-final transcript
                if hasattr(call_logger, '_last_transcript') and call_logger._last_transcript:
                    role, text = call_logger._last_transcript
                    if role == "assistant":
                        call_logger.log_assistant_text(text)
                    elif role == "user":
                        call_logger.log_user_text(text)
                await call_logger.finalize(end_reason="session_ended")
                logger.info(f"Call history finalized: {len(call_logger.transcript_turns)} turns")
            except Exception as e:
                logger.warning(f"Call history finalize error: {e}")
        logger.info("Session closed")


async def handle_text_converse(text: str, system_prompt: str) -> str:
    """Handle text input using Bedrock Converse API (Nova Lite).
    
    For telephony: Twilio handles STT/TTS, agent does text reasoning.
    Same pattern as the TAC reference architecture.
    """
    import boto3

    try:
        client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
        response = client.converse(
            modelId="amazon.nova-lite-v1:0",
            messages=[{"role": "user", "content": [{"text": text}]}],
            system=[{"text": system_prompt}],
            inferenceConfig={"maxTokens": 512, "temperature": 0.7},
        )
        output_msg = response.get("output", {}).get("message", {})
        content = output_msg.get("content", [])
        if content:
            return content[0].get("text", "I couldn't generate a response.")
        return "I couldn't generate a response."
    except Exception as e:
        logger.error(f"Converse API error: {e}")
        return "I'm sorry, I encountered an error processing your request."


if __name__ == "__main__":
    app.run()
