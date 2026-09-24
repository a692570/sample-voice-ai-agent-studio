"""
Lambda handler for Demos CRUD API (multi-tenant).

Each demo is scoped to the authenticated user via their Cognito userId.
Admin users can see and manage all users' demos.

Handles:
  GET    /demos        — List user's demos (admin: all demos)
  GET    /demos/{id}   — Get a single demo (must own or be admin)
  POST   /demos        — Create a new demo (owned by user)
  PUT    /demos/{id}   — Update an existing demo (must own or be admin)
  DELETE /demos/{id}   — Delete a demo (must own or be admin)
"""

import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

from auth_utils import get_user_context, check_item_access

TABLE_NAME = os.environ["TABLE_NAME"]
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
}


def handler(event, context):
    """Main Lambda entry point."""
    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}

    # Extract authenticated user context
    user_ctx = get_user_context(event)

    try:
        if http_method == "GET" and path == "/demos":
            return list_demos(user_ctx)
        elif http_method == "GET" and "id" in path_params:
            return get_demo(path_params["id"], user_ctx)
        elif http_method == "POST" and path == "/demos":
            body = json.loads(event.get("body") or "{}")
            return create_demo(body, user_ctx)
        elif http_method == "PUT" and "id" in path_params:
            body = json.loads(event.get("body") or "{}")
            return update_demo(path_params["id"], body, user_ctx)
        elif http_method == "DELETE" and "id" in path_params:
            return delete_demo(path_params["id"], user_ctx)
        else:
            return response(404, {"error": "Not found"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def _deserialize_workflow(item):
    """Parse workflow JSON string back to dict if needed."""
    if item and "config" in item and isinstance(item["config"], dict):
        wf = item["config"].get("workflow")
        if isinstance(wf, str):
            import json as _json
            try:
                item["config"]["workflow"] = _json.loads(wf)
            except (ValueError, TypeError):
                pass
    return item


def list_demos(user_ctx):
    """List demos — scoped to user unless admin."""
    if user_ctx["isAdmin"]:
        # Admin sees all demos
        result = table.scan()
        items = result.get("Items", [])
    else:
        # Regular user: query by userId GSI
        result = table.query(
            IndexName="userId-index",
            KeyConditionExpression=Key("userId").eq(user_ctx["userId"]),
            ScanIndexForward=False,  # newest first
        )
        items = result.get("Items", [])

    for item in items:
        _deserialize_workflow(item)
    # Sort by updatedAt descending
    items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    return response(200, items)


def get_demo(demo_id, user_ctx):
    """Get a single demo by ID."""
    result = table.get_item(Key={"id": demo_id})
    item = result.get("Item")
    if not item:
        return response(404, {"error": "Demo not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    _deserialize_workflow(item)
    return response(200, item)


def create_demo(body, user_ctx):
    """Create a new demo configuration owned by the authenticated user."""
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4()),
        "userId": user_ctx["userId"],
        "userEmail": user_ctx.get("email", ""),
        "name": body.get("name", "Untitled Demo"),
        "createdAt": now,
        "updatedAt": now,
        "config": body.get("config", {}),
    }
    # Store workflow as JSON string to avoid DynamoDB float issues
    if "workflow" in item["config"] and isinstance(item["config"]["workflow"], dict):
        import json as _json
        item["config"]["workflow"] = _json.dumps(item["config"]["workflow"])
    table.put_item(Item=item)
    return response(201, item)


def update_demo(demo_id, body, user_ctx):
    """Update an existing demo configuration."""
    # Check item exists and user has access
    result = table.get_item(Key={"id": demo_id})
    item = result.get("Item")
    if not item:
        return response(404, {"error": "Demo not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    now = datetime.now(timezone.utc).isoformat()
    update_expr_parts = ["#updatedAt = :updatedAt"]
    expr_names = {"#updatedAt": "updatedAt"}
    expr_values = {":updatedAt": now}

    if "name" in body:
        update_expr_parts.append("#name = :name")
        expr_names["#name"] = "name"
        expr_values[":name"] = body["name"]

    if "config" in body:
        config_data = body["config"]
        # Store workflow as JSON string to avoid DynamoDB float issues
        if "workflow" in config_data and isinstance(config_data["workflow"], dict):
            import json as _json
            config_data["workflow"] = _json.dumps(config_data["workflow"])
        update_expr_parts.append("#config = :config")
        expr_names["#config"] = "config"
        expr_values[":config"] = config_data

    # Ensure userId is set (backfill for legacy items)
    if not item.get("userId"):
        update_expr_parts.append("#userId = :userId")
        expr_names["#userId"] = "userId"
        expr_values[":userId"] = user_ctx["userId"]

    table.update_item(
        Key={"id": demo_id},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    # Return updated item
    result = table.get_item(Key={"id": demo_id})
    return response(200, result["Item"])


def delete_demo(demo_id, user_ctx):
    """Delete a demo configuration."""
    # Check access
    result = table.get_item(Key={"id": demo_id})
    item = result.get("Item")
    if not item:
        return response(404, {"error": "Demo not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    table.delete_item(Key={"id": demo_id})
    return response(200, {"message": "Deleted", "id": demo_id})


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
