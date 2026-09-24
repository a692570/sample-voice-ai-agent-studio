"""
Lambda handler for Evaluation API (multi-tenant).

Orchestrates eval harness jobs: creates job records in DynamoDB,
invokes the Eval Runner Lambda asynchronously (one per scenario),
and serves job status/results to the frontend.
All eval jobs are scoped to the authenticated user.

Handles:
  POST   /eval/jobs              — Start a single eval job
  POST   /eval/batches           — Start a batch of eval jobs (fan-out)
  GET    /eval/jobs              — List jobs (filter by agentId, scoped to user)
  GET    /eval/jobs/{id}         — Get job status + summary
  GET    /eval/jobs/{id}/results — Get full results (from S3)
  GET    /eval/batches/{id}      — Get batch status (aggregated)
  DELETE /eval/jobs/{id}         — Cancel a job
"""

import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3

from auth_utils import get_user_context, check_item_access

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
EVAL_TABLE_NAME = os.environ.get("EVAL_TABLE_NAME", "voice-agent-poc-eval-jobs")
DEMOS_TABLE_NAME = os.environ.get("DEMOS_TABLE_NAME", "voice-agent-poc-demos")
EVAL_RESULTS_BUCKET = os.environ.get("EVAL_RESULTS_BUCKET", "")
EVAL_RUNNER_FUNCTION_NAME = os.environ.get("EVAL_RUNNER_FUNCTION_NAME", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
eval_table = dynamodb.Table(EVAL_TABLE_NAME)
demos_table = dynamodb.Table(DEMOS_TABLE_NAME)
lambda_client = boto3.client("lambda", region_name=REGION)
s3_client = boto3.client("s3", region_name=REGION)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
}

MAX_TURNS = 50
MAX_BATCH_SIZE = 10
ALLOWED_INPUT_MODES = ["text", "polly"]


