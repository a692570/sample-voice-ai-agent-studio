/**
 * Reserved system tools — always included in every agent session.
 * These are handled by the agent runtime and cannot be removed.
 */

export interface ReservedTool {
  id: string;
  name: string;
  description: string;
}

export const RESERVED_TOOLS: ReservedTool[] = [
  {
    id: 'endCallTool',
    name: 'End Call',
    description: 'Gracefully end the call when the caller is done.',
  },
  {
    id: 'transferCall',
    name: 'Transfer Call',
    description: 'Transfer the caller to a live agent or department.',
  },
];

export const RESERVED_TOOL_IDS = RESERVED_TOOLS.map((t) => t.id);

/** Check if a tool ID is a reserved system tool */
export function isReservedTool(toolId: string): boolean {
  return RESERVED_TOOL_IDS.includes(toolId);
}
