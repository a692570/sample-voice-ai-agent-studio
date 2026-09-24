"""RAG Knowledge Base tool builder — standalone module (no fastapi dependency)."""

import json
import logging
import os

logger = logging.getLogger(__name__)


def build_rag_tools(rag_ids: list, api_url: str = "") -> list:
    """Build callable tools for RAG knowledge base queries."""
    import urllib.request
    import urllib.error
    from strands import tool as strands_tool

    if not api_url:
        api_url = os.environ.get("API_URL", "")

    if not api_url:
        logger.warning("API_URL not set — cannot resolve RAG tools")
        return []

    # Fetch RAG source metadata
    rag_sources = {}
    try:
        req = urllib.request.Request(f"{api_url}/rag")
        with urllib.request.urlopen(req, timeout=10) as resp:
            sources = json.loads(resp.read().decode())
            for src in sources:
                rag_sources[src["id"]] = src
    except Exception as e:
        logger.warning(f"Failed to fetch RAG sources: {e}")

    rag_tools = []
    for rag_ref in rag_ids:
        kb_id = rag_ref.replace("rag:", "")
        source_info = rag_sources.get(kb_id, {})
        kb_name = source_info.get("name", f"knowledge_base_{kb_id[:8]}")
        kb_description = source_info.get("description", "")

        func_name = "search_" + "".join(c if c.isalnum() else "_" for c in kb_name.lower()).strip("_")
        tool_description = f"Search the '{kb_name}' knowledge base for relevant information. {kb_description}".strip()

        rag_tool = _make_rag_tool(func_name, tool_description, kb_id, api_url)
        rag_tools.append(rag_tool)
        logger.info(f"RAG tool created: {func_name} (kb={kb_id})")

    return rag_tools


def _make_rag_tool(name, description, kb_id, api_url):
    """Create a tool that queries a RAG knowledge base via Bedrock retrieve API."""
    from strands import tool as strands_tool

    @strands_tool(name=name, description=description)
    def rag_query_tool(question: str) -> str:
        """Search the knowledge base for relevant information."""
        try:
            import boto3
            region = os.environ.get("AWS_REGION", os.environ.get("BEDROCK_REGION", "us-east-1"))
            bedrock_kb_id = os.environ.get("KB_ID", "")
            if not bedrock_kb_id:
                return "Knowledge base not configured (KB_ID env var missing)."

            client = boto3.client("bedrock-agent-runtime", region_name=region)
            retrieve_response = client.retrieve(
                knowledgeBaseId=bedrock_kb_id,
                retrievalQuery={"text": question},
            )
            results = retrieve_response.get("retrievalResults", [])
            if not results:
                return "No relevant information found in the knowledge base."

            # Format top results
            parts = []
            for i, r in enumerate(results[:5], 1):
                text = r.get("content", {}).get("text", "")
                score = r.get("score", 0)
                if text:
                    parts.append(f"{i}. {text[:500]}")
            return "\n\n".join(parts) if parts else "No relevant information found."
        except Exception as e:
            return f"Knowledge base query failed: {str(e)}"

    return rag_query_tool
