"""
Tool Registry — decorator-based tool registration and async execution.

Provides a simple registry for tool handler functions that can be loaded
dynamically by main.py via the `tool_registry_module` config field.

Usage:
    from tools.tool_registry import ToolRegistry

    registry = ToolRegistry()

    @registry.tool("myToolName")
    async def my_tool(tool_input: dict) -> dict:
        return {"result": "value"}

    # Or register programmatically:
    registry.register("otherTool", some_async_function)

    # Execute:
    result = await registry.execute("myToolName", {"param": "value"})
"""

from typing import Any, Callable, Dict, List


class ToolRegistry:
    """Decorator-based tool registration with async execution."""

    def __init__(self):
        self._tools: Dict[str, Callable] = {}

    def tool(self, name: str):
        """Decorator to register a tool handler function.

        Args:
            name: The tool name (must match toolSpec.name in config).

        Returns:
            Decorator function.
        """
        def decorator(func: Callable):
            self._tools[name] = func
            return func
        return decorator

    def register(self, name: str, func: Callable):
        """Register a tool handler function programmatically.

        Args:
            name: The tool name.
            func: Async function that accepts tool_input dict.
        """
        self._tools[name] = func

    def is_registered(self, name: str) -> bool:
        """Check if a tool is registered."""
        return name in self._tools

    def list_tools(self) -> List[str]:
        """Return list of registered tool names."""
        return list(self._tools.keys())

    async def execute(self, name: str, tool_input: Dict[str, Any]) -> Any:
        """Execute a registered tool handler.

        Args:
            name: The tool name to execute.
            tool_input: Input parameters for the tool.

        Returns:
            Tool result as a dict. String results are auto-wrapped as
            {"result": "..."} for compatibility with Nova Sonic's
            toolResult JSON parsing.

        Raises:
            KeyError: If tool is not registered.
        """
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' is not registered")
        result = await self._tools[name](tool_input)
        # Nova Sonic requires tool results to be valid JSON objects.
        # Auto-wrap string results so handlers can return plain text.
        if isinstance(result, str):
            return {"result": result}
        return result
