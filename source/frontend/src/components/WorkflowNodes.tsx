/**
 * Custom React Flow node components for the Conversation Flow canvas.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowStepData } from './workflowUtils';
import type { SavedTool } from '../services/toolsApi';

// Shared tool lookup — set by WorkflowCanvas when tools are loaded
export let availableToolsRef: SavedTool[] = [];
export function setAvailableToolsRef(tools: SavedTool[]) {
  availableToolsRef = tools;
}

// Step node — rectangular card with name, instructions, and tool badges
export function StepNode({ data, selected }: NodeProps) {
  const d = data as unknown as WorkflowStepData;
  return (
    <div
      style={{
        padding: '8px 12px',
        background: selected ? '#eef2ff' : 'white',
        border: selected ? '2px solid #6366f1' : '1px solid #e2e8f0',
        borderRadius: '8px',
        minWidth: '140px',
        maxWidth: '200px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        cursor: 'grab',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#6366f1', width: 8, height: 8 }} />
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '3px' }}>{d.name}</div>
      {d.instructions && (
        <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
          {d.instructions}
        </div>
      )}
      {d.tools && d.tools.length > 0 && (
        <div style={{ marginTop: '4px', display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {d.tools.map((t: string) => {
            const tool = availableToolsRef.find((at) => `int:${at.id}` === t || at.id === t);
            const label = tool ? `${tool.type === 'webhook' ? 'API' : tool.type}: ${tool.name}` : t;
            return <span key={t} style={{ fontSize: '10px', padding: '1px 4px', background: '#f1f5f9', borderRadius: '3px', color: '#64748b' }}>{label}</span>;
          })}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 8, height: 8 }} />
    </div>
  );
}

// Start node — indigo circle, source handle only
export function StartNode({ selected }: NodeProps) {
  return (
    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: selected ? '#4f46e5' : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(99,102,241,0.3)' }}>
      <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>START</span>
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 8, height: 8 }} />
    </div>
  );
}

// End node — dark circle, target handle only
export function EndNode({ selected }: NodeProps) {
  return (
    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: selected ? '#1e293b' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
      <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>END</span>
      <Handle type="target" position={Position.Top} style={{ background: '#334155', width: 8, height: 8 }} />
    </div>
  );
}

export const nodeTypes = { step: StepNode, start: StartNode, end: EndNode };
