"""
Lambda handler for Knowledge Base Management API.

Uses a single customer-managed Bedrock KB. Each "Create" from the UI adds
a new S3 data source to the KB. Upload/sync/query operate per data source.

Handles:
  GET    /rag              — List all data sources in the KB
  POST   /rag              — Create a new data source
  GET    /rag/{id}         — Get data source details
  DELETE /rag/{id}         — Delete a data source
  POST   /rag/{id}/upload  — Get presigned URL for doc upload
  GET    /rag/{id}/files   — List files with download URLs
  POST   /rag/{id}/sync    — Start ingestion job
  POST   /rag/{id}/query   — Test retrieval
"""

import json
import os
import random
import re
import string

import boto3

DOCS_BUCKET = os.environ.get("DOCS_BUCKET", "")
# Deploy-time fallback KB id. The primary source is the value set from the UI and
# stored in the config table below; this env var is only used if nothing is set.
KB_ID_ENV = os.environ.get("KB_ID", "")
KB_ROLE_ARN = os.environ.get("KB_ROLE_ARN", "")
REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

# DynamoDB table holding app config (a single item keeps the KB id). The KB id is
# not a secret — it is a Bedrock Knowledge Base identifier the user creates in
# their own account and pastes into the UI.
CONFIG_TABLE_NAME = os.environ.get("CONFIG_TABLE_NAME", "")
CONFIG_KEY = "rag"  # partition-key value for the single config item

bedrock_agent = boto3.client("bedrock-agent", region_name=REGION)
bedrock_runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)
s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb", region_name=REGION)


def _config_table():
    if not CONFIG_TABLE_NAME:
        return None
    return dynamodb.Table(CONFIG_TABLE_NAME)


def get_kb_id() -> str:
    """Resolve the active Knowledge Base id.

    Precedence: the value set from the UI (stored in the config table) first,
    then the KB_ID env var as a deploy-time fallback. Returns "" when neither is
    set, which callers treat as "RAG not configured".
    """
    table = _config_table()
    if table is not None:
        try:
            item = table.get_item(Key={"configKey": CONFIG_KEY}).get("Item")
            if item and item.get("kbId"):
                return str(item["kbId"])
        except Exception as e:  # pragma: no cover
            print(f"get_kb_id: config table read failed: {e}")
    return KB_ID_ENV


def get_config():
    """Return the current RAG config (KB id) for the UI."""
    return response(200, {"kbId": get_kb_id()})


def list_knowledge_bases():
    """List Bedrock Knowledge Bases that exist in this account/region so the UI
    can offer them for selection. Returns id/name/status only."""
    try:
        kbs = []
        params = {"maxResults": 100}
        while True:
            result = bedrock_agent.list_knowledge_bases(**params)
            for kb in result.get("knowledgeBaseSummaries", []):
                kbs.append({
                    "id": kb.get("knowledgeBaseId", ""),
                    "name": kb.get("name", ""),
                    "status": kb.get("status", ""),
                })
            token = result.get("nextToken")
            if not token:
                break
            params["nextToken"] = token
        kbs.sort(key=lambda k: k.get("name", "").lower())
        return response(200, kbs)
    except Exception as e:
        return response(500, {"error": f"Failed to list knowledge bases: {str(e)}"})


def put_config(body: dict):
    """Persist the UI-provided KB id. Empty string clears it."""
    kb_id = str(body.get("kbId", "")).strip()
    table = _config_table()
    if table is None:
        return response(500, {"error": "Config store is not available (CONFIG_TABLE_NAME unset)."})
    table.put_item(Item={"configKey": CONFIG_KEY, "kbId": kb_id})
    return response(200, {"kbId": kb_id})


