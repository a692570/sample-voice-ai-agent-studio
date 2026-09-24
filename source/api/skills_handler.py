"""
Lambda handler for Skills API (multi-tenant).

CRUD for skills (SKILL.md files) stored in DynamoDB, scoped per user.
Supports Git-based skills (reference URL + path) and S3-uploaded skills.

Handles:
  GET    /skills          — List user's saved skills (admin: all)
  POST   /skills          — Create a skill (owned by user)
  DELETE /skills/{id}     — Delete a skill (must own or be admin)
  POST   /skills/upload   — Get presigned URL for S3 upload
"""

import json
import os
import random
import re
import string
import uuid
from datetime import datetime, timezone

import boto3

from auth_utils import get_user_context, check_item_access

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
TABLE_NAME = os.environ.get("SKILLS_TABLE_NAME", "voice-agent-poc-skills")


def generate_slug_id(name):
    """Generate a human-readable ID from name + 5 random chars."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s]+', '-', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"{slug}-{suffix}" if slug else suffix
BUCKET_NAME = os.environ.get("SKILLS_BUCKET", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
s3_client = boto3.client("s3", region_name=REGION)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
}


def handler(event, context):
    """Main Lambda entry point."""
    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}

    if http_method == "OPTIONS":
        return response(200, {})

    # Extract authenticated user context
    user_ctx = get_user_context(event)

    try:
        if http_method == "GET" and path == "/skills":
            return list_skills(user_ctx)
        elif http_method == "POST" and path == "/skills/upload":
            body = json.loads(event.get("body") or "{}")
            return get_upload_url(body)
        elif http_method == "POST" and path == "/skills":
            body = json.loads(event.get("body") or "{}")
            return create_skill(body, user_ctx)
        elif http_method == "DELETE" and "id" in path_params:
            return delete_skill(path_params["id"], user_ctx)
        else:
            return response(404, {"error": "Not found"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def list_skills(user_ctx):
    """List saved skills — scoped to user unless admin."""
    try:
        if user_ctx["isAdmin"]:
            result = table.scan()
            items = result.get("Items", [])
        else:
            from boto3.dynamodb.conditions import Key
            result = table.query(
                IndexName="userId-index",
                KeyConditionExpression=Key("userId").eq(user_ctx["userId"]),
                ScanIndexForward=False,
            )
            items = result.get("Items", [])
        items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
        return response(200, items)
    except Exception as e:
        return response(500, {"error": f"Failed to list skills: {str(e)}"})


def create_skill(body, user_ctx):
    """Create a new skill owned by the authenticated user."""
    name = body.get("name", "").strip()
    source = body.get("source", "").strip()

    if not name:
        return response(400, {"error": "name is required"})
    if source not in ("git", "s3"):
        return response(400, {"error": "source must be 'git' or 's3'"})

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": generate_slug_id(name),
        "userId": user_ctx["userId"],
        "name": name,
        "description": body.get("description", ""),
        "source": source,
        "url": body.get("url", ""),
        "path": body.get("path", ""),
        "s3Uri": body.get("s3Uri", ""),
        "createdAt": now,
    }
    table.put_item(Item=item)
    return response(201, item)


def delete_skill(skill_id, user_ctx):
    """Delete a skill (must own or be admin)."""
    try:
        result = table.get_item(Key={"id": skill_id})
        item = result.get("Item")

        if not item:
            return response(404, {"error": "Skill not found"})

        if not check_item_access(item, user_ctx):
            return response(403, {"error": "Access denied"})

        if item.get("source") == "s3" and item.get("path") and BUCKET_NAME:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=item["path"])
            except Exception as s3_err:
                print(f"Warning: failed to delete S3 object: {s3_err}")

        table.delete_item(Key={"id": skill_id})
        return response(200, {"message": "Deleted", "id": skill_id})
    except Exception as e:
        return response(500, {"error": f"Failed to delete: {str(e)}"})


def get_upload_url(body):
    """Generate a presigned URL for uploading a skill file to S3."""
    if not BUCKET_NAME:
        return response(500, {"error": "S3 bucket not configured"})

    file_name = body.get("fileName", "SKILL.md")
    content_type = body.get("contentType", "text/markdown")

    # Generate unique key
    skill_id = str(uuid.uuid4())
    key = f"skills/{skill_id}/{file_name}"
    s3_uri = f"s3://{BUCKET_NAME}/{key}"

    try:
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=300,  # 5 minutes
        )
        return response(200, {
            "uploadUrl": presigned_url,
            "key": key,
            "s3Uri": s3_uri,
            "skillId": skill_id,
        })
    except Exception as e:
        return response(500, {"error": f"Failed to generate upload URL: {str(e)}"})


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
