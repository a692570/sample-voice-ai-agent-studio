/**
 * MCP Gateway API — calls tools/list and tools/call on AgentCore gateways
 * using the user's Cognito JWT token for CUSTOM_JWT auth.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface McpCallResult {
  content: any[];
  isError?: boolean;
}

/**
 * List available tools from an MCP gateway.
 */
export async function mcpListTools(gatewayUrl: string, token: string): Promise<McpTool[]> {
  const endpoint = gatewayUrl.endsWith('/mcp') ? gatewayUrl : `${gatewayUrl}/mcp`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-tools',
      method: 'tools/list',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tools/list failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return (data.result?.tools || []).map((t: any) => ({
    name: t.name || '',
    description: t.description || '',
    inputSchema: t.inputSchema || {},
  }));
}

/**
 * Call a specific tool on an MCP gateway.
 */
export async function mcpCallTool(
  gatewayUrl: string,
  token: string,
  toolName: string,
  args: Record<string, any>
): Promise<McpCallResult> {
  const endpoint = gatewayUrl.endsWith('/mcp') ? gatewayUrl : `${gatewayUrl}/mcp`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-tool',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tools/call failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return {
    content: data.result?.content || [],
    isError: data.result?.isError || false,
  };
}