def generate_slug_id(name):
    """Generate a human-readable ID from name + 5 random chars."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s]+', '-', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')
    suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"{slug}-{suffix}" if slug else suffix

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

    if http_method == "OPTIONS":
        return response(200, {})

    try:
        if http_method == "GET" and path.endswith("/rag/config"):
            return get_config()
        elif http_method == "PUT" and path.endswith("/rag/config"):
            body = json.loads(event.get("body") or "{}")
            return put_config(body)
        elif http_method == "GET" and path.endswith("/rag/knowledge-bases"):
            return list_knowledge_bases()
        elif http_method == "GET" and path == "/rag":
            return list_sources()
        elif http_method == "POST" and path == "/rag":
            body = json.loads(event.get("body") or "{}")
            return create_source(body)
        elif http_method == "GET" and "id" in path_params and "/files" not in path and "/upload" not in path:
            return get_source(path_params["id"])
        elif http_method == "DELETE" and "id" in path_params:
            return delete_source(path_params["id"])
        elif http_method == "POST" and "id" in path_params and path.endswith("/upload"):
            body = json.loads(event.get("body") or "{}")
            return get_upload_url(path_params["id"], body)
        elif http_method == "GET" and "id" in path_params and path.endswith("/files"):
            return list_files(path_params["id"])
        elif http_method == "POST" and "id" in path_params and path.endswith("/sync"):
            return sync_source(path_params["id"])
        elif http_method == "POST" and "id" in path_params and path.endswith("/query"):
            body = json.loads(event.get("body") or "{}")
            return query_source(path_params["id"], body)
        else:
            return response(404, {"error": "Not found"})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def list_sources():
    """List all data sources in the KB."""
    kb_id = get_kb_id()
    if not kb_id:
        # No KB configured yet — the RAG feature is optional and the KB id is set
        # from the UI. Return an empty list so the page renders cleanly instead of
        # erroring.
        return response(200, [])

    try:
        result = bedrock_agent.list_data_sources(knowledgeBaseId=kb_id, maxResults=100)
        sources = []
        for ds in result.get("dataSourceSummaries", []):
            # Count docs in S3 for this data source
            ds_name = ds.get("name", ds["dataSourceId"])
            s3_prefix = f"rag-sources/{ds_name}/"
            doc_count = 0
            try:
                files = s3_client.list_objects_v2(Bucket=DOCS_BUCKET, Prefix=s3_prefix)
                doc_count = len(files.get("Contents", []))
            except Exception:
                pass

            # Get last ingestion job status
            last_sync = ""
            last_sync_status = ""
            try:
                jobs = bedrock_agent.list_ingestion_jobs(
                    knowledgeBaseId=kb_id,
                    dataSourceId=ds["dataSourceId"],
                    maxResults=1,
                    sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
                )
                if jobs.get("ingestionJobSummaries"):
                    job = jobs["ingestionJobSummaries"][0]
                    last_sync_status = job.get("status", "")
                    last_sync = str(job.get("updatedAt", job.get("startedAt", "")))
            except Exception:
                pass

            sources.append({
                "id": ds["dataSourceId"],
                "name": ds_name,
                "description": ds.get("description", ""),
                "status": ds.get("status", "UNKNOWN"),
                "documentCount": doc_count,
                "updatedAt": str(ds.get("updatedAt", "")),
                "lastSync": last_sync,
                "lastSyncStatus": last_sync_status,
            })
        return response(200, sources)
    except bedrock_agent.exceptions.ResourceNotFoundException:
        # The configured KB id points to a KB that doesn't exist in this account
        # (e.g. a stale id). Treat as "no KB configured" so the page shows an
        # empty state rather than an error.
        print(f"KB id '{kb_id}' not found in this account; returning empty list.")
        return response(200, [])
    except Exception as e:
        return response(500, {"error": f"Failed to list: {str(e)}"})


def create_source(body):
    """Create a new S3 data source in the KB."""
    kb_id = get_kb_id()
    if not kb_id:
        return response(400, {"error": "Knowledge Base is not configured. Set the KB ID first."})

    name = body.get("name", "").strip()
    description = body.get("description", "").strip()

    if not name:
        return response(400, {"error": "name is required"})

    # Check for duplicate name in existing data sources
    try:
        existing = bedrock_agent.list_data_sources(knowledgeBaseId=kb_id, maxResults=100)
        existing_names = [ds.get("name", "").lower() for ds in existing.get("dataSourceSummaries", [])]
        if name.lower() in existing_names:
            return response(409, {"error": f"A knowledge base with name '{name}' already exists"})
    except Exception:
        pass  # If check fails, proceed with creation

    # Generate slug-based ID for the data source name
    unique_name = generate_slug_id(name)
    s3_prefix = f"rag-sources/{unique_name}/"

    # Try standard CreateDataSource first (customer-managed KB)
    try:
        result = bedrock_agent.create_data_source(
            knowledgeBaseId=kb_id,
            name=unique_name,
            description=description or name,
            dataSourceConfiguration={
                "type": "S3",
                "s3Configuration": {
                    "bucketArn": f"arn:aws:s3:::{DOCS_BUCKET}",
                    "inclusionPrefixes": [s3_prefix],
                },
            },
        )
        ds = result["dataSource"]
        return response(201, {
            "id": ds["dataSourceId"],
            "name": ds.get("name", unique_name),
            "description": ds.get("description", ""),
            "status": ds.get("status", "AVAILABLE"),
            "documentCount": 0,
            "updatedAt": str(ds.get("updatedAt", "")),
        })
    except Exception as e:
        if "Unsupported data source type" not in str(e):
            return response(500, {"error": f"Failed to create: {str(e)}"})

    # Fallback: managed KB — use MANAGED_KNOWLEDGE_BASE_CONNECTOR via raw API
    try:
        import urllib.request
        import urllib.error
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest

        session = boto3.Session()
        credentials = session.get_credentials().get_frozen_credentials()

        url = f"https://bedrock-agent.{REGION}.amazonaws.com/knowledgebases/{kb_id}/datasources"
        body_data = json.dumps({
            "name": unique_name,
            "description": description or name,
            "dataSourceConfiguration": {
                "type": "MANAGED_KNOWLEDGE_BASE_CONNECTOR",
                "managedKnowledgeBaseConnectorConfiguration": {
                    "connectorParameters": {
                        "type": "S3",
                        "version": "1",
                        "connectionConfiguration": {
                            "bucketName": DOCS_BUCKET,
                            "bucketOwnerAccountId": os.environ.get("AWS_ACCOUNT_ID", ""),
                        },
                        "filterConfiguration": {
                            "inclusionPrefixes": [s3_prefix],
                        },
                    }
                }
            }
        }).encode()

        request = AWSRequest(method="PUT", url=url, data=body_data, headers={"Content-Type": "application/json"})
        SigV4Auth(credentials, "bedrock", REGION).add_auth(request)
        req = urllib.request.Request(url=url, data=body_data, headers=dict(request.headers), method="PUT")

        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            ds = result["dataSource"]
            return response(201, {
                "id": ds["dataSourceId"],
                "name": ds.get("name", unique_name),
                "description": ds.get("description", ""),
                "status": ds.get("status", "CREATING"),
                "documentCount": 0,
                "updatedAt": str(ds.get("updatedAt", "")),
            })
    except Exception as e2:
        return response(500, {"error": f"Failed to create managed data source: {str(e2)}"})


def get_source(source_id):
    """Get data source details."""
    kb_id = get_kb_id()
    if not kb_id:
        return response(404, {"error": "KB not configured"})

    try:
        result = bedrock_agent.get_data_source(knowledgeBaseId=kb_id, dataSourceId=source_id)
        ds = result["dataSource"]
        ds_name = ds.get("name", source_id)
        s3_prefix = f"rag-sources/{ds_name}/"
        doc_count = 0
        try:
            files = s3_client.list_objects_v2(Bucket=DOCS_BUCKET, Prefix=s3_prefix)
            doc_count = len(files.get("Contents", []))
        except Exception:
            pass

        return response(200, {
            "id": source_id,
            "name": ds_name,
            "description": ds.get("description", ""),
            "status": ds.get("status", ""),
            "documentCount": doc_count,
            "updatedAt": str(ds.get("updatedAt", "")),
        })
    except Exception as e:
        return response(500, {"error": str(e)})


def delete_source(source_id):
    """Delete a data source and its S3 docs."""
    kb_id = get_kb_id()
    if not kb_id:
        return response(404, {"error": "KB not configured"})

    # Get name for S3 cleanup
    try:
        ds = bedrock_agent.get_data_source(knowledgeBaseId=kb_id, dataSourceId=source_id)
        ds_name = ds["dataSource"].get("name", source_id)
    except Exception:
        ds_name = source_id

    # Delete from Bedrock
    try:
        bedrock_agent.delete_data_source(knowledgeBaseId=kb_id, dataSourceId=source_id)
    except Exception as e:
        print(f"Warning deleting data source: {e}")

    # Clean S3
    s3_prefix = f"rag-sources/{ds_name}/"
    try:
        objects = s3_client.list_objects_v2(Bucket=DOCS_BUCKET, Prefix=s3_prefix)
        if "Contents" in objects:
            delete_keys = [{"Key": obj["Key"]} for obj in objects["Contents"]]
            s3_client.delete_objects(Bucket=DOCS_BUCKET, Delete={"Objects": delete_keys})
    except Exception:
        pass

    return response(200, {"message": "Deleted", "id": source_id})


def get_upload_url(source_id, body):
    """Generate presigned URL for document upload."""
    filename = body.get("filename", "").strip()
    content_type = body.get("contentType", "application/octet-stream")

    if not filename:
        return response(400, {"error": "filename is required"})

    # Get data source name for S3 prefix
    ds_name = source_id
    kb_id = get_kb_id()
    if kb_id:
        try:
            ds = bedrock_agent.get_data_source(knowledgeBaseId=kb_id, dataSourceId=source_id)
            ds_name = ds["dataSource"].get("name", source_id)
        except Exception:
            pass

    s3_key = f"rag-sources/{ds_name}/{filename}"
    presigned_url = s3_client.generate_presigned_url(
        "put_object",
        Params={"Bucket": DOCS_BUCKET, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=3600,
    )
    return response(200, {"uploadUrl": presigned_url, "s3Key": s3_key})


def list_files(source_id):
    """List uploaded files with download URLs."""
    ds_name = source_id
    kb_id = get_kb_id()
    if kb_id:
        try:
            ds = bedrock_agent.get_data_source(knowledgeBaseId=kb_id, dataSourceId=source_id)
            ds_name = ds["dataSource"].get("name", source_id)
        except Exception:
            pass

    s3_prefix = f"rag-sources/{ds_name}/"
    try:
        objects = s3_client.list_objects_v2(Bucket=DOCS_BUCKET, Prefix=s3_prefix)
        files = []
        for obj in objects.get("Contents", []):
            key = obj["Key"]
            filename = key.split("/")[-1]
            if not filename:
                continue
            download_url = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": DOCS_BUCKET, "Key": key},
                ExpiresIn=3600,
            )
            files.append({
                "filename": filename,
                "key": key,
                "size": obj["Size"],
                "lastModified": obj["LastModified"].isoformat(),
                "downloadUrl": download_url,
            })
        return response(200, files)
    except Exception as e:
        return response(500, {"error": f"Failed to list files: {str(e)}"})


def sync_source(source_id):
    """Start ingestion job for a data source."""
    kb_id = get_kb_id()
    if not kb_id:
        return response(400, {"error": "KB not configured"})

    try:
        result = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=source_id,
        )
        job_id = result["ingestionJob"]["ingestionJobId"]
        status = result["ingestionJob"]["status"]
        return response(200, {"message": f"Ingestion {status}", "jobId": job_id})
    except Exception as e:
        return response(500, {"error": f"Sync failed: {str(e)}"})


def _citation_source(location: dict) -> str:
    """Derive a human-friendly source label from a Bedrock retrieval location.

    Handles the common location types (S3, web, Confluence, SharePoint, Salesforce);
    for S3 it returns just the file name. Falls back to "Knowledge Base".
    """
    if not isinstance(location, dict):
        return "Knowledge Base"
    s3_uri = location.get("s3Location", {}).get("uri", "")
    if s3_uri:
        # s3://bucket/rag-sources/<name>/<file> -> <file>
        return s3_uri.rstrip("/").split("/")[-1] or s3_uri
    web_url = location.get("webLocation", {}).get("url", "")
    if web_url:
        return web_url
    for key in ("confluenceLocation", "sharePointLocation", "salesforceLocation"):
        url = location.get(key, {}).get("url", "")
        if url:
            return url
    return "Knowledge Base"


def query_source(source_id, body):
    """Query the KB filtered to this data source."""
    kb_id = get_kb_id()
    if not kb_id:
        return response(400, {"error": "KB not configured"})

    question = body.get("question", "").strip()
    if not question:
        return response(400, {"error": "question is required"})

    try:
        # Retrieve — managed KBs don't support vectorSearchConfiguration
        retrieve_response = bedrock_runtime.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": question},
        )

        results = retrieve_response.get("retrievalResults", [])
        if not results:
            return response(200, {"answer": "No relevant information found.", "citations": []})

        # Collect context + build clean, de-duplicated citations
        context_parts = []
        citations = []
        seen_snippets = set()
        for r in results:
            text = r.get("content", {}).get("text", "")
            if not text:
                continue
            context_parts.append(text)

            # Normalize whitespace/newlines so it reads cleanly, but keep the
            # FULL chunk text — the UI shows a preview and lets the user expand.
            snippet = " ".join(text.split())

            # Skip near-duplicate snippets (overlapping chunks from the same doc).
            dedupe_key = snippet[:120]
            if dedupe_key in seen_snippets:
                continue
            seen_snippets.add(dedupe_key)

            source = _citation_source(r.get("location", {}))
            score = r.get("score")
            citations.append({
                "text": snippet,
                "source": source,
                "location": source,  # kept for backward compatibility
                "score": round(score, 3) if isinstance(score, (int, float)) else None,
            })

        context = "\n\n".join(context_parts[:5])

        # Generate with Nova Lite
        bedrock_llm = boto3.client("bedrock-runtime", region_name=REGION)
        llm_response = bedrock_llm.invoke_model(
            modelId="amazon.nova-lite-v1:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "messages": [{"role": "user", "content": [{"text": f"Based on the following context, answer concisely.\n\nContext:\n{context}\n\nQuestion: {question}\n\nAnswer:"}]}],
                "inferenceConfig": {"maxTokens": 500},
            }),
        )
        llm_body = json.loads(llm_response["body"].read())
        answer = llm_body["output"]["message"]["content"][0]["text"]

        return response(200, {"answer": answer, "citations": citations[:5]})
    except Exception as e:
        return response(500, {"error": f"Query failed: {str(e)}"})


def response(status_code, body):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, default=str),
    }