class DecimalEncoder(json.JSONEncoder):
    """Handle Decimal types from DynamoDB."""
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def _convert_floats_to_decimal(obj):
    """Recursively convert floats to Decimals for DynamoDB storage."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: _convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_floats_to_decimal(i) for i in obj]
    return obj


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def validate_eval_config(config):
    """Validate eval job configuration. Returns (cleaned_config, error_message)."""
    errors = []

    test_name = config.get("testName", "").strip()
    if not test_name:
        errors.append("testName is required")

    max_turns = config.get("maxTurns", 5)
    if isinstance(max_turns, str):
        try:
            max_turns = int(max_turns)
        except (ValueError, TypeError):
            max_turns = 5
    elif not isinstance(max_turns, int):
        try:
            max_turns = int(max_turns)
        except (ValueError, TypeError):
            max_turns = 5
    if max_turns < 1 or max_turns > MAX_TURNS:
        errors.append(f"maxTurns must be an integer between 1 and {MAX_TURNS}")

    input_mode = config.get("inputMode", "text")
    if input_mode not in ALLOWED_INPUT_MODES:
        errors.append(f"inputMode must be one of: {ALLOWED_INPUT_MODES}")

    user_model_id = config.get("userModelId", "claude-haiku")
    evaluation_aspects = config.get("evaluationAspects", [])
    if not evaluation_aspects:
        errors.append("evaluationAspects must contain at least one aspect")

    if errors:
        return None, "; ".join(errors)

    return {
        "testName": test_name,
        "maxTurns": max_turns,
        "inputMode": input_mode,
        "userModelId": user_model_id,
        "userSystemPrompt": config.get("userSystemPrompt", ""),
        "evaluationAspects": evaluation_aspects,
        "rubrics": config.get("rubrics", {}),
        "scenarioDescription": config.get("scenarioDescription", ""),
        "useMock": config.get("useMock", False),
        "allowHangup": config.get("allowHangup", True),
        "judgeModelId": config.get("judgeModelId", "claude-sonnet"),
    }, None


def create_eval_job(agent_id, eval_config, user_ctx, batch_id=None, agent_config_override=None, suite_id=None, test_case_id=None):
    """Create a single eval job record and invoke the Runner Lambda."""
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # If agent_config_override is provided (from eval suites), skip agent lookup
    if agent_config_override:
        agent_config = agent_config_override
    else:
        # Verify agent exists and user has access
        agent_resp = demos_table.get_item(Key={"id": agent_id})
        agent = agent_resp.get("Item")
        if not agent:
            return None, f"Agent '{agent_id}' not found"

        if not check_item_access(agent, user_ctx):
            return None, f"Access denied to agent '{agent_id}'"

        # Snapshot agent config at eval creation time
        agent_config = agent.get("config", agent)
    
    # Resolve tool references to names
    raw_tools = agent_config.get("tools", [])
    resolved_tools = []
    tools_table_name = os.environ.get("TOOLS_TABLE_NAME", "voice-agent-poc-tools")
    tools_table_ref = dynamodb.Table(tools_table_name)
    for ref in raw_tools:
        if isinstance(ref, str) and ref.startswith("int:"):
            tool_id = ref.replace("int:", "")
            try:
                result = tools_table_ref.get_item(Key={"id": tool_id})
                tool_item = result.get("Item")
                if tool_item:
                    resolved_tools.append({
                        "id": tool_id,
                        "name": tool_item.get("name", "unknown"),
                        "type": tool_item.get("type", "tool"),
                    })
                else:
                    resolved_tools.append({"id": tool_id, "name": ref, "type": "unknown"})
            except Exception:
                resolved_tools.append({"id": tool_id, "name": ref, "type": "unknown"})
        elif isinstance(ref, str) and ref.startswith("gateway:"):
            resolved_tools.append({"id": ref, "name": ref.replace("gateway:", ""), "type": "gateway"})
        elif isinstance(ref, str):
            resolved_tools.append({"id": ref, "name": ref, "type": "builtin"})
        elif isinstance(ref, dict) and ref.get("name"):
            # Already a resolved tool object (e.g. from agentConfigOverride)
            resolved_tools.append({
                "id": ref.get("id", ref.get("name", "")),
                "name": ref.get("name", "unknown"),
                "type": ref.get("type", "tool"),
            })
    
    agent_snapshot = {
        "systemPrompt": agent_config.get("systemPrompt", ""),
        "tools": resolved_tools,
        "customTools": agent_config.get("customTools", []),
        "voice": agent_config.get("voice", {}),
        "inferenceConfig": agent_config.get("inferenceConfig", {}),
    }
    # Include modelId if provided (for Sonic model override)
    if agent_config.get("modelId"):
        agent_snapshot["modelId"] = agent_config["modelId"]
    # Prefer prompt.instructions over top-level systemPrompt
    prompt_obj = agent_config.get("prompt", {})
    if prompt_obj and prompt_obj.get("instructions"):
        agent_snapshot["systemPrompt"] = prompt_obj["instructions"]

    # Create job record
    job = {
        "id": job_id,
        "userId": user_ctx["userId"],
        "agentId": agent_id or "",
        "status": "PENDING",
        "createdAt": now,
        "updatedAt": now,
        "config": eval_config,
        "agentSnapshot": agent_snapshot,
    }
    if batch_id:
        job["batchId"] = batch_id
    if suite_id:
        job["suiteId"] = suite_id
    if test_case_id:
        job["testCaseId"] = test_case_id

    eval_table.put_item(Item=_convert_floats_to_decimal(job))

    # Invoke Runner Lambda asynchronously
    payload = {
        "jobId": job_id,
        "agentId": agent_id,
        "config": eval_config,
    }
    if batch_id:
        payload["batchId"] = batch_id

    try:
        lambda_client.invoke(
            FunctionName=EVAL_RUNNER_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(payload),
        )
    except Exception as e:
        # Mark job as failed if invoke fails
        eval_table.update_item(
            Key={"id": job_id},
            UpdateExpression="SET #s = :s, #err = :err, updatedAt = :now",
            ExpressionAttributeNames={"#s": "status", "#err": "error"},
            ExpressionAttributeValues={
                ":s": "FAILED",
                ":err": f"Failed to invoke runner: {str(e)}",
                ":now": now,
            },
        )
        return None, f"Failed to start eval: {str(e)}"

    # Update status to RUNNING
    eval_table.update_item(
        Key={"id": job_id},
        UpdateExpression="SET #s = :s, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "RUNNING", ":now": now},
    )

    job["status"] = "RUNNING"
    return job, None


def handler(event, context):
    """Main Lambda handler — routes to appropriate function."""
    method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}

    # Extract authenticated user context
    user_ctx = get_user_context(event)

    # Parse body
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except json.JSONDecodeError:
            return response(400, {"error": "Invalid JSON body"})

    # --- POST /eval/jobs ---
    if method == "POST" and path == "/eval/jobs":
        agent_id = body.get("agentId", "").strip()
        agent_config_override = body.get("agentConfigOverride")
        suite_id = body.get("suiteId", "").strip() or None
        test_case_id = body.get("testCaseId", "").strip() or None

        if not agent_id and not agent_config_override:
            return response(400, {"error": "agentId or agentConfigOverride is required"})

        config = body.get("config", {})
        cleaned_config, error = validate_eval_config(config)
        if error:
            return response(400, {"error": error})

        job, error = create_eval_job(agent_id, cleaned_config, user_ctx, agent_config_override=agent_config_override, suite_id=suite_id, test_case_id=test_case_id)
        if error:
            return response(400, {"error": error})

        return response(202, job)

    # --- POST /eval/batches ---
    if method == "POST" and path == "/eval/batches":
        agent_id = body.get("agentId", "").strip()
        if not agent_id:
            return response(400, {"error": "agentId is required"})

        scenarios = body.get("scenarios", [])
        if not scenarios or len(scenarios) > MAX_BATCH_SIZE:
            return response(400, {"error": f"scenarios must contain 1-{MAX_BATCH_SIZE} items"})

        # Validate all scenarios first
        cleaned_scenarios = []
        for i, scenario in enumerate(scenarios):
            cleaned, error = validate_eval_config(scenario)
            if error:
                return response(400, {"error": f"Scenario {i+1}: {error}"})
            cleaned_scenarios.append(cleaned)

        # Create batch record
        batch_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        job_ids = []

        # Fan out — one Runner Lambda per scenario
        for scenario in cleaned_scenarios:
            job, error = create_eval_job(agent_id, scenario, user_ctx, batch_id=batch_id)
            if error:
                # Continue with remaining scenarios
                continue
            job_ids.append(job["id"])

        batch = {
            "id": batch_id,
            "userId": user_ctx["userId"],
            "agentId": agent_id,
            "status": "RUNNING",
            "total": len(cleaned_scenarios),
            "completed": 0,
            "failed": len(cleaned_scenarios) - len(job_ids),
            "createdAt": now,
            "jobIds": job_ids,
        }
        eval_table.put_item(Item=batch)

        return response(202, batch)

    # --- GET /eval/jobs ---
    if method == "GET" and path == "/eval/jobs":
        query_params = event.get("queryStringParameters") or {}
        agent_id = query_params.get("agentId", "")
        suite_id_filter = query_params.get("suiteId", "")

        if user_ctx["isAdmin"]:
            # Admin sees all jobs (paginated scan)
            filter_exprs = []
            expr_values = {}
            if agent_id:
                filter_exprs.append("agentId = :aid")
                expr_values[":aid"] = agent_id
            if suite_id_filter:
                filter_exprs.append("suiteId = :sid")
                expr_values[":sid"] = suite_id_filter

            items = []
            scan_kwargs = {}
            if filter_exprs:
                scan_kwargs["FilterExpression"] = " AND ".join(filter_exprs)
                scan_kwargs["ExpressionAttributeValues"] = expr_values

            while True:
                result = eval_table.scan(**scan_kwargs)
                items.extend(result.get("Items", []))
                if "LastEvaluatedKey" not in result:
                    break
                scan_kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]
        else:
            # Regular user: query by userId GSI, then filter (paginated)
            from boto3.dynamodb.conditions import Key as DKey
            items = []
            query_kwargs = {
                "IndexName": "userId-index",
                "KeyConditionExpression": DKey("userId").eq(user_ctx["userId"]),
                "ScanIndexForward": False,
            }
            while True:
                result = eval_table.query(**query_kwargs)
                items.extend(result.get("Items", []))
                if "LastEvaluatedKey" not in result:
                    break
                query_kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]

            if agent_id:
                items = [item for item in items if item.get("agentId") == agent_id]
            if suite_id_filter:
                items = [item for item in items if item.get("suiteId") == suite_id_filter]

        # Filter out batch parent records (they have 'total' but not 'config')
        items = [item for item in items if "config" in item]
        items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

        return response(200, items)

    # --- GET /eval/jobs/{id} ---
    if method == "GET" and "/eval/jobs/" in path and "/results" not in path:
        job_id = path_params.get("id") or path.split("/eval/jobs/")[-1]
        result = eval_table.get_item(Key={"id": job_id})
        item = result.get("Item")
        if not item:
            return response(404, {"error": "Job not found"})
        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})
        return response(200, item)

    # --- GET /eval/jobs/{id}/results ---
    if method == "GET" and "/results" in path:
        # Extract job ID from path like /eval/jobs/{id}/results
        parts = path.split("/")
        job_id = parts[3] if len(parts) > 3 else ""
        result = eval_table.get_item(Key={"id": job_id})
        item = result.get("Item")
        if not item:
            return response(404, {"error": "Job not found"})
        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})
        if item.get("status") != "COMPLETED":
            return response(400, {"error": "Job not yet completed"})

        results_key = item.get("resultsKey", "")
        if not results_key:
            return response(404, {"error": "No results available"})

        # Fetch evaluation.json from S3
        try:
            eval_obj = s3_client.get_object(
                Bucket=EVAL_RESULTS_BUCKET,
                Key=f"{results_key}evaluation.json",
            )
            evaluation = json.loads(eval_obj["Body"].read().decode("utf-8"))
        except Exception:
            evaluation = None

        # Fetch transcript
        try:
            transcript_obj = s3_client.get_object(
                Bucket=EVAL_RESULTS_BUCKET,
                Key=f"{results_key}transcript.txt",
            )
            transcript = transcript_obj["Body"].read().decode("utf-8")
        except Exception:
            transcript = None

        # Fetch interaction log
        try:
            log_obj = s3_client.get_object(
                Bucket=EVAL_RESULTS_BUCKET,
                Key=f"{results_key}interaction_log.json",
            )
            interaction_log = json.loads(log_obj["Body"].read().decode("utf-8"))
        except Exception:
            interaction_log = None

        # Generate presigned URLs for audio files
        audio_urls = {}
        try:
            # Check for combined agent output audio
            s3_client.head_object(Bucket=EVAL_RESULTS_BUCKET, Key=f"{results_key}audio/agent_output.wav")
            audio_urls["agentOutput"] = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": EVAL_RESULTS_BUCKET, "Key": f"{results_key}audio/agent_output.wav"},
                ExpiresIn=900,
            )
        except Exception:
            pass

        # Check for per-turn audio files
        try:
            turn_prefix = f"{results_key}audio/"
            turn_list = s3_client.list_objects_v2(Bucket=EVAL_RESULTS_BUCKET, Prefix=turn_prefix)
            turn_audio_urls = {}
            for obj in turn_list.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]
                if not filename.startswith("turn_") or not filename.endswith(".wav"):
                    continue
                name = filename.replace(".wav", "")
                parts = name.split("_")
                if len(parts) == 3:
                    # New format: turn_1_agent.wav or turn_1_user.wav
                    turn_num = parts[1]
                    role = parts[2]
                elif len(parts) == 2:
                    # Old format: turn_1.wav (agent only)
                    turn_num = parts[1]
                    role = "agent"
                else:
                    continue
                if turn_num not in turn_audio_urls:
                    turn_audio_urls[turn_num] = {}
                turn_audio_urls[turn_num][role] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": EVAL_RESULTS_BUCKET, "Key": key},
                    ExpiresIn=900,
                )
            if turn_audio_urls:
                audio_urls["turns"] = turn_audio_urls
        except Exception:
            pass

        return response(200, {
            "jobId": job_id,
            "evaluation": evaluation,
            "transcript": transcript,
            "interactionLog": interaction_log,
            "audioUrls": audio_urls,
        })

    # --- GET /eval/batches/{id} ---
    if method == "GET" and "/eval/batches/" in path:
        batch_id = path_params.get("id") or path.split("/eval/batches/")[-1]
        result = eval_table.get_item(Key={"id": batch_id})
        batch = result.get("Item")
        if not batch:
            return response(404, {"error": "Batch not found"})
        if not check_item_access(batch, user_ctx):
            return response(403, {"error": "Access denied"})

        # Aggregate child job statuses
        job_ids = batch.get("jobIds", [])
        completed = 0
        failed = 0
        jobs = []
        for jid in job_ids:
            jr = eval_table.get_item(Key={"id": jid})
            job = jr.get("Item", {})
            jobs.append(job)
            if job.get("status") == "COMPLETED":
                completed += 1
            elif job.get("status") == "FAILED":
                failed += 1

        total = batch.get("total", len(job_ids))
        if completed + failed == total:
            status = "COMPLETED" if failed == 0 else "PARTIAL"
        else:
            status = "RUNNING"

        batch["status"] = status
        batch["completed"] = completed
        batch["failed"] = failed
        batch["jobs"] = jobs
        return response(200, batch)

    # --- DELETE /eval/jobs/{id} ---
    if method == "DELETE" and "/eval/jobs/" in path and "/delete" not in path:
        job_id = path_params.get("id") or path.split("/eval/jobs/")[-1]
        result = eval_table.get_item(Key={"id": job_id})
        item = result.get("Item")
        if not item:
            return response(404, {"error": "Job not found"})
        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})
        now = datetime.now(timezone.utc).isoformat()
        eval_table.update_item(
            Key={"id": job_id},
            UpdateExpression="SET #s = :s, updatedAt = :now",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "CANCELLED", ":now": now},
        )
        return response(200, {"message": "Job cancelled", "id": job_id})

    # --- DELETE /eval/jobs/{id}/delete ---
    if method == "DELETE" and "/delete" in path:
        parts = path.split("/")
        job_id = parts[3] if len(parts) > 4 else path_params.get("id", "")
        result = eval_table.get_item(Key={"id": job_id})
        item = result.get("Item")
        if not item:
            return response(404, {"error": "Job not found"})
        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})
        eval_table.delete_item(Key={"id": job_id})
        return response(200, {"message": "Job deleted", "id": job_id})

    # --- PATCH /eval/jobs/{id} (rename) ---
    if method in ("PATCH", "PUT") and "/eval/jobs/" in path and "/results" not in path and "/delete" not in path:
        job_id = path_params.get("id") or path.split("/eval/jobs/")[-1]
        result = eval_table.get_item(Key={"id": job_id})
        item = result.get("Item")
        if not item:
            return response(404, {"error": "Job not found"})
        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})
        new_name = body.get("testName", "").strip()
        if not new_name:
            return response(400, {"error": "testName is required"})
        now = datetime.now(timezone.utc).isoformat()
        eval_table.update_item(
            Key={"id": job_id},
            UpdateExpression="SET config.testName = :name, updatedAt = :now",
            ExpressionAttributeValues={":name": new_name, ":now": now},
        )
        item["config"]["testName"] = new_name
        item["updatedAt"] = now
        return response(200, item)

    # --- POST /eval/suggest-prompt ---
    if method == "POST" and path == "/eval/suggest-prompt":
        current_prompt = body.get("currentPrompt", "")
        evaluation = body.get("evaluation", {})
        interaction_log = body.get("interactionLog", {})

        # Build context for Claude
        weaknesses = evaluation.get("weaknesses", [])
        if not weaknesses and "results" in evaluation:
            weaknesses = evaluation["results"].get("weaknesses", [])

        turns_summary = ""
        turns = interaction_log.get("turns", [])
        for i, turn in enumerate(turns[:5]):  # Limit to 5 turns
            user_msg = turn.get("user_message", "")[:200]
            agent_msg = turn.get("sonic_response", "")[:200]
            turns_summary += f"Turn {i+1}:\n  User: {user_msg}\n  Agent: {agent_msg}\n\n"

        # Load Nova Sonic (Nova 2 Lite) prompt best practices.
        best_practices_dir = os.path.join(os.path.dirname(__file__), "prompt_best_practices")
        best_practices_file = os.path.join(best_practices_dir, "nova_2_lite", "SKILL.md")
        best_practices = ""
        try:
            with open(best_practices_file, "r") as f:
                best_practices = f.read()
        except FileNotFoundError:
            best_practices = ""

        model_description = "Amazon Nova Sonic (Nova 2 Lite)"
        format_guidance = """FORMAT REQUIREMENT: The suggested prompt should use markdown headers (##) and plain conversational text. Do NOT use XML tags — Nova 2 Lite works best with natural language structure and markdown formatting."""
        
        meta_prompt = f"""You are an expert prompt engineer for voice AI agents powered by {model_description}. Based on the evaluation results below, suggest an improved system prompt.

{format_guidance}

{"IMPORTANT — VOICE PROMPT BEST PRACTICES:" + chr(10) + best_practices + chr(10) if best_practices else ""}
CURRENT SYSTEM PROMPT:
{current_prompt}

EVALUATION WEAKNESSES:
{chr(10).join(f'- {w}' for w in weaknesses)}

SAMPLE CONVERSATION:
{turns_summary}

Respond in the following JSON format (no markdown, just raw JSON):
{{
  "suggestedPrompt": "<the full improved system prompt following the best practices above>",
  "changelog": [
    "<brief description of change 1>",
    "<brief description of change 2>"
  ]
}}

The changelog should list 2-5 bullet points explaining what was changed and why (e.g., "Added explicit instruction to verify policy number before proceeding — addresses Goal Achievement failure"). Keep each entry to one sentence."""

        try:
            bedrock_client = boto3.client("bedrock-runtime", region_name=REGION)
            
            # Nova Sonic uses Nova 2 Lite under the hood, which understands
            # Nova Sonic's prompting patterns best.
            generation_model_id = "us.amazon.nova-lite-v1:0"
            
            bedrock_response = bedrock_client.converse(
                modelId=generation_model_id,
                messages=[{"role": "user", "content": [{"text": meta_prompt}]}],
                inferenceConfig={"maxTokens": 2048, "temperature": 0.7},
            )
            output = bedrock_response.get("output", {}).get("message", {}).get("content", [])
            raw_text = output[0].get("text", "") if output else ""

            # Strip markdown code fences if present
            cleaned = raw_text.strip()
            if cleaned.startswith("```"):
                # Remove opening fence (e.g., ```json)
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].strip()

            # Try to parse as JSON
            try:
                result = json.loads(cleaned)
                suggested = result.get("suggestedPrompt", raw_text)
                changelog = result.get("changelog", [])
            except json.JSONDecodeError:
                # Fallback: treat entire response as the prompt
                suggested = raw_text
                changelog = []

            return response(200, {"suggestedPrompt": suggested, "changelog": changelog})
        except Exception as e:
            return response(500, {"error": f"Prompt generation failed: {str(e)}"})

    return response(404, {"error": f"Not found: {method} {path}"})
