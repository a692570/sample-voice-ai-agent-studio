"""
Tool Registry — Reserved system tools for voice agent sessions.
"""

try:
    from tools.registry import TOOL_REGISTRY, RESERVED_TOOL_IDS
except ImportError:
    TOOL_REGISTRY = {}
    RESERVED_TOOL_IDS = []

__all__ = ["TOOL_REGISTRY", "RESERVED_TOOL_IDS"]
