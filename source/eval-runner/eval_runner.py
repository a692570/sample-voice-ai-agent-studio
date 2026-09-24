"""
Eval Runner Lambda — Container Image entry point.

Runs a single eval scenario using the nova-sonic-eval-harness.
Invoked asynchronously by the Eval API Lambda (InvocationType=Event).

Reads job config, maps agent DemoConfig to TestConfig, runs the eval harness,
uploads results to S3, and updates DynamoDB with final status.
"""

import asyncio
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import boto3

# Add eval harness to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "nova-sonic-eval-harness"))

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
EVAL_TABLE_NAME = os.environ.get("EVAL_TABLE_NAME", "voice-agent-poc-eval-jobs")
DEMOS_TABLE_NAME = os.environ.get("DEMOS_TABLE_NAME", "voice-agent-poc-demos")
TOOLS_TABLE_NAME = os.environ.get("TOOLS_TABLE_NAME", "voice-agent-poc-tools")
EVAL_RESULTS_BUCKET = os.environ.get("EVAL_RESULTS_BUCKET", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
eval_table = dynamodb.Table(EVAL_TABLE_NAME)
demos_table = dynamodb.Table(DEMOS_TABLE_NAME)
tools_table = dynamodb.Table(TOOLS_TABLE_NAME)
s3_client = boto3.client("s3", region_name=REGION)


def update_job_status(job_id, status, **kwargs):
    """Update job status in DynamoDB."""
    from decimal import Decimal

    now = datetime.now(timezone.utc).isoformat()
    update_expr = "SET #s = :s, updatedAt = :now"
    attr_names = {"#s": "status"}
    attr_values = {":s": status, ":now": now}

    if "error" in kwargs:
        update_expr += ", #err = :err"
        attr_names["#err"] = "error"
        attr_values[":err"] = kwargs["error"]

    if "resultsKey" in kwargs:
        update_expr += ", resultsKey = :rk"
        attr_values[":rk"] = kwargs["resultsKey"]

    if "summary" in kwargs:
        update_expr += ", summary = :sum"
        # Convert floats to Decimals for DynamoDB
        attr_values[":sum"] = _convert_floats(kwargs["summary"])

    if status == "COMPLETED" or status == "FAILED":
        update_expr += ", completedAt = :cat"
        attr_values[":cat"] = now

    if status == "RUNNING":
        update_expr += ", startedAt = :sat"
        attr_values[":sat"] = now

    eval_table.update_item(
        Key={"id": job_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )


def _convert_floats(obj):
    """Recursively convert floats to Decimals for DynamoDB."""
    from decimal import Decimal
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: _convert_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_floats(i) for i in obj]
    return obj


def update_batch_counter(batch_id, field):
    """Atomically increment a batch counter (completed or failed)."""
    try:
        eval_table.update_item(
            Key={"id": batch_id},
            UpdateExpression=f"SET {field} = {field} + :inc, updatedAt = :now",
            ExpressionAttributeValues={
                ":inc": 1,
                ":now": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception:
        pass  # Best effort — batch status is recalculated on read


def map_agent_to_test_config(agent_config, eval_config):
    """Map a DemoConfig (from demos table) + eval params to a TestConfig dict."""
    from core.config_manager import TestConfig

    # Extract system prompt
    system_prompt = agent_config.get("systemPrompt", "")
    prompt_obj = agent_config.get("prompt", {})
    if prompt_obj and prompt_obj.get("instructions"):
        system_prompt = prompt_obj["instructions"]

    # Map tools to Bedrock toolSpec format
    tool_config = None
    custom_tools = agent_config.get("customTools", [])

    # Resolve int:GUID tool references from the tools table
    tool_refs = agent_config.get("tools", [])
    use_mock = eval_config.get("useMock", False)  # Default to live mode for evals

    # Extract gateway: prefixed tools for auto-discovery
    gateway_ids = [ref.replace("gateway:", "") for ref in tool_refs if isinstance(ref, str) and ref.startswith("gateway:")]

    for ref in tool_refs:
        if isinstance(ref, str) and ref.startswith("int:"):
            tool_id = ref.replace("int:", "")
            try:
                result = tools_table.get_item(Key={"id": tool_id})
                tool_item = result.get("Item")
                if tool_item:
                    tool_spec = {
                        "name": tool_item.get("name", "unknown"),
                        "description": tool_item.get("description", ""),
                        "parameters": tool_item.get("parameters", "{}"),
                    }
                    if use_mock:
                        tool_spec["mockResponse"] = tool_item.get("mockResponse", "Tool executed successfully.")
                    else:
                        # Live mode: include real endpoint info
                        if tool_item.get("endpoint"):
                            tool_spec["endpoint"] = tool_item["endpoint"]
                            tool_spec["method"] = tool_item.get("method", "POST")
                        elif tool_item.get("functionArn"):
                            tool_spec["functionArn"] = tool_item["functionArn"]
                        elif tool_item.get("type") == "mcp" and tool_item.get("gatewayId"):
                            tool_spec["gatewayId"] = tool_item["gatewayId"]
                            if tool_item["gatewayId"] not in gateway_ids:
                                gateway_ids.append(tool_item["gatewayId"])
                        elif tool_item.get("type") == "subagent" and tool_item.get("gatewayId"):
                            tool_spec["subagentArn"] = tool_item["gatewayId"]
                        else:
                            # No real integration — fall back to mock
                            tool_spec["mockResponse"] = tool_item.get("mockResponse", "Tool executed successfully.")
                    custom_tools.append(tool_spec)
            except Exception:
                pass  # Skip tools that can't be resolved

    # Add gateway IDs to agent_config tools array for AgentCore passthrough
    if gateway_ids:
        gateway_tool_refs = [f"gateway:{gw}" for gw in gateway_ids]
        agent_config["tools"] = [ref for ref in tool_refs if not ref.startswith("gateway:")] + gateway_tool_refs
        # Also embed in system prompt (reliable passthrough)
        gateway_tags = " ".join([f"[GATEWAY:{gw}]" for gw in gateway_ids])
        system_prompt = f"{system_prompt}\n\n{gateway_tags}"
    else:
        # Ensure rag: and other non-int tools are preserved in the tools array
        agent_config["tools"] = [ref for ref in tool_refs if isinstance(ref, str) and not ref.startswith("int:")]

    # Store customTools back to agent_config for the adapter to use
    agent_config["customTools"] = custom_tools
    # Store tool mode for result reporting
    agent_config["useMock"] = use_mock

    if custom_tools:
        tool_specs = []
        for tool in custom_tools:
            try:
                params = json.loads(tool.get("parameters", "{}")) if isinstance(tool.get("parameters"), str) else tool.get("parameters", {})
            except json.JSONDecodeError:
                params = {}
            tool_specs.append({
                "toolSpec": {
                    "name": tool.get("name", "unknown"),
                    "description": tool.get("description", ""),
                    "inputSchema": {"json": params},
                }
            })
        tool_config = {"tools": tool_specs, "toolChoice": {"auto": {}}}

    # Voice
    voice_config = agent_config.get("voice", {})
    voice_id = voice_config.get("voiceId", "tiffany") if voice_config else "tiffany"

    # Build TestConfig — uses the agent's own model/region since we're targeting AgentCore
    # The eval harness will NOT use this to create a SonicStreamManager directly;
    # instead, the runner injects an AgentCoreStreamManager (see run_eval below).
    config = TestConfig(
        test_name=eval_config.get("testName", "ui-eval"),
        sonic_system_prompt=system_prompt,
        sonic_voice_id=voice_id,
        sonic_tool_config=None,  # Tools handled by AgentCore — judge evaluates from conversation log
        user_model_id=eval_config.get("userModelId", "claude-haiku"),
        user_system_prompt=eval_config.get("userSystemPrompt", ""),
        max_turns=eval_config.get("maxTurns", 5),
        input_mode=eval_config.get("inputMode", "text"),
        auto_evaluate=False,  # We evaluate manually after patching tool results
        evaluation_criteria={
            "evaluation_aspects": eval_config.get("evaluationAspects", ["Goal Achievement"]),
            "rubrics": eval_config.get("rubrics", {}),
        },
        output_directory="/tmp/results",
        hangup_prompt_enabled=eval_config.get("allowHangup", True),
    )

    return config


def upload_results_to_s3(job_id, session):
    """Upload session results to S3 and return the results key prefix."""
    results_prefix = f"eval-results/{job_id}/"

    # Interaction log
    interaction_log = {}
    if hasattr(session, "logger") and session.logger:
        try:
            log = session.logger.get_log()
            interaction_log = log.to_dict() if hasattr(log, "to_dict") else {}
        except Exception:
            pass

    # Inject tool events from the adapter into the interaction log turns
    if hasattr(session, "sonic") and hasattr(session.sonic, "_tool_events"):
        tool_events_by_turn = session.sonic._tool_events
        turns = interaction_log.get("turns", [])
        for i, turn in enumerate(turns):
            if i < len(tool_events_by_turn) and tool_events_by_turn[i]:
                # Filter out dict-named events (BidiAgent internal framework messages)
                # Keep all string-named events as-is — duplicates are real agent behavior
                # that the eval judge should detect and flag
                filtered = [ev for ev in tool_events_by_turn[i] if isinstance(ev.get("tool_name"), str)]
                turn["tool_uses"] = filtered
                # Populate tool_calls[].tool_result from our captured data
                tool_calls = turn.get("tool_calls", [])
                for tc in tool_calls:
                    if tc.get("tool_result") is None:
                        for tu in filtered:
                            if tu["tool_name"] == tc.get("tool_name") and tu.get("tool_result"):
                                tc["tool_result"] = tu["tool_result"]
                                break
        # Also include any unflushed current turn tools
        if session.sonic._current_turn_tools and turns:
            filtered_current = [ev for ev in session.sonic._current_turn_tools if isinstance(ev.get("tool_name"), str)]
            turns[-1]["tool_uses"] = filtered_current
            tool_calls = turns[-1].get("tool_calls", [])
            for tc in tool_calls:
                if tc.get("tool_result") is None:
                    for tu in filtered_current:
                        if tu["tool_name"] == tc.get("tool_name") and tu.get("tool_result"):
                            tc["tool_result"] = tu["tool_result"]
                            break

    # Add conversation end reason to the interaction log
    max_turns = getattr(session, "max_turns", None) or (session.config.max_turns if hasattr(session, "config") else 99)
    total_turns = len(interaction_log.get("turns", []))
    if total_turns >= max_turns:
        interaction_log["conversationEndReason"] = "max_turns_reached"
    elif getattr(session, "_hangup_triggered", False) or (hasattr(session, "config") and getattr(session.config, "hangup_prompt_enabled", False) and total_turns < max_turns):
        interaction_log["conversationEndReason"] = "user_closed"
    else:
        interaction_log["conversationEndReason"] = "completed"

    # Include latency metrics in the interaction log
    if hasattr(session, "sonic") and hasattr(session.sonic, "get_latency_metrics"):
        interaction_log["latencyMetrics"] = session.sonic.get_latency_metrics()

    # Include Sonic session/completion ID if captured
    if hasattr(session, "sonic") and hasattr(session.sonic, "sonic_session_id") and session.sonic.sonic_session_id:
        interaction_log["sonicSessionId"] = session.sonic.sonic_session_id

    s3_client.put_object(
        Bucket=EVAL_RESULTS_BUCKET,
        Key=f"{results_prefix}interaction_log.json",
        Body=json.dumps(interaction_log, default=str),
        ContentType="application/json",
    )

    # Evaluation results (from session's saved evaluation file — includes rubric verdicts)
    evaluation = {}
    if hasattr(session, "evaluation_result") and session.evaluation_result:
        evaluation = session.evaluation_result
    # Try to read the full judge evaluation (includes rubric_verdicts per metric)
    if hasattr(session, "logger") and session.logger:
        try:
            eval_path = session.logger.evaluation_dir / "llm_judge_evaluation.json"
            if eval_path.exists():
                with open(eval_path, "r") as f:
                    evaluation = json.load(f)
        except Exception:
            pass
    s3_client.put_object(
        Bucket=EVAL_RESULTS_BUCKET,
        Key=f"{results_prefix}evaluation.json",
        Body=json.dumps(evaluation, default=str),
        ContentType="application/json",
    )

    # Transcript from logger
    transcript = ""
    if hasattr(session, "logger") and session.logger:
        try:
            log = session.logger.get_log()
            # Build transcript from turns (include tool events)
            turns = log.turns if hasattr(log, "turns") else []
            lines = []
            for turn in turns:
                if hasattr(turn, "user_text") and turn.user_text:
                    lines.append(f"User: {turn.user_text}")
                # Include tool events if available
                if hasattr(turn, "tool_uses") and turn.tool_uses:
                    for tool_use in turn.tool_uses:
                        tool_name = tool_use.get("tool_name", "") if isinstance(tool_use, dict) else getattr(tool_use, "tool_name", "")
                        tool_args = tool_use.get("tool_args", "") if isinstance(tool_use, dict) else getattr(tool_use, "tool_args", "")
                        tool_result = tool_use.get("tool_result", "") if isinstance(tool_use, dict) else getattr(tool_use, "tool_result", "")
                        lines.append(f"🔧 Tool: {tool_name} | Args: {tool_args}")
                        if tool_result:
                            lines.append(f"✅ Result: {tool_result}")
                if hasattr(turn, "assistant_text") and turn.assistant_text:
                    lines.append(f"Assistant: {turn.assistant_text}")
            transcript = "\n".join(lines)
        except Exception:
            pass
    s3_client.put_object(
        Bucket=EVAL_RESULTS_BUCKET,
        Key=f"{results_prefix}transcript.txt",
        Body=transcript,
        ContentType="text/plain",
    )

    # Session metadata
    metadata = {
        "jobId": job_id,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    s3_client.put_object(
        Bucket=EVAL_RESULTS_BUCKET,
        Key=f"{results_prefix}session_metadata.json",
        Body=json.dumps(metadata, default=str),
        ContentType="application/json",
    )

    return results_prefix


def build_summary(session, start_time):
    """Build a denormalized summary from session's evaluation_result."""
    summary = {
        "overallRating": "FAIL",
        "passRate": 0.0,
        "totalTurns": 0,
        "totalToolCalls": 0,
        "toolMode": "mock" if getattr(session, "_use_mock", True) else "live",
        "metricVerdicts": {},
        "metricDetails": {},
        "durationSeconds": int(time.time() - start_time),
        "conversationEndReason": "unknown",
        "latency": None,  # Aggregated latency stats
    }

    # Get evaluation result
    eval_result = getattr(session, "evaluation_result", None)
    if eval_result and isinstance(eval_result, dict):
        # Extract aspect ratings as metric verdicts
        aspect_ratings = eval_result.get("aspect_ratings", {})
        if isinstance(aspect_ratings, dict):
            summary["metricVerdicts"] = {
                k: "PASS" if v is True or v == "PASS" else "FAIL"
                for k, v in aspect_ratings.items()
            }
            # Calculate pass rate from verdicts
            total = len(summary["metricVerdicts"])
            passed = sum(1 for v in summary["metricVerdicts"].values() if v == "PASS")
            summary["passRate"] = passed / total if total > 0 else 0.0
            summary["overallRating"] = "PASS" if passed == total and total > 0 else "FAIL"
        else:
            # Fallback to eval harness's own pass_fail
            summary["overallRating"] = "PASS" if eval_result.get("pass_fail", False) else "FAIL"
            summary["passRate"] = float(eval_result.get("pass_rate", 0.0))

        # Extract detailed reasoning and rubric verdicts per metric
        metric_verdicts_data = eval_result.get("metric_verdicts", {})
        if isinstance(metric_verdicts_data, dict):
            for metric_name, mv_data in metric_verdicts_data.items():
                if isinstance(mv_data, dict):
                    detail = {
                        "reasoning": mv_data.get("reasoning", ""),
                    }
                    # Include rubric verdicts with their reasoning
                    rubric_verdicts = mv_data.get("rubric_verdicts", [])
                    if rubric_verdicts:
                        detail["rubricVerdicts"] = [
                            {
                                "question": rv.get("question", ""),
                                "verdict": "YES" if rv.get("verdict") else "NO",
                                "reasoning": rv.get("reasoning", ""),
                            }
                            for rv in rubric_verdicts
                            if isinstance(rv, dict)
                        ]
                    summary["metricDetails"][metric_name] = detail

        # Include strengths and weaknesses
        if eval_result.get("strengths"):
            summary["strengths"] = eval_result["strengths"]
        if eval_result.get("weaknesses"):
            summary["weaknesses"] = eval_result["weaknesses"]

    # Get turn count from logger
    if hasattr(session, "logger") and session.logger:
        try:
            log = session.logger.get_log()
            turns = log.turns if hasattr(log, "turns") else []
            summary["totalTurns"] = len(turns)
        except Exception:
            summary["totalTurns"] = getattr(session, "current_turn", 0)
    else:
        summary["totalTurns"] = getattr(session, "current_turn", 0)

    # Determine conversation end reason
    max_turns = getattr(session, "max_turns", None) or (session.config.max_turns if hasattr(session, "config") else 99)
    if summary["totalTurns"] >= max_turns:
        summary["conversationEndReason"] = "max_turns_reached"
    elif getattr(session, "_hangup_triggered", False) or (hasattr(session, "config") and getattr(session.config, "hangup_prompt_enabled", False) and summary["totalTurns"] < max_turns):
        summary["conversationEndReason"] = "user_closed"
    else:
        summary["conversationEndReason"] = "completed"

    # Aggregate latency metrics from the adapter
    if hasattr(session, "sonic") and hasattr(session.sonic, "get_latency_metrics"):
        latency_data = session.sonic.get_latency_metrics()
        summary["latency"] = latency_data.get("summary", {})
        summary["totalToolCalls"] = len(latency_data.get("toolLatencies", []))

    return summary


def run_eval(event):
    """Main evaluation logic."""
    job_id = event["jobId"]
    agent_id = event["agentId"]
    eval_config = event["config"]
    batch_id = event.get("batchId")

    start_time = time.time()

    # Check if job was cancelled before we start
    job_resp = eval_table.get_item(Key={"id": job_id})
    job = job_resp.get("Item", {})
    if job.get("status") == "CANCELLED":
        return

    # Update to RUNNING
    update_job_status(job_id, "RUNNING")

    # Get agent config — either from demos table or from job's agentSnapshot (eval suites)
    if agent_id:
        agent_resp = demos_table.get_item(Key={"id": agent_id})
        agent = agent_resp.get("Item")
        if not agent:
            update_job_status(job_id, "FAILED", error="Agent not found")
            if batch_id:
                update_batch_counter(batch_id, "failed")
            return
        agent_config = agent.get("config", agent)
        # Inject modelId from job snapshot (eval-specific override)
        snapshot_model_id = job.get("agentSnapshot", {}).get("modelId")
        if snapshot_model_id:
            agent_config["modelId"] = snapshot_model_id
        # Inject reasonerModel from job snapshot (eval-specific override for Expert Tool mode)
        snapshot_reasoner = job.get("agentSnapshot", {}).get("inferenceConfig", {}).get("reasonerModel", "")
        if snapshot_reasoner:
            agent_config["reasonerModel"] = snapshot_reasoner
        elif not agent_config.get("reasonerModel"):
            # Fall back to agent's own inferenceConfig
            agent_reasoner = agent_config.get("inferenceConfig", {}).get("reasonerModel", "")
            if agent_reasoner:
                agent_config["reasonerModel"] = agent_reasoner
    else:
        # Eval suite run — agent config was snapshotted in the job record by eval_handler
        agent_snapshot = job.get("agentSnapshot", {})
        if not agent_snapshot:
            update_job_status(job_id, "FAILED", error="No agent config: agentId is empty and no agentSnapshot found")
            if batch_id:
                update_batch_counter(batch_id, "failed")
            return
        # Reconstruct agent_config from the snapshot so map_agent_to_test_config works
        # Convert resolved tool objects ({id, name, type}) back to int:GUID refs
        raw_tools = agent_snapshot.get("tools", [])
        tool_refs = []
        for t in raw_tools:
            if isinstance(t, str):
                tool_refs.append(t)  # Already a string ref
            elif isinstance(t, dict) and t.get("id"):
                tid = t["id"]
                # Don't add int: prefix if it already has a prefix (rag:, gateway:, etc.)
                if ':' in tid:
                    tool_refs.append(tid)
                else:
                    tool_refs.append(f"int:{tid}")
            else:
                tool_refs.append(str(t))
        agent_config = {
            "systemPrompt": agent_snapshot.get("systemPrompt", ""),
            "prompt": {"instructions": agent_snapshot.get("systemPrompt", ""), "greeting": ""},
            "tools": tool_refs,
            "customTools": agent_snapshot.get("customTools", []),
            "voice": agent_snapshot.get("voice", {}),
            "inferenceConfig": agent_snapshot.get("inferenceConfig", {}),
            "useMock": eval_config.get("useMock", True),
        }
        # Pass through modelId if specified (Sonic model override)
        if agent_snapshot.get("modelId"):
            agent_config["modelId"] = agent_snapshot["modelId"]
        # Pass through reasonerModel for Expert Tool mode
        reasoner = agent_snapshot.get("inferenceConfig", {}).get("reasonerModel", "")
        if reasoner:
            agent_config["reasonerModel"] = reasoner

    # Map to TestConfig
    try:
        test_config = map_agent_to_test_config(agent_config, eval_config)
    except Exception as e:
        update_job_status(job_id, "FAILED", error=f"Config mapping error: {str(e)}")
        if batch_id:
            update_batch_counter(batch_id, "failed")
        return

    # Run the eval harness against AgentCore
    try:
        # Lambda filesystem is read-only except /tmp
        # Create results dir in /tmp, but keep working dir at harness root for configs
        import os as _os
        _os.makedirs("/tmp/results/sessions", exist_ok=True)
        _os.environ["EVAL_OUTPUT_DIR"] = "/tmp"
        # Change to harness directory so configs/models.yaml is found
        _os.chdir("/var/task/nova-sonic-eval-harness")

        from main import LiveInteractionSession
        from agentcore_adapter import AgentCoreStreamManager

        # Get AgentCore Runtime ARN from environment
        runtime_arn = os.environ.get("AGENTCORE_RUNTIME_ARN", "")
        if not runtime_arn:
            update_job_status(job_id, "FAILED", error="AGENTCORE_RUNTIME_ARN not configured")
            if batch_id:
                update_batch_counter(batch_id, "failed")
            return

        session = LiveInteractionSession(
            config=test_config,
            auto_evaluate=False,  # Evaluate manually after patching tool results
            evaluation_criteria=test_config.evaluation_criteria if hasattr(test_config, "evaluation_criteria") else None,
            session_id=job_id,
        )
        session._use_mock = agent_config.get("useMock", True)

        async def run_with_agentcore():
            # Monkey-patch SonicStreamManager.initialize_stream to no-op
            from core.sonic_stream_manager import SonicStreamManager
            SonicStreamManager.initialize_stream = lambda self: asyncio.sleep(0)

            # Setup creates user simulator, logger, dummy SonicStreamManager
            await session.setup()

            # Replace with AgentCore adapter
            session.sonic = AgentCoreStreamManager(
                runtime_arn=runtime_arn,
                region=REGION,
                agent_config=agent_config,
                event_callback=session.handle_sonic_event,
                tool_handler=session.handle_tool_call if hasattr(session, "handle_tool_call") else None,
                voice_id=test_config.sonic_voice_id,
                system_prompt=test_config.sonic_system_prompt,
            )

            # Connect to AgentCore via presigned WebSocket
            await session.sonic.initialize_stream()

            # Run the conversation (without auto-evaluation)
            await session.run_conversation()

            # Patch tool_calls with actual results from adapter before evaluation
            if hasattr(session, "logger") and session.logger and hasattr(session.sonic, "_tool_events"):
                try:
                    log = session.logger.get_log()
                    turns = log.turns if hasattr(log, "turns") else []
                    tool_events_by_turn = session.sonic._tool_events

                    def _get_full_tool_result(events, tool_name):
                        """Get the full (untruncated) tool result from events.
                        
                        Prefers BidiAgent toolUseId content (full) over our adapter capture (truncated).
                        """
                        # First check BidiAgent toolUseId entries (have full content)
                        for ev in events:
                            name = ev.get("tool_name")
                            if isinstance(name, dict) and name.get("toolUseId"):
                                # This is a BidiAgent content entry — extract full text
                                content = name.get("content", [])
                                if content:
                                    texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("text")]
                                    if texts:
                                        return "\n".join(texts)
                        # Fallback to our adapter capture (may be truncated)
                        for ev in events:
                            if isinstance(ev.get("tool_name"), str) and ev["tool_name"] == tool_name and ev.get("tool_result"):
                                return ev["tool_result"]
                        return None

                    for i, turn in enumerate(turns):
                        if i < len(tool_events_by_turn) and tool_events_by_turn[i]:
                            tool_calls = turn.tool_calls if hasattr(turn, "tool_calls") else []
                            # Group events by tool_name for matching
                            named_events = [e for e in tool_events_by_turn[i] if isinstance(e.get("tool_name"), str)]
                            bidi_events = [e for e in tool_events_by_turn[i] if isinstance(e.get("tool_name"), dict)]
                            
                            for tc_idx, tc in enumerate(tool_calls):
                                tc_name = tc.tool_name if hasattr(tc, "tool_name") else tc.get("tool_name", "")
                                if (hasattr(tc, "tool_result") and tc.tool_result is None) or (isinstance(tc, dict) and tc.get("tool_result") is None):
                                    # Try to find the corresponding BidiAgent content (full result)
                                    # BidiAgent events follow named events in pairs
                                    result = None
                                    # Match by position: named_event[n] is followed by bidi_event[n]
                                    matched_idx = -1
                                    for ne_idx, ne in enumerate(named_events):
                                        if ne["tool_name"] == tc_name:
                                            matched_idx = ne_idx
                                            break
                                    if matched_idx >= 0 and matched_idx < len(bidi_events):
                                        content = bidi_events[matched_idx].get("tool_name", {}).get("content", [])
                                        if content:
                                            texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("text")]
                                            if texts:
                                                result = "\n".join(texts)
                                    # Fallback to our adapter capture
                                    if not result:
                                        for ne in named_events:
                                            if ne["tool_name"] == tc_name and ne.get("tool_result"):
                                                result = ne["tool_result"]
                                                break
                                    if result:
                                        if hasattr(tc, "tool_result"):
                                            tc.tool_result = result
                                        elif isinstance(tc, dict):
                                            tc["tool_result"] = result
                                            
                    # Also patch unflushed current turn
                    if session.sonic._current_turn_tools and turns:
                        last_turn = turns[-1]
                        tool_calls = last_turn.tool_calls if hasattr(last_turn, "tool_calls") else []
                        named_events = [e for e in session.sonic._current_turn_tools if isinstance(e.get("tool_name"), str)]
                        bidi_events = [e for e in session.sonic._current_turn_tools if isinstance(e.get("tool_name"), dict)]
                        for tc in tool_calls:
                            tc_name = tc.tool_name if hasattr(tc, "tool_name") else tc.get("tool_name", "")
                            if (hasattr(tc, "tool_result") and tc.tool_result is None) or (isinstance(tc, dict) and tc.get("tool_result") is None):
                                result = None
                                for ne in named_events:
                                    if ne["tool_name"] == tc_name and ne.get("tool_result"):
                                        result = ne["tool_result"]
                                        break
                                if result:
                                    if hasattr(tc, "tool_result"):
                                        tc.tool_result = result
                                    elif isinstance(tc, dict):
                                        tc["tool_result"] = result
                except Exception:
                    pass

            # Now run evaluation with patched tool results
            if hasattr(session, "run_evaluation") and session.evaluation_criteria:
                try:
                    await session.run_evaluation()
                except Exception as eval_err:
                    import traceback
                    print(f"[EVAL] Evaluation error: {eval_err}\n{traceback.format_exc()}")

            # Close
            await session.sonic.close_stream()

        asyncio.run(run_with_agentcore())

    except Exception as e:
        error_msg = f"Eval execution error: {str(e)}\n{traceback.format_exc()}"
        update_job_status(job_id, "FAILED", error=error_msg[:1000])
        if batch_id:
            update_batch_counter(batch_id, "failed")
        return

    # Upload results to S3
    try:
        results_prefix = upload_results_to_s3(job_id, session)

        # Upload agent output audio per turn as WAV
        if hasattr(session, "sonic") and hasattr(session.sonic, "get_turn_audio_wavs"):
            turn_wavs = session.sonic.get_turn_audio_wavs()
            for turn_num, output_wav, input_wav in turn_wavs:
                if output_wav:
                    s3_client.put_object(
                        Bucket=EVAL_RESULTS_BUCKET,
                        Key=f"{results_prefix}audio/turn_{turn_num}_agent.wav",
                        Body=output_wav,
                        ContentType="audio/wav",
                    )
                if input_wav:
                    s3_client.put_object(
                        Bucket=EVAL_RESULTS_BUCKET,
                        Key=f"{results_prefix}audio/turn_{turn_num}_user.wav",
                        Body=input_wav,
                        ContentType="audio/wav",
                    )
    except Exception as e:
        update_job_status(job_id, "FAILED", error=f"Results upload error: {str(e)}")
        if batch_id:
            update_batch_counter(batch_id, "failed")
        return

    # Build summary and mark complete
    summary = build_summary(session, start_time)

    update_job_status(job_id, "COMPLETED", resultsKey=results_prefix, summary=summary)

    if batch_id:
        update_batch_counter(batch_id, "completed")


def handler(event, context):
    """Lambda handler entry point."""
    try:
        run_eval(event)
    except Exception as e:
        # Last-resort error handling
        job_id = event.get("jobId", "unknown")
        try:
            update_job_status(job_id, "FAILED", error=f"Unhandled error: {str(e)}")
            batch_id = event.get("batchId")
            if batch_id:
                update_batch_counter(batch_id, "failed")
        except Exception:
            pass
        raise
