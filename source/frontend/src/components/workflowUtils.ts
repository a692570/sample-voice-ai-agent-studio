/**
 * Shared types and utilities for the Conversation Flow canvas.
 */

import type { Node, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

export interface WorkflowStepData {
  name: string;
  instructions: string;
  tools: string[];
}

export interface WorkflowData {
  nodes: any[];
  edges: any[];
  editedPrompt?: string | null;
  editedTools?: string[];
}

// Predefined step templates for the palette
export const PREDEFINED_TEMPLATES: { name: string; instructions: string; tools: string[] }[] = [
  { name: 'Greeting', instructions: 'Welcome the caller warmly. Introduce yourself and ask how you can help.', tools: [] },
  { name: 'Authentication', instructions: 'Verify the caller\'s identity by asking for their account number, name, or date of birth.', tools: ['crm'] },
  { name: 'Inquiry', instructions: 'Listen to the customer\'s question and look up relevant information.', tools: ['knowledge-base'] },
  { name: 'Order Lookup', instructions: 'Check the status of the customer\'s order using the order ID they provide.', tools: ['order-status'] },
  { name: 'Payment', instructions: 'Help the customer make a payment or check their balance.', tools: ['payment'] },
  { name: 'Scheduling', instructions: 'Help the customer book, reschedule, or cancel an appointment.', tools: ['calendar'] },
  { name: 'Transfer', instructions: 'If you cannot resolve the issue, offer to transfer the caller to a live agent.', tools: ['transfer'] },
  { name: 'Closing', instructions: 'Summarize what was accomplished. Ask if there\'s anything else. Say goodbye.', tools: [] },
];

// Default edge styling
export const defaultEdgeOptions = {
  animated: true,
  style: { stroke: '#a5b4fc', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
};

// Initial canvas state
export const INITIAL_NODES: Node[] = [
  { id: 'start', type: 'start', position: { x: 250, y: 0 }, data: { name: 'Start', instructions: '', tools: [] }, deletable: false },
  { id: 'step_0', type: 'step', position: { x: 180, y: 80 }, data: { name: 'Greeting', instructions: 'Welcome the caller and ask how you can help.', tools: [], nodeId: 'step_0' } },
  { id: 'end', type: 'end', position: { x: 250, y: 180 }, data: { name: 'End', instructions: '', tools: [] }, deletable: false },
];

export const INITIAL_EDGES: Edge[] = [
  { id: 'e-start-0', source: 'start', target: 'step_0', ...defaultEdgeOptions, type: 'smoothstep' },
  { id: 'e-0-end', source: 'step_0', target: 'end', ...defaultEdgeOptions, type: 'smoothstep' },
];

// Unique ID generator for new nodes
let nodeIdCounter = 0;
export function getNodeId() {
  nodeIdCounter += 1;
  return `step_${Date.now()}_${nodeIdCounter}`;
}

/**
 * Generate a system prompt and tools list from a workflow canvas state.
 */
export function generatePromptFromWorkflow(data: WorkflowData): { prompt: string; tools: string[] } {
  const { nodes, edges } = data;
  const adjacency: Record<string, { target: string; label: string }[]> = {};
  edges.forEach((e: any) => {
    if (!adjacency[e.source]) adjacency[e.source] = [];
    adjacency[e.source].push({ target: e.target, label: (e.label as string) || '' });
  });

  const lines: string[] = [];
  lines.push('You are a voice agent. Follow this conversation flow:\n');
  nodes.forEach((node: any) => {
    if (node.type === 'start' || node.type === 'end') return;
    const d = node.data as WorkflowStepData;
    lines.push(`## ${d.name}`);
    if (d.instructions) lines.push(d.instructions);
    if (d.tools && d.tools.length > 0) lines.push(`Tools available: ${d.tools.join(', ')}`);
    const outgoing = adjacency[node.id] || [];
    if (outgoing.length === 1 && !outgoing[0].label) {
      const targetNode = nodes.find((n: any) => n.id === outgoing[0].target);
      if (targetNode && targetNode.type !== 'end') lines.push(`Then proceed to: ${(targetNode.data as WorkflowStepData).name}`);
    } else if (outgoing.length > 0) {
      lines.push('Next:');
      outgoing.forEach((o: any) => {
        const targetNode = nodes.find((n: any) => n.id === o.target);
        if (targetNode) {
          const targetName = targetNode.type === 'end' ? 'End conversation' : (targetNode.data as WorkflowStepData).name;
          lines.push(o.label ? `  - If ${o.label} → go to "${targetName}"` : `  - Go to "${targetName}"`);
        }
      });
    }
    lines.push('');
  });
  lines.push('Follow the defined flow. Use branching conditions to decide which step to go to next.');
  const prompt = lines.join('\n');
  const allTools = [...new Set(nodes.flatMap((n: any) => ((n.data as WorkflowStepData)?.tools || []).filter(Boolean)))];
  return { prompt, tools: allTools };
}
