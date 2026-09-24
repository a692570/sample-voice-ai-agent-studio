"""
Lambda handler for Eval Suites CRUD API (multi-tenant).

Each eval suite is scoped to the authenticated user via their Cognito userId.
Admin users can see and manage all users' eval suites.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

from auth_utils import get_user_context, check_item_access

TABLE_NAME = os.environ.get("EVAL_SUITES_TABLE_NAME", "voice-agent-eval-suites")

dynamodb_resource = boto3.resource("dynamodb")
table = dynamodb_resource.Table(TABLE_NAME)


def handler(event, context):
    """Main Lambda handler — routes to CRUD operations."""
    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}

    # Extract authenticated user context
    user_ctx = get_user_context(event)

    try:
        # /eval-suites
        if http_method == "GET" and path == "/eval-suites":
            return list_suites(user_ctx)
        elif http_method == "POST" and path == "/eval-suites":
            body = json.loads(event.get("body") or "{}")
            return create_suite(body, user_ctx)
        # /eval-suites/{id}
        elif http_method == "GET" and "id" in path_params and "/test-cases" not in path and "/runs" not in path:
            return get_suite(path_params["id"], user_ctx)
        elif http_method == "PUT" and "id" in path_params and "tcId" not in path_params:
            body = json.loads(event.get("body") or "{}")
            return update_suite(path_params["id"], body, user_ctx)
        elif http_method == "DELETE" and "id" in path_params and "tcId" not in path_params:
            return delete_suite(path_params["id"], user_ctx)
        # /eval-suites/{id}/test-cases
        elif http_method == "POST" and "id" in path_params and "/test-cases" in path and "tcId" not in path_params:
            body = json.loads(event.get("body") or "{}")
            return create_test_case(path_params["id"], body, user_ctx)
        # /eval-suites/{id}/test-cases/{tcId}
        elif http_method == "PUT" and "tcId" in path_params:
            body = json.loads(event.get("body") or "{}")
            return update_test_case(path_params["id"], path_params["tcId"], body, user_ctx)
        elif http_method == "DELETE" and "tcId" in path_params:
            return delete_test_case(path_params["id"], path_params["tcId"], user_ctx)
        # /eval-suites/{id}/runs
        elif http_method == "GET" and "/runs" in path:
            return list_runs(path_params["id"], path_params.get("tcId"), user_ctx)
        else:
            return response(404, {"error": "Not found"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def response(status_code, body):
    """Build API Gateway response."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


# --- CRUD Operations ---

def list_suites(user_ctx):
    """List eval suites — scoped to user unless admin."""
    if user_ctx["isAdmin"]:
        result = table.scan()
        items = result.get("Items", [])
    else:
        result = table.query(
            IndexName="userId-index",
            KeyConditionExpression=Key("userId").eq(user_ctx["userId"]),
            ScanIndexForward=False,
        )
        items = result.get("Items", [])

    items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    return response(200, items)


