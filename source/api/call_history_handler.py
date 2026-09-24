"""
Lambda handler for Call History API.

Serves call history records and presigned S3 URLs to the frontend.

Handles:
  GET /call-history/sessions?agentId={id}&limit=20  — List sessions
  GET /call-history/sessions/{sessionId}?agentId={id} — Get session detail with presigned URLs
  POST /call-history/analyze — Run post-call analytics on a transcript
"""

import json
import os

import boto3
from boto3.dynamodb.conditions import Key

from auth_utils import get_user_context

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
TABLE_NAME = os.environ.get("CALL_HISTORY_TABLE", "voice-agent-poc-call-history")
BUCKET_NAME = os.environ.get("CALL_HISTORY_BUCKET", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
s3_client = boto3.client("s3", region_name=REGION)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,DELETE,OPTIONS",
}

PRESIGN_EXPIRY = 900  # 15 minutes


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }


def handler(event, context):
    """Main Lambda handler."""
    method = event.get("httpMethod", "")
    path = event.get("path", "")
    query = event.get("queryStringParameters") or {}
    path_params = event.get("pathParameters") or {}

    user_ctx = get_user_context(event)

    try:
        # GET /call-history/sessions?agentId=xxx
        if method == "GET" and path == "/call-history/sessions":
            agent_id = query.get("agentId", "")
            if not agent_id:
                return response(400, {"error": "agentId query parameter is required"})

            limit = int(query.get("limit", "20"))
            start_key = query.get("startKey")

            query_kwargs = {
                "KeyConditionExpression": Key("agentId").eq(agent_id),
                "ScanIndexForward": False,  # Newest first
                "Limit": limit,
            }
            if start_key:
                try:
                    query_kwargs["ExclusiveStartKey"] = json.loads(start_key)
                except json.JSONDecodeError:
                    pass

            result = table.query(**query_kwargs)
            items = result.get("Items", [])
            next_key = result.get("LastEvaluatedKey")

            return response(200, {
                "sessions": items,
                "nextKey": json.dumps(next_key) if next_key else None,
            })

        # GET /call-history/sessions/{sessionId}?agentId=xxx
        if method == "GET" and "/call-history/sessions/" in path:
            session_id = path_params.get("sessionId") or path.split("/call-history/sessions/")[-1]
            agent_id = query.get("agentId", "")

            if not agent_id:
                return response(400, {"error": "agentId query parameter is required"})

            # Query by agentId (PK) and find the session
            result = table.query(
                KeyConditionExpression=Key("agentId").eq(agent_id),
                FilterExpression="sessionId = :sid",
                ExpressionAttributeValues={":sid": session_id},
            )
            items = result.get("Items", [])
            if not items:
                return response(404, {"error": "Session not found"})

            session = items[0]
            s3_prefix = session.get("s3Prefix", f"sessions/{agent_id}/{session_id}/")

            # Generate presigned URLs
            urls = {}
            try:
                s3_client.head_object(Bucket=BUCKET_NAME, Key=f"{s3_prefix}transcript.json")
                urls["transcript"] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": BUCKET_NAME, "Key": f"{s3_prefix}transcript.json"},
                    ExpiresIn=PRESIGN_EXPIRY,
                )
            except Exception:
                pass

            try:
                s3_client.head_object(Bucket=BUCKET_NAME, Key=f"{s3_prefix}audio/agent_output.wav")
                urls["audio"] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": BUCKET_NAME, "Key": f"{s3_prefix}audio/agent_output.wav"},
                    ExpiresIn=PRESIGN_EXPIRY,
                )
            except Exception:
                pass

            try:
                s3_client.head_object(Bucket=BUCKET_NAME, Key=f"{s3_prefix}audio/user_input.wav")
                urls["userAudio"] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": BUCKET_NAME, "Key": f"{s3_prefix}audio/user_input.wav"},
                    ExpiresIn=PRESIGN_EXPIRY,
                )
            except Exception:
                pass

            try:
                s3_client.head_object(Bucket=BUCKET_NAME, Key=f"{s3_prefix}events.jsonl")
                urls["events"] = s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": BUCKET_NAME, "Key": f"{s3_prefix}events.jsonl"},
                    ExpiresIn=PRESIGN_EXPIRY,
                )
            except Exception:
                pass

            # Generate presigned URLs for per-turn audio files
            turn_audio_urls = {}
            try:
                audio_objects = s3_client.list_objects_v2(
                    Bucket=BUCKET_NAME,
                    Prefix=f"{s3_prefix}audio/turn_",
                )
                for obj in audio_objects.get("Contents", []):
                    key = obj["Key"]
                    filename = key.split("/")[-1]  # e.g. "turn_0_agent.wav"
                    turn_audio_urls[filename] = s3_client.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": BUCKET_NAME, "Key": key},
                        ExpiresIn=PRESIGN_EXPIRY,
                    )
            except Exception:
                pass
            if turn_audio_urls:
                urls["turnAudio"] = turn_audio_urls

            return response(200, {
                "session": session,
                "urls": urls,
            })

        # DELETE /call-history/sessions/{sessionId}?agentId=xxx
        if method == "DELETE" and "/call-history/sessions/" in path:
            session_id = path_params.get("sessionId") or path.split("/call-history/sessions/")[-1]
            agent_id = query.get("agentId", "")

            if not agent_id:
                return response(400, {"error": "agentId query parameter is required"})

            # Delete from DynamoDB
            try:
                # Find the item first to get sort key
                result = table.query(
                    KeyConditionExpression=Key("agentId").eq(agent_id),
                    FilterExpression="sessionId = :sid",
                    ExpressionAttributeValues={":sid": session_id},
                )
                items = result.get("Items", [])
                for item in items:
                    table.delete_item(Key={
                        "agentId": item["agentId"],
                        "startedAt": item["startedAt"],
                    })
            except Exception as e:
                return response(500, {"error": f"Failed to delete DynamoDB record: {str(e)}"})

            # Delete S3 objects
            try:
                s3_prefix = f"sessions/{agent_id}/{session_id}/"
                objects = s3_client.list_objects_v2(Bucket=BUCKET_NAME, Prefix=s3_prefix)
                if objects.get("Contents"):
                    s3_client.delete_objects(
                        Bucket=BUCKET_NAME,
                        Delete={"Objects": [{"Key": obj["Key"]} for obj in objects["Contents"]]},
                    )
            except Exception:
                pass  # Best effort — DynamoDB already deleted

            return response(200, {"deleted": True})

        # POST /call-history/analyze — Run post-call analytics with Bedrock
        if method == "POST" and "/call-history/analyze" in path:
            body = json.loads(event.get("body", "{}"))
            transcript_text = body.get("transcript", "")
            prompt = body.get("prompt", "")

            if not transcript_text or not prompt:
                return response(400, {"error": "transcript and prompt are required"})

            bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)
            messages = [
                {
                    "role": "user",
                    "content": f"{prompt}\n\nTranscript:\n{transcript_text}",
                }
            ]
            bedrock_body = json.dumps({
                "messages": messages,
                "max_tokens": 2048,
                "anthropic_version": "bedrock-2023-05-31",
            })
            bedrock_response = bedrock_runtime.invoke_model(
                modelId="us.anthropic.claude-sonnet-4-20250514-v1:0",
                contentType="application/json",
                accept="application/json",
                body=bedrock_body,
            )
            result = json.loads(bedrock_response["body"].read())
            analysis_text = result.get("content", [{}])[0].get("text", "")

            return response(200, {"analysis": analysis_text})

        return response(404, {"error": f"Not found: {method} {path}"})

    except Exception as e:
        return response(500, {"error": str(e)})
