"""
Tool Registry — Reserved system tools for voice agent sessions.

These are the two built-in tools that every voice agent has access to:
- endCallTool: Gracefully end the call session
- transferCall: Transfer the caller to a live agent or department

All other tools (knowledge base, CRM, calendar, etc.) should be configured
as custom tools via the Tools UI and attached to agents individually.
"""

from strands import tool


# ─────────────────────────────────────────────────────────────────────────────
# Reserved Tools — always available to every agent
# ─────────────────────────────────────────────────────────────────────────────

@tool
def endCallTool() -> str:
    """End the call gracefully. Invoke when the caller confirms they are done or says goodbye.

    This tool signals the system to close the voice session. After invoking,
    deliver a brief farewell and do not ask further questions.
    """
    return '{"status": "SUCCESS", "message": "Call ended."}'


@tool
def transferCall(department: str = "general", reason: str = "") -> str:
    """Transfer the caller to a live agent or specific department.

    Invoke when the caller requests to speak to a human, or when you cannot
    fulfill their request and a live agent is needed.

    Args:
        department: The department to transfer to (e.g. billing, technical, sales, general).
        reason: Brief reason for the transfer to provide context to the receiving agent.
    """
    return f'{{"status": "SUCCESS", "message": "Transferring to {department}.", "reason": "{reason}"}}'


# ─────────────────────────────────────────────────────────────────────────────
# Registry — reserved tool IDs (always included by the agent runtime)
# ─────────────────────────────────────────────────────────────────────────────

RESERVED_TOOL_IDS = ["endCallTool", "transferCall"]

TOOL_REGISTRY: dict = {
    "endCallTool": endCallTool,
    "transferCall": transferCall,
}