def get_suite(suite_id, user_ctx):
    """Get a single eval suite by ID."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    return response(200, item)


def create_suite(body, user_ctx):
    """Create a new eval suite."""
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4()),
        "userId": user_ctx["userId"],
        "userEmail": user_ctx.get("email", ""),
        "name": body.get("name", "Untitled Eval Suite"),
        "description": body.get("description", ""),
        "basePrompt": body.get("basePrompt", ""),
        "tools": body.get("tools", []),
        "defaultScenarios": body.get("defaultScenarios", []),
        "sourceAgentId": body.get("sourceAgentId", None),
        "testCases": body.get("testCases", []),
        "createdAt": now,
        "updatedAt": now,
    }
    table.put_item(Item=item)
    return response(201, item)


def update_suite(suite_id, body, user_ctx):
    """Update an existing eval suite (top-level fields only)."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    now = datetime.now(timezone.utc).isoformat()
    update_expr_parts = ["#updatedAt = :updatedAt"]
    expr_names = {"#updatedAt": "updatedAt"}
    expr_values = {":updatedAt": now}

    # Updatable fields
    for field in ["name", "description", "basePrompt", "tools", "defaultScenarios", "testCases", "evalSettings"]:
        if field in body:
            safe_name = f"#{field}"
            expr_names[safe_name] = field
            expr_expr = f":{field}"
            expr_values[expr_expr] = body[field]
            update_expr_parts.append(f"{safe_name} = {expr_expr}")

    table.update_item(
        Key={"id": suite_id},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    # Return updated item
    result = table.get_item(Key={"id": suite_id})
    return response(200, result.get("Item"))


def delete_suite(suite_id, user_ctx):
    """Delete an eval suite."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    table.delete_item(Key={"id": suite_id})
    return response(200, {"deleted": True})


# --- Test Case Operations ---

def create_test_case(suite_id, body, user_ctx):
    """Add a test case to an eval suite."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    now = datetime.now(timezone.utc).isoformat()
    test_case = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", "Untitled Test Case"),
        "model": body.get("model", "nova-2-sonic"),
        "promptOverride": body.get("promptOverride", None),
        "scenarios": body.get("scenarios", None),
        "createdAt": now,
    }

    test_cases = item.get("testCases", [])
    test_cases.append(test_case)

    table.update_item(
        Key={"id": suite_id},
        UpdateExpression="SET #tc = :tc, #updatedAt = :now",
        ExpressionAttributeNames={"#tc": "testCases", "#updatedAt": "updatedAt"},
        ExpressionAttributeValues={":tc": test_cases, ":now": now},
    )

    return response(201, test_case)


def update_test_case(suite_id, tc_id, body, user_ctx):
    """Update a test case within an eval suite."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    test_cases = item.get("testCases", [])
    updated = False

    for i, tc in enumerate(test_cases):
        if tc.get("id") == tc_id:
            for field in ["name", "model", "promptOverride", "scenarios"]:
                if field in body:
                    test_cases[i][field] = body[field]
            updated = True
            break

    if not updated:
        return response(404, {"error": "Test case not found"})

    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"id": suite_id},
        UpdateExpression="SET #tc = :tc, #updatedAt = :now",
        ExpressionAttributeNames={"#tc": "testCases", "#updatedAt": "updatedAt"},
        ExpressionAttributeValues={":tc": test_cases, ":now": now},
    )

    return response(200, test_cases[i])


def delete_test_case(suite_id, tc_id, user_ctx):
    """Remove a test case from an eval suite."""
    result = table.get_item(Key={"id": suite_id})
    item = result.get("Item")

    if not item:
        return response(404, {"error": "Eval suite not found"})

    if not check_item_access(item, user_ctx):
        return response(403, {"error": "Access denied"})

    test_cases = item.get("testCases", [])
    test_cases = [tc for tc in test_cases if tc.get("id") != tc_id]

    now = datetime.now(timezone.utc).isoformat()
    table.update_item(
        Key={"id": suite_id},
        UpdateExpression="SET #tc = :tc, #updatedAt = :now",
        ExpressionAttributeNames={"#tc": "testCases", "#updatedAt": "updatedAt"},
        ExpressionAttributeValues={":tc": test_cases, ":now": now},
    )

    return response(200, {"deleted": True})


# --- Eval Runs ---

def list_runs(suite_id, tc_id, user_ctx):
    """List eval runs for a suite (optionally filtered by test case)."""
    # Query the eval jobs table for runs associated with this suite
    eval_table_name = os.environ.get("EVAL_TABLE_NAME", "voice-agent-poc-eval-jobs")
    eval_table = dynamodb_resource.Table(eval_table_name)

    # Scan with filter (eval table uses id as PK, no suite-level index yet)
    result = eval_table.scan(
        FilterExpression="attribute_exists(suiteId) AND suiteId = :sid",
        ExpressionAttributeValues={":sid": suite_id},
    )
    items = result.get("Items", [])

    if tc_id:
        items = [i for i in items if i.get("testCaseId") == tc_id]

    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return response(200, items)
