import { useState, useCallback, useMemo, useRef, useEffect, useContext } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { listTools } from '../services/toolsApi';
import type { SavedTool } from '../services/toolsApi';
import { getGatewayDetail } from '../services/toolsApi';
import type { GatewayDetail } from '../services/toolsApi';
import { listRAGSources } from '../services/ragApi';
import type { RAGSource } from '../services/ragApi';
import { generatePromptFromApi } from '../services/generatePrompt';
import { WizardContext } from '../context/WizardContext';
import { WorkflowStepData, WorkflowData, PREDEFINED_TEMPLATES, defaultEdgeOptions, INITIAL_NODES, INITIAL_EDGES, getNodeId } from './workflowUtils';
export type { WorkflowStepData, WorkflowData } from './workflowUtils';

interface WorkflowCanvasProps {
  onGenerate?: (systemPrompt: string, tools: string[]) => void;
  initialData?: WorkflowData | null;
  initialPrompt?: string | null;
  initialTools?: string[] | null;
  onSave?: (data: WorkflowData) => void;
  onStateChange?: (data: WorkflowData) => void;
}



// Shared tool lookup for node rendering
let _availableToolsRef: SavedTool[] = [];

// Custom node component
function StepNode({ data, selected }: NodeProps) {
  const d = data as unknown as WorkflowStepData & { onEdit: (id: string) => void; nodeId: string };
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{d.name}</span>
      </div>
      {d.instructions && (
        <div style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
          {d.instructions}
        </div>
      )}
      {d.tools && d.tools.length > 0 && (
        <div style={{ marginTop: '4px', display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {d.tools.map((t: string) => {
            const tool = _availableToolsRef.find((at) => `int:${at.id}` === t || at.id === t);
            const label = tool ? `${tool.type === 'webhook' ? 'API' : tool.type}: ${tool.name}` : t;
            return <span key={t} style={{ fontSize: '10px', padding: '1px 4px', background: '#f1f5f9', borderRadius: '3px', color: '#64748b' }}>{label}</span>;
          })}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} id="tool-out" style={{ background: '#f59e0b', width: 7, height: 7, top: '50%' }} />
    </div>
  );
}

// Start node — circle with only a source handle
function StartNode({ selected }: NodeProps) {
  return (
    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: selected ? '#4f46e5' : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(99,102,241,0.3)' }}>
      <span style={{ color: 'white', fontSize: '13px', fontWeight: 700 }}>START</span>
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 8, height: 8 }} />
    </div>
  );
}

// End node — circle with only a target handle
function EndNode({ selected }: NodeProps) {
  return (
    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: selected ? '#1e293b' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
      <span style={{ color: 'white', fontSize: '13px', fontWeight: 700 }}>END</span>
      <Handle type="target" position={Position.Top} style={{ background: '#334155', width: 8, height: 8 }} />
    </div>
  );
}

// Tool/Skill/SubAgent node — small box with icon and target handle
function ToolNode({ data, selected }: NodeProps) {
  const d = data as unknown as { name: string; toolType: string; toolId: string };
  const colorMap: Record<string, string> = { webhook: '#94a3b8', lambda: '#94a3b8', mcp: '#94a3b8', subagent: '#94a3b8', skill: '#94a3b8' };
  // SVG line-style icons per type
  const iconSvg: Record<string, any> = {
    webhook: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    lambda: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20l8-16 8 16"/><path d="M8 12h8"/></svg>,
    mcp: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
    subagent: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    skill: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  };
  return (
    <div style={{
      padding: '6px 10px',
      background: selected ? '#f8fafc' : 'white',
      border: selected ? '2px solid #64748b' : '1px solid #e2e8f0',
      borderRadius: '6px',
      minWidth: '100px',
      maxWidth: '160px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      cursor: 'grab',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#94a3b8', width: 7, height: 7 }} />
      <span style={{ display: 'flex', flexShrink: 0 }}>{iconSvg[d.toolType] || iconSvg.webhook}</span>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
    </div>
  );
}

const nodeTypes = { step: StepNode, start: StartNode, end: EndNode, tool: ToolNode };




function WorkflowCanvas({ onGenerate, initialData, initialPrompt, initialTools, onSave, onStateChange }: WorkflowCanvasProps) {
  // Safely access wizard context (may not be available in all render contexts)
  const wizardCtx = useContext(WizardContext);
  const state = wizardCtx?.state ?? null;
  const dispatch = wizardCtx?.dispatch ?? null;
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData?.nodes || INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialData?.edges || INITIAL_EDGES);
  const initialLoadedRef = useRef(false);

  // --- Undo / Redo history ---
  const historyRef = useRef<{ past: { nodes: Node[]; edges: Edge[] }[]; future: { nodes: Node[]; edges: Edge[] }[] }>({ past: [], future: [] });
  const isUndoRedoRef = useRef(false);
  const lastSnapshotRef = useRef<string>('');

  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const current = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    future.push(current);
    const prev = past.pop()!;
    isUndoRedoRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    lastSnapshotRef.current = JSON.stringify(prev);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const current = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    past.push(current);
    const next = future.pop()!;
    isUndoRedoRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    lastSnapshotRef.current = JSON.stringify(next);
  }, [nodes, edges, setNodes, setEdges]);

  // Record snapshots on meaningful state changes (skip undo/redo-triggered changes)
  const prevNodesRef = useRef<string>(JSON.stringify(initialData?.nodes || INITIAL_NODES));
  const prevEdgesRef = useRef<string>(JSON.stringify(initialData?.edges || INITIAL_EDGES));

  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      prevNodesRef.current = JSON.stringify(nodes);
      prevEdgesRef.current = JSON.stringify(edges);
      return;
    }
    const nodesStr = JSON.stringify(nodes);
    const edgesStr = JSON.stringify(edges);
    if (nodesStr !== prevNodesRef.current || edgesStr !== prevEdgesRef.current) {
      // Push previous state to history
      const prevSnapshot = JSON.stringify({ nodes: JSON.parse(prevNodesRef.current), edges: JSON.parse(prevEdgesRef.current) });
      if (prevSnapshot !== lastSnapshotRef.current) {
        historyRef.current.past.push({ nodes: JSON.parse(prevNodesRef.current), edges: JSON.parse(prevEdgesRef.current) });
        historyRef.current.future = [];
        lastSnapshotRef.current = prevSnapshot;
        if (historyRef.current.past.length > 50) historyRef.current.past.shift();
      }
      prevNodesRef.current = nodesStr;
      prevEdgesRef.current = edgesStr;
    }
  }, [nodes, edges]);

  // Keyboard shortcut: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || (e.key === 'y' && !e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Load saved workflow data only once when it first becomes available
  useEffect(() => {
    if (initialLoadedRef.current) return;
    if (initialData?.nodes && initialData.nodes.length > 0) {
      setNodes(initialData.nodes);
      if (initialData.edges) setEdges(initialData.edges);
      initialLoadedRef.current = true;
    }
  }, [initialData]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(initialPrompt || null);
  const [editedPrompt, setEditedPrompt] = useState<string | null>(initialPrompt || null);
  const [promptDirty, setPromptDirty] = useState(false);
  const [editedToolsList, setEditedToolsList] = useState<string[] | null>(null); // Override for tools list (when user adds/removes tools directly)
  const [toolInstructions, setToolInstructions] = useState<Record<string, string>>({});
  const [toolsDirty, setToolsDirty] = useState(false);
  const [toolParameters, setToolParameters] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'code' | 'preview'>('preview');
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [availableTools, setAvailableTools] = useState<SavedTool[]>([]);
  const [ragSources, setRagSources] = useState<RAGSource[]>([]);
  const [toolSearch, setToolSearch] = useState('');
  const [toolDetailId, setToolDetailId] = useState<string | null>(null);
  const [expandedGateway, setExpandedGateway] = useState<string | null>(null);
  const [gatewayToolsCache, setGatewayToolsCache] = useState<Record<string, GatewayDetail['mcpTools']>>({});

  useEffect(() => {
    listTools().then((tools) => {
      setAvailableTools(tools);
      _availableToolsRef = tools;
    }).catch(() => {});
    listRAGSources().then((sources) => {
      setRagSources(sources);
    }).catch(() => {});
  }, []);

  // Auto-adjust End node position when other nodes are added or moved
  useEffect(() => {
    const endNode = nodes.find((n) => n.id === 'end');
    if (!endNode) return;
    const otherNodes = nodes.filter((n) => n.id !== 'end' && n.id !== 'start');
    if (otherNodes.length === 0) return;
    const maxY = otherNodes.reduce((max, n) => Math.max(max, n.position.y), 0);
    const desiredEndY = maxY + 120;
    if (endNode.position.y < desiredEndY) {
      setNodes((prev) => prev.map((n) => n.id === 'end' ? { ...n, position: { ...n.position, y: desiredEndY } } : n));
    }
  }, [nodes, setNodes]);

  // Notify parent of state changes
  useEffect(() => {
    const { tools } = buildPromptAndTools();
    onStateChange?.({ nodes, edges, editedPrompt, editedTools: tools });
  }, [nodes, edges, editedPrompt, editedToolsList]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId), [nodes, selectedNodeId]);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions, label: '', type: 'smoothstep' }, eds));
  }, [setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    // Check if this is a tool drop (not a step)
    const toolDropJson = event.dataTransfer.getData('application/tool-drop');
    if (toolDropJson) {
      const { toolId, name } = JSON.parse(toolDropJson);
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = {
        x: event.clientX - bounds.left - 50,
        y: event.clientY - bounds.top - 15,
      };

      // Determine tool type from availableTools
      const tool = availableTools.find((t) => `int:${t.id}` === toolId || t.id === toolId);
      const toolType = tool?.type || 'webhook';

      // Create a tool node on the canvas
      const id = `tool_${Date.now()}`;
      const newNode: Node = {
        id,
        type: 'tool',
        position,
        data: { name, toolType, toolId },
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(id);
      return;
    }

    const templateJson = event.dataTransfer.getData('application/reactflow');
    if (!templateJson) return;

    const template = JSON.parse(templateJson);
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;

    const position = {
      x: event.clientX - bounds.left - 80,
      y: event.clientY - bounds.top - 20,
    };

    const id = getNodeId();
    const newNode: Node = {
      id,
      type: 'step',
      position,
      data: {
        name: template.name || 'New Step',
        instructions: template.instructions || '',
        tools: template.tools || [],
        nodeId: id,
      },
    };

    // Check if dropped near an existing edge — if so, insert into the flow
    const dropX = position.x + 80; // center of new node
    const dropY = position.y + 20;
    const THRESHOLD = 60; // px proximity to consider "on an edge"

    let insertedIntoEdge = false;
    setEdges((prevEdges) => {
      // Find an edge whose source/target Y range encompasses the drop point
      for (const edge of prevEdges) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        const sourceY = sourceNode.position.y + 40; // bottom of source
        const targetY = targetNode.position.y; // top of target
        const midX = (sourceNode.position.x + targetNode.position.x) / 2 + 80;

        // Check if drop is between source and target vertically, and roughly aligned horizontally
        if (dropY > sourceY - THRESHOLD && dropY < targetY + THRESHOLD && Math.abs(dropX - midX) < 120) {
          // Remove the old edge and create two new ones
          const newEdges = prevEdges.filter((e) => e.id !== edge.id);
          newEdges.push({
            id: `e-${edge.source}-${id}`,
            source: edge.source,
            target: id,
            ...defaultEdgeOptions,
            type: 'smoothstep',
            label: edge.label || '',
          });
          newEdges.push({
            id: `e-${id}-${edge.target}`,
            source: id,
            target: edge.target,
            ...defaultEdgeOptions,
            type: 'smoothstep',
          });
          insertedIntoEdge = true;
          return newEdges;
        }
      }
      return prevEdges;
    });

    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(id);

    // If not inserted into an edge, just add the node without connections
    if (!insertedIntoEdge) {
      // Node added without auto-connection — user can connect manually
    }
  }, [setNodes, setEdges, nodes]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const addNode = useCallback((template?: typeof PREDEFINED_TEMPLATES[0]) => {
    const id = getNodeId();
    const newNode: Node = {
      id,
      type: 'step',
      position: { x: 180, y: 0 }, // position will be set in updater
      data: {
        name: template?.name || 'New Step',
        instructions: template?.instructions || '',
        tools: template?.tools || [],
        nodeId: id,
      },
    };
    setNodes((prev) => {
      const maxY = prev.reduce((max, n) => Math.max(max, n.position.y), 0);
      newNode.position = { x: 180, y: maxY + 100 };
      return prev
        .map((n) => n.id === 'end' ? { ...n, position: { ...n.position, y: maxY + 200 } } : n)
        .concat(newNode);
    });
    setSelectedNodeId(id);
  }, [setNodes]);

  const updateNodeData = useCallback((id: string, updates: Partial<WorkflowStepData>) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...updates } } : n));
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }, [setNodes, setEdges, selectedNodeId]);

  const updateEdgeLabel = useCallback((edgeId: string, label: string) => {
    setEdges((prev) => prev.map((e) => e.id === edgeId ? { ...e, label } : e));
  }, [setEdges]);

  const buildPromptAndTools = useCallback(() => {
    const adjacency: Record<string, { target: string; label: string }[]> = {};
    edges.forEach((e) => {
      if (!adjacency[e.source]) adjacency[e.source] = [];
      adjacency[e.source].push({ target: e.target, label: (e.label as string) || '' });
    });

    const lines: string[] = [];
    lines.push('You are a voice agent. Follow this conversation flow:\n');
    nodes.forEach((node) => {
      const d = node.data as unknown as WorkflowStepData;
      if (node.type === 'start' || node.type === 'end' || node.type === 'tool') return;
      lines.push(`## ${d.name}`);
      if (d.instructions) lines.push(d.instructions);
      if (d.tools && d.tools.length > 0) lines.push(`Tools available: ${d.tools.join(', ')}`);
      const outgoing = adjacency[node.id] || [];
      if (outgoing.length === 1 && !outgoing[0].label) {
        const targetNode = nodes.find((n) => n.id === outgoing[0].target);
        if (targetNode && targetNode.type !== 'end') lines.push(`Then proceed to: ${(targetNode.data as unknown as WorkflowStepData).name}`);
      } else if (outgoing.length > 0) {
        lines.push('Next:');
        outgoing.forEach((o) => {
          const targetNode = nodes.find((n) => n.id === o.target);
          if (targetNode) {
            const targetName = targetNode.type === 'end' ? 'End conversation' : (targetNode.data as unknown as WorkflowStepData).name;
            lines.push(o.label ? `  - If ${o.label} → go to "${targetName}"` : `  - Go to "${targetName}"`);
          }
        });
      }
      lines.push('');
    });
    lines.push('Follow the defined flow. Use branching conditions to decide which step to go to next.');
    const prompt = lines.join('\n');
    const allTools = [...new Set(nodes.filter((n) => n.type === "step").flatMap((n) => ((n.data as unknown as WorkflowStepData).tools || [])).filter(Boolean))];
    // If user has explicitly edited tools list, use that; else fall back to nodes or initialTools
    const tools = editedToolsList !== null ? editedToolsList : (allTools.length > 0 ? allTools : (initialTools || []));
    return { prompt, tools };
  }, [nodes, edges, initialTools, editedToolsList]);

  const handleGenerateConfig = async () => {
    setIsGenerating(true);
    setGenerateError(null);

    // Collect tools from all nodes
    const allTools = [...new Set(nodes.filter((n) => n.type === "step").flatMap((n) => ((n.data as unknown as WorkflowStepData).tools || [])).filter(Boolean))];

    try {
      const result = await generatePromptFromApi({
        workflow: { nodes, edges },
        tools: allTools,
      });
      setGeneratedPrompt(result.systemPrompt);
      setEditedPrompt(result.systemPrompt);
      setPromptDirty(false);
      onGenerate?.(result.systemPrompt, result.tools);
      // Save workflow + generated prompt
      onSave?.({ nodes, edges });
      // Switch to prompt tab to show the result
      setViewMode('preview');
    } catch (err: any) {
      console.error('Failed to generate prompt via API:', err);
      setGenerateError(err.message || 'Failed to generate prompt');
      // Fallback to local generation
      const { prompt, tools } = buildPromptAndTools();
      setGeneratedPrompt(prompt);
      setEditedPrompt(prompt);
      setPromptDirty(false);
      onGenerate?.(prompt, tools);
      // Save workflow + fallback prompt
      onSave?.({ nodes, edges });
      setViewMode('preview');
    } finally {
      setIsGenerating(false);
    }
  };

  // Edges for the detail panel
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter((e) => e.source === selectedNodeId);
  }, [edges, selectedNodeId]);

  // Auto-layout: arrange nodes in a clean vertical tree based on edge connections
  const autoLayout = useCallback(() => {
    const STEP_WIDTH = 200;
    const START_END_WIDTH = 56;
    const HORIZONTAL_GAP = 60;
    const VERTICAL_GAP = 120;

    // Build adjacency from edges
    const children: Record<string, string[]> = {};
    const parents: Record<string, string[]> = {};
    edges.forEach((e) => {
      if (!children[e.source]) children[e.source] = [];
      children[e.source].push(e.target);
      if (!parents[e.target]) parents[e.target] = [];
      parents[e.target].push(e.source);
    });

    // Find root (start node or nodes with no parents)
    const nodeIds = nodes.map((n) => n.id);
    const roots = nodeIds.filter((id) => !parents[id] || parents[id].length === 0);
    const root = roots.includes('start') ? 'start' : roots[0] || 'start';

    // BFS to assign levels
    const levels: Record<string, number> = {};
    const queue: string[] = [root];
    levels[root] = 0;
    const visited = new Set<string>();
    visited.add(root);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const childIds = children[current] || [];
      childIds.forEach((child) => {
        if (!visited.has(child)) {
          visited.add(child);
          levels[child] = (levels[current] || 0) + 1;
          queue.push(child);
        }
      });
    }

    // Assign remaining unvisited nodes to the end
    nodes.forEach((n) => {
      if (!visited.has(n.id)) {
        levels[n.id] = Object.keys(levels).length > 0 ? Math.max(...Object.values(levels)) + 1 : 0;
      }
    });

    // Group nodes by level
    const levelGroups: Record<number, string[]> = {};
    Object.entries(levels).forEach(([id, level]) => {
      if (!levelGroups[level]) levelGroups[level] = [];
      levelGroups[level].push(id);
    });

    // Calculate positions — center each level's nodes horizontally
    const maxLevel = Math.max(...Object.values(levels), 0);
    const newPositions: Record<string, { x: number; y: number }> = {};

    // First pass: calculate the widest level to determine center reference
    let maxLevelWidth = 0;
    for (let level = 0; level <= maxLevel; level++) {
      const group = levelGroups[level] || [];
      const width = group.reduce((sum, id) => {
        const node = nodes.find((n) => n.id === id);
        const w = (node?.type === 'start' || node?.type === 'end') ? START_END_WIDTH : STEP_WIDTH;
        return sum + w;
      }, 0) + (group.length - 1) * HORIZONTAL_GAP;
      if (width > maxLevelWidth) maxLevelWidth = width;
    }

    const centerX = maxLevelWidth / 2 + 50; // Add some left padding

    // Second pass: position each level centered around centerX
    for (let level = 0; level <= maxLevel; level++) {
      const group = levelGroups[level] || [];
      // Calculate total width of this level
      const widths = group.map((id) => {
        const node = nodes.find((n) => n.id === id);
        return (node?.type === 'start' || node?.type === 'end') ? START_END_WIDTH : STEP_WIDTH;
      });
      const totalWidth = widths.reduce((a, b) => a + b, 0) + (group.length - 1) * HORIZONTAL_GAP;
      let x = centerX - totalWidth / 2;

      group.forEach((id, i) => {
        newPositions[id] = { x, y: level * VERTICAL_GAP };
        x += widths[i] + HORIZONTAL_GAP;
      });
    }

    // Apply positions
    setNodes((prev) =>
      prev.map((n) => newPositions[n.id] ? { ...n, position: newPositions[n.id] } : n)
    );
  }, [nodes, edges, setNodes]);

  const canvasContent = (
    <div style={{ display: 'flex', gap: '16px', height: fullscreen ? 'calc(100vh - 80px)' : undefined, flex: fullscreen ? undefined : 1, minHeight: 0 }}>
      {/* Left: Palette */}
      <div style={{ width: '170px', flexShrink: 0, overflowY: 'auto' }}>
        {/* Steps Section */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Steps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
          {PREDEFINED_TEMPLATES.map((t) => (
            <button
              key={t.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/reactflow', JSON.stringify(t));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => addNode(t)}
              style={{ padding: '5px 8px', fontSize: '12px', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px', cursor: 'grab', color: '#334155', fontWeight: 500 }}
            >
              + {t.name}
            </button>
          ))}
          <button
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow', JSON.stringify({ name: 'New Step', instructions: '', tools: [] }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => addNode()}
            style={{ padding: '5px 8px', fontSize: '12px', textAlign: 'left', background: 'white', border: '1px dashed #c7d2fe', borderRadius: '5px', cursor: 'grab', color: '#6366f1', fontWeight: 600 }}
          >
            + Custom Step
          </button>
        </div>

        {/* Tools Section */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Tools</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '14px' }}>
          {availableTools.filter((t) => t.type === 'webhook' || t.type === 'lambda').length > 0 ? (
            availableTools.filter((t) => t.type === 'webhook' || t.type === 'lambda').slice(0, 5).map((tool) => (
              <div key={tool.id} draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/tool-drop', JSON.stringify({ toolId: `int:${tool.id}`, name: tool.name }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                style={{ fontSize: '11px', padding: '4px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'grab' }}
                onClick={() => {
                  if (selectedNodeId) {
                    const current = (nodes.find((n) => n.id === selectedNodeId)?.data as any)?.tools || [];
                    if (!current.includes(`int:${tool.id}`)) {
                      updateNodeData(selectedNodeId, { tools: [...current, `int:${tool.id}`] });
                    }
                  }
                }}
                title={selectedNodeId ? `Click or drag to add to step` : 'Drag onto a step'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name}</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: '10px', color: '#cbd5e1', margin: 0 }}>No tools configured</p>
          )}
        </div>

        {/* MCP / Gateways Section */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>MCP Gateways</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '14px' }}>
          {availableTools.filter((t) => t.type === 'mcp').length > 0 ? (
            availableTools.filter((t) => t.type === 'mcp').map((tool) => (
              <div key={tool.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/tool-drop', JSON.stringify({ toolId: `int:${tool.id}`, name: tool.name }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  style={{ fontSize: '11px', padding: '4px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'grab' }}
                  onClick={() => {
                    if (selectedNodeId) {
                      const current = (nodes.find((n) => n.id === selectedNodeId)?.data as any)?.tools || [];
                      if (!current.includes(`int:${tool.id}`)) {
                        updateNodeData(selectedNodeId, { tools: [...current, `int:${tool.id}`] });
                      }
                    }
                  }}
                  title={selectedNodeId ? `Click or drag to add to step` : 'Drag onto a step'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{tool.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const gwId = tool.gatewayId;
                      if (!gwId) return;
                      if (expandedGateway === gwId) {
                        setExpandedGateway(null);
                      } else {
                        setExpandedGateway(gwId);
                        if (!gatewayToolsCache[gwId]) {
                          getGatewayDetail(gwId).then((detail) => {
                            setGatewayToolsCache((prev) => ({ ...prev, [gwId]: detail.mcpTools || [] }));
                          }).catch(() => {
                            setGatewayToolsCache((prev) => ({ ...prev, [gwId]: [] }));
                          });
                        }
                      }
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '10px', color: '#6366f1', flexShrink: 0 }}
                    title="Show MCP tools"
                  >
                    {expandedGateway === tool.gatewayId ? '▾' : '▸'}
                  </button>
                </div>
                {/* Expanded MCP tools list */}
                {expandedGateway === tool.gatewayId && tool.gatewayId && (
                  <div style={{ marginLeft: '16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {gatewayToolsCache[tool.gatewayId] === undefined ? (
                      <span style={{ fontSize: '10px', color: '#94a3b8', padding: '2px 0' }}>Loading...</span>
                    ) : gatewayToolsCache[tool.gatewayId]!.length === 0 ? (
                      <span style={{ fontSize: '10px', color: '#94a3b8', padding: '2px 0' }}>No tools discovered</span>
                    ) : (
                      gatewayToolsCache[tool.gatewayId]!.map((mcpTool) => (
                        <div
                          key={mcpTool.name}
                          style={{ fontSize: '10px', padding: '3px 6px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '3px', color: '#4338ca', display: 'flex', alignItems: 'flex-start', gap: '4px' }}
                          title={mcpTool.description || mcpTool.name}
                        >
                          <span style={{ color: '#6366f1', flexShrink: 0 }}>⚡</span>
                          <span style={{ lineHeight: 1.3 }}>
                            <span style={{ fontWeight: 500 }}>{mcpTool.name}</span>
                            {mcpTool.description && (
                              <span style={{ display: 'block', fontSize: '9px', color: '#64748b', marginTop: '1px' }}>{mcpTool.description.slice(0, 60)}{mcpTool.description.length > 60 ? '…' : ''}</span>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p style={{ fontSize: '10px', color: '#cbd5e1', margin: 0 }}>No gateways</p>
          )}
        </div>

        {/* Sub-agents Section */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Sub Agents</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '14px' }}>
          {availableTools.filter((t) => t.type === 'subagent').length > 0 ? (
            availableTools.filter((t) => t.type === 'subagent').map((tool) => (
              <div key={tool.id} draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/tool-drop', JSON.stringify({ toolId: `int:${tool.id}`, name: tool.name }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                style={{ fontSize: '11px', padding: '4px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'grab' }}
                onClick={() => {
                  if (selectedNodeId) {
                    const current = (nodes.find((n) => n.id === selectedNodeId)?.data as any)?.tools || [];
                    if (!current.includes(`int:${tool.id}`)) {
                      updateNodeData(selectedNodeId, { tools: [...current, `int:${tool.id}`] });
                    }
                  }
                }}
                title={selectedNodeId ? `Click or drag to add to step` : 'Drag onto a step'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name}</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: '10px', color: '#cbd5e1', margin: 0 }}>No sub-agents</p>
          )}
        </div>

        <div style={{ fontSize: '10px', color: '#cbd5e1', lineHeight: 1.4 }}>
          <p>Click a tool/skill to add to the selected step.</p>
        </div>
      </div>

      {/* Center: React Flow Canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', position: 'relative', background: '#f8fafc' }} onDrop={onDrop} onDragOver={onDragOver}>
        <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10 }}>
          <button
            onClick={autoLayout}
            style={{ padding: '5px 10px', fontSize: '13px', fontWeight: 500, background: 'white', border: '1px solid #e2e8f0', borderRadius: '5px', cursor: 'pointer', color: '#475569' }}
          >
            ⊞ Auto Layout
          </button>
        </div>
        <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', gap: '6px' }}>
          <button
            onClick={handleGenerateConfig}
            disabled={isGenerating}
            style={{ padding: '5px 12px', fontSize: '13px', fontWeight: 600, background: isGenerating ? '#a5b4fc' : '#6366f1', color: 'white', border: 'none', borderRadius: '5px', cursor: isGenerating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            {isGenerating ? '⏳ Generating...' : '✨ Generate Prompt & Save'}
          </button>
          {!fullscreen && (
            <button
              onClick={() => setFullscreen(true)}
              style={{ padding: '5px 10px', fontSize: '13px', fontWeight: 500, background: 'white', border: '1px solid #e2e8f0', borderRadius: '5px', cursor: 'pointer', color: '#475569' }}
            >
              ⛶ Expand
            </button>
          )}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          defaultViewport={{ x: 50, y: 20, zoom: 1 }}
          connectionLineStyle={{ stroke: '#a5b4fc', strokeWidth: 2 }}
        >
          <Background color="#f1f5f9" gap={8} variant={'lines' as any} />
          <Controls position="bottom-left" />
        </ReactFlow>
      </div>

      {/* Right: Detail Panel */}
      <div style={{ width: '260px', flexShrink: 0, overflowY: 'auto' }}>
        {selectedNode ? (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Step Details</span>
              <button onClick={() => deleteNode(selectedNode.id)} style={{ fontSize: '13px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '3px' }}>Name</label>
                <input
                  value={(selectedNode.data as any).name || ''}
                  onChange={(e) => updateNodeData(selectedNode.id, { name: e.target.value })}
                  style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              {selectedNode.type === 'tool' && (
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  <span style={{ fontWeight: 500 }}>Type:</span> {(selectedNode.data as any).toolType || 'unknown'}
                  <p style={{ marginTop: '4px', color: '#94a3b8' }}>Connect from a step's right handle to this tool's left handle.</p>
                </div>
              )}
              {selectedNode.type === 'step' && (
                <>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '3px' }}>Instructions</label>
                <textarea
                  value={(selectedNode.data as unknown as WorkflowStepData).instructions}
                  onChange={(e) => updateNodeData(selectedNode.id, { instructions: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', resize: 'vertical' }}
                  placeholder="What should the agent do?"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '3px' }}>Tools</label>
                {/* Selected tools */}
                {((selectedNode.data as unknown as WorkflowStepData).tools || []).length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                      {(selectedNode.data as unknown as WorkflowStepData).tools.map((toolRef) => {
                        const tool = availableTools.find((t) => `int:${t.id}` === toolRef || t.id === toolRef || t.name === toolRef);
                        const displayName = tool?.name || toolRef.replace('int:', '');
                        return (
                          <span key={toolRef} onClick={() => setToolDetailId(tool?.id || toolRef)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '2px 6px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '4px', color: '#4338ca', cursor: 'pointer' }}>
                            {displayName}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const tools = (selectedNode.data as unknown as WorkflowStepData).tools.filter((t) => t !== toolRef);
                                updateNodeData(selectedNode.id, { tools });
                              }}
                              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 }}
                            >×</button>
                          </span>
                        );
                      })}
                    </div>
                    {/* Show parameters for non-MCP tools */}
                    {(selectedNode.data as unknown as WorkflowStepData).tools.map((toolRef) => {
                      const tool = availableTools.find((t) => `int:${t.id}` === toolRef || t.id === toolRef || t.name === toolRef);
                      if (!tool || tool.type === 'mcp' || !tool.parameters) return null;
                      return (
                        <div key={`params-${toolRef}`} style={{ marginBottom: '6px', padding: '6px 8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, marginBottom: '2px' }}>{tool.name} — Parameters</div>
                          <pre style={{ fontSize: '10px', color: '#475569', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.3, maxHeight: '60px', overflow: 'auto', fontFamily: 'monospace' }}>{tool.parameters}</pre>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Search input */}
                {availableTools.length > 0 ? (
                  <div style={{ position: 'relative' }}>
                    <input
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                      placeholder="Search tools..."
                      style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px' }}
                    />
                    {toolSearch && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', marginTop: '2px', maxHeight: '140px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                        {availableTools
                          .filter((t) => {
                            const q = toolSearch.toLowerCase();
                            return t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q);
                          })
                          .map((tool) => {
                            const selectedTools = (selectedNode.data as unknown as WorkflowStepData).tools || [];
                            const toolRef = `int:${tool.id}`;
                            const isSelected = selectedTools.includes(toolRef) || selectedTools.includes(tool.id);
                            return (
                              <button
                                key={tool.id}
                                onClick={() => {
                                  if (!isSelected) {
                                    updateNodeData(selectedNode.id, { tools: [...selectedTools, toolRef] });
                                  }
                                  setToolSearch('');
                                }}
                                disabled={isSelected}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: isSelected ? '#f1f5f9' : 'white', cursor: isSelected ? 'default' : 'pointer', fontSize: '11px', borderBottom: '1px solid #f1f5f9' }}
                              >
                                <span style={{ fontWeight: 500, color: isSelected ? '#94a3b8' : '#334155' }}>{tool.name}</span>
                                <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '10px' }}>{tool.type === 'webhook' ? 'API' : tool.type}</span>
                                {tool.description && <span style={{ display: 'block', fontSize: '10px', color: '#64748b', marginTop: '1px' }}>{tool.description}</span>}
                              </button>
                            );
                          })}
                        {availableTools.filter((t) => {
                          const q = toolSearch.toLowerCase();
                          return t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q);
                        }).length === 0 && (
                          <p style={{ padding: '8px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>No matching tools</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>No tools configured. Add tools in Configure → Tools.</p>
                )}
              </div>
              </>)}
              {/* Outgoing edge labels */}
              {selectedNodeEdges.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '3px' }}>Connection Labels</label>
                  {selectedNodeEdges.map((edge) => {
                    const targetNode = nodes.find((n) => n.id === edge.target);
                    const targetName = targetNode ? (targetNode.data as unknown as WorkflowStepData).name : edge.target;
                    return (
                      <div key={edge.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '14px', color: '#6366f1' }}>→ {targetName}</span>
                        <input
                          value={(edge.label as string) || ''}
                          onChange={(e) => updateEdgeLabel(edge.id, e.target.value)}
                          style={{ flex: 1, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '14px' }}
                          placeholder="condition (optional)"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            Click a step to edit. Drag from handles to connect.
          </div>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    const { prompt: fsPrompt, tools: fsTools } = buildPromptAndTools();
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'white', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Conversation Flow Editor</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setFullscreen(false)} style={{ padding: '6px 14px', fontSize: '14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', color: '#475569' }}>✕ Close</button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: '12px' }}>
          {([['preview', 'Prompt'], ['canvas', 'Canvas']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              style={{
                padding: '8px 16px', background: 'none', border: 'none',
                borderBottom: viewMode === key ? '2px solid #6366f1' : '2px solid transparent',
                fontSize: '13px', fontWeight: viewMode === key ? 600 : 500,
                color: viewMode === key ? '#6366f1' : '#64748b', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {viewMode === 'canvas' && canvasContent}
        {viewMode === 'preview' && (
          <div style={{ display: 'flex', gap: '16px', height: 'calc(100vh - 140px)' }}>
            {/* Left: System Prompt (60%) */}
            <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>System Prompt</h3>
                {promptDirty && onSave && (
                  <button
                    onClick={() => {
                      onSave({ nodes, edges, editedPrompt: editedPrompt ?? generatedPrompt ?? fsPrompt, editedTools: fsTools });
                      setPromptDirty(false);
                    }}
                    style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Save
                  </button>
                )}
              </div>

              {generateError && (
                <div style={{ marginBottom: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '6px 10px' }}>
                  <span style={{ fontSize: '12px', color: '#dc2626' }}>⚠ {generateError} — showing local fallback</span>
                </div>
              )}
              <textarea
                value={editedPrompt ?? generatedPrompt ?? fsPrompt}
                onChange={(e) => { setEditedPrompt(e.target.value); setPromptDirty(true); }}
                style={{ flex: 1, width: '100%', fontSize: '13px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'white', padding: '16px', borderRadius: '6px', border: '1px solid #e2e8f0', fontFamily: 'inherit', resize: 'none' }}
              />
            </div>
            {/* Right: Tools (40%) */}
            <div style={{ flex: '0 0 40%', overflow: 'auto', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Tools ({fsTools.length})</h3>
              {fsTools.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {fsTools.map((toolId) => {
                    const tool = availableTools.find((at) => `int:${at.id}` === toolId || at.id === toolId);
                    const displayName = tool ? tool.name : toolId.replace('int:', '');
                    const typeLabel = tool ? (tool.type === 'webhook' ? 'API (Webhook)' : tool.type === 'lambda' ? 'Lambda' : tool.type === 'mcp' ? 'MCP Gateway' : tool.type === 'subagent' ? 'Sub Agent' : tool.type) : 'unknown';
                    const isMcp = tool?.type === 'mcp';
                    return (
                      <div key={toolId} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: isMcp ? '0' : '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{displayName}</span>
                          <span style={{ fontSize: '10px', padding: '2px 6px', background: '#eef2ff', color: '#6366f1', borderRadius: '3px', fontWeight: 500 }}>{typeLabel}</span>
                        </div>
                        {!isMcp && (
                          <>
                            {tool?.endpoint && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{tool.method || 'POST'} {tool.endpoint}</div>
                            )}
                            {tool?.functionArn && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{tool.functionArn}</div>
                            )}
                            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '3px', marginTop: '6px' }}>Description (for tool selection)</label>
                            <textarea
                              value={toolInstructions[toolId] ?? tool?.description ?? ''}
                              onChange={(e) => { setToolInstructions((prev) => ({ ...prev, [toolId]: e.target.value })); setToolsDirty(true); }}
                              rows={2}
                              style={{ width: '100%', fontSize: '12px', color: '#475569', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }}
                              placeholder="When should the agent use this tool?"
                            />
                            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '3px', marginTop: '8px' }}>Parameters (JSON schema)</label>
                            <textarea
                              value={toolParameters[toolId] ?? ''}
                              onChange={(e) => setToolParameters((prev) => ({ ...prev, [toolId]: e.target.value }))}
                              rows={3}
                              style={{ width: '100%', fontSize: '11px', color: '#475569', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.4 }}
                              placeholder='{"account_id": {"type": "string", "description": "The user account ID"}}'
                            />
                          </>
                        )}
                        {isMcp && tool?.gatewayId && (
                          <div style={{ marginTop: '6px' }}>
                            <button
                              onClick={() => {
                                const gwId = tool.gatewayId!;
                                if (expandedGateway === gwId) {
                                  setExpandedGateway(null);
                                } else {
                                  setExpandedGateway(gwId);
                                  if (!gatewayToolsCache[gwId]) {
                                    getGatewayDetail(gwId).then((detail) => {
                                      setGatewayToolsCache((prev) => ({ ...prev, [gwId]: detail.mcpTools || [] }));
                                    }).catch(() => {
                                      setGatewayToolsCache((prev) => ({ ...prev, [gwId]: [] }));
                                    });
                                  }
                                }
                              }}
                              style={{ fontSize: '11px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
                            >
                              {expandedGateway === tool.gatewayId ? '▾' : '▸'} Gateway Tools ({gatewayToolsCache[tool.gatewayId]?.length ?? '…'})
                            </button>
                            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{tool.gatewayId}</div>
                            {expandedGateway === tool.gatewayId && (
                              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px', borderLeft: '2px solid #c7d2fe' }}>
                                {gatewayToolsCache[tool.gatewayId] === undefined ? (
                                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Loading...</span>
                                ) : gatewayToolsCache[tool.gatewayId]!.length === 0 ? (
                                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>No tools discovered</span>
                                ) : (
                                  gatewayToolsCache[tool.gatewayId]!.map((mcpTool) => (
                                    <div key={mcpTool.name} style={{ padding: '5px 8px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '5px' }}>
                                      <div style={{ fontSize: '11px', fontWeight: 500, color: '#4338ca' }}>⚡ {mcpTool.name}</div>
                                      {mcpTool.description && <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{mcpTool.description}</div>}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>No tools configured in the flow.</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const { prompt: previewPrompt, tools: previewTools } = buildPromptAndTools();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      {/* View mode tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: '12px' }}>
        {([['preview', 'Prompt'], ['canvas', 'Canvas']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              borderBottom: viewMode === key ? '2px solid #6366f1' : '2px solid transparent',
              fontSize: '13px', fontWeight: viewMode === key ? 600 : 500,
              color: viewMode === key ? '#6366f1' : '#64748b', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {viewMode === 'canvas' && canvasContent}
      {viewMode === 'preview' && (
        <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
          {/* Left: System Prompt (60%) */}
          <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>System Prompt</h3>
              {promptDirty && onSave && (
                <button
                  onClick={() => {
                    onSave({ nodes, edges, editedPrompt: editedPrompt ?? generatedPrompt ?? previewPrompt, editedTools: previewTools });
                    setPromptDirty(false);
                  }}
                  style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Save
                </button>
              )}
            </div>
            {generateError && (
              <div style={{ marginBottom: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '6px 10px' }}>
                <span style={{ fontSize: '12px', color: '#dc2626' }}>⚠ {generateError} — showing local fallback</span>
              </div>
            )}
            <textarea
              value={editedPrompt ?? generatedPrompt ?? previewPrompt}
              onChange={(e) => { setEditedPrompt(e.target.value); setPromptDirty(true); }}
              style={{ flex: 1, width: '100%', fontSize: '13px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'white', padding: '16px', borderRadius: '6px', border: '1px solid #e2e8f0', fontFamily: 'inherit', resize: 'none' }}
            />
            {/* Inference Config */}
            {dispatch && (
            <details style={{ marginTop: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 12px', flexShrink: 0 }}>
              <summary style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Inference Config</summary>
              <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '3px' }}>Temperature</label>
                  <input type="number" min="0" max="1" step="0.1" value={(state as any).inferenceConfig?.temperature ?? 0.7} onChange={(e) => dispatch({ type: 'SET_INFERENCE_CONFIG', payload: { temperature: parseFloat(e.target.value) } })} style={{ width: '100%', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '3px' }}>Top P</label>
                  <input type="number" min="0" max="1" step="0.05" value={(state as any).inferenceConfig?.topP ?? 0.9} onChange={(e) => dispatch({ type: 'SET_INFERENCE_CONFIG', payload: { topP: parseFloat(e.target.value) } })} style={{ width: '100%', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '3px' }}>Max Tokens</label>
                  <input type="number" min="64" max="4096" step="64" value={(state as any).inferenceConfig?.maxTokens ?? 512} onChange={(e) => dispatch({ type: 'SET_INFERENCE_CONFIG', payload: { maxTokens: parseInt(e.target.value) } })} style={{ width: '100%', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px' }} />
                </div>
              </div>
            </details>
            )}
          </div>
          {/* Right: Tools (40%) */}
          <div style={{ flex: '0 0 40%', overflow: 'auto', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Tools</h3>
            {/* Selected tools */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
              {previewTools.map((toolId) => {
                // Handle RAG knowledge base references
                if (toolId.startsWith('rag:')) {
                  const ragId = toolId.replace('rag:', '');
                  const kb = ragSources.find((r) => r.id === ragId);
                  const displayName = kb ? kb.name : ragId;
                  return (
                    <div key={toolId} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155', flex: 1 }}>{displayName}</span>
                        <span style={{ fontSize: '10px', padding: '2px 6px', background: '#ecfdf5', color: '#10b981', borderRadius: '3px', fontWeight: 500 }}>RAG</span>
                        <button
                          onClick={() => {
                            nodes.filter((n) => n.type === 'step').forEach((node) => {
                              const current = (node.data as unknown as WorkflowStepData).tools || [];
                              if (current.includes(toolId)) {
                                updateNodeData(node.id, { tools: current.filter((t) => t !== toolId) });
                              }
                            });
                            setEditedToolsList((prev) => {
                              const currentTools = prev !== null ? prev : previewTools;
                              return currentTools.filter((t) => t !== toolId);
                            });
                            setPromptDirty(true);
                          }}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '2px' }}
                          title="Remove"
                        >×</button>
                      </div>
                      {kb?.description && (
                        <div style={{ fontSize: '11px', color: '#64748b', paddingLeft: '10px' }}>{kb.description}</div>
                      )}
                    </div>
                  );
                }
                const tool = availableTools.find((at) => `int:${at.id}` === toolId || at.id === toolId);
                const displayName = tool ? tool.name : toolId.replace('int:', '');
                const typeLabel = tool ? (tool.type === 'webhook' ? 'API' : tool.type === 'lambda' ? 'Lambda' : tool.type === 'mcp' ? 'MCP' : tool.type === 'subagent' ? 'Agent' : tool.type) : '';
                const isMcpTool = tool?.type === 'mcp' && tool?.gatewayId;
                return (
                  <div key={toolId} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155', flex: 1 }}>{displayName}</span>
                      <span style={{ fontSize: '10px', padding: '2px 6px', background: '#eef2ff', color: '#6366f1', borderRadius: '3px', fontWeight: 500 }}>{typeLabel}</span>
                      {isMcpTool && (
                        <button
                          onClick={() => {
                            const gwId = tool!.gatewayId!;
                            if (expandedGateway === gwId) {
                              setExpandedGateway(null);
                            } else {
                              setExpandedGateway(gwId);
                              if (!gatewayToolsCache[gwId]) {
                                getGatewayDetail(gwId).then((detail) => {
                                  setGatewayToolsCache((prev) => ({ ...prev, [gwId]: detail.mcpTools || [] }));
                                }).catch(() => {
                                  setGatewayToolsCache((prev) => ({ ...prev, [gwId]: [] }));
                                });
                              }
                            }
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#6366f1', padding: '2px 4px' }}
                          title="Show gateway tools"
                        >
                          {expandedGateway === tool!.gatewayId ? '▾ tools' : '▸ tools'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          // Remove from workflow nodes (if tool is in a node)
                          nodes.filter((n) => n.type === 'step').forEach((node) => {
                            const current = (node.data as unknown as WorkflowStepData).tools || [];
                            if (current.includes(toolId)) {
                              updateNodeData(node.id, { tools: current.filter((t) => t !== toolId) });
                            }
                          });
                          // Also update the edited tools list directly
                          setEditedToolsList((prev) => {
                            const currentTools = prev !== null ? prev : previewTools;
                            return currentTools.filter((t) => t !== toolId);
                          });
                          setPromptDirty(true);
                        }}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '2px' }}
                        title="Remove"
                      >×</button>
                    </div>
                    {/* Expanded MCP tools for this gateway */}
                    {isMcpTool && expandedGateway === tool!.gatewayId && (
                      <div style={{ marginLeft: '12px', display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '8px', borderLeft: '2px solid #c7d2fe' }}>
                        {gatewayToolsCache[tool!.gatewayId!] === undefined ? (
                          <span style={{ fontSize: '11px', color: '#94a3b8', padding: '4px 0' }}>Loading tools...</span>
                        ) : gatewayToolsCache[tool!.gatewayId!]!.length === 0 ? (
                          <span style={{ fontSize: '11px', color: '#94a3b8', padding: '4px 0' }}>No tools discovered</span>
                        ) : (
                          gatewayToolsCache[tool!.gatewayId!]!.map((mcpTool) => (
                            <div
                              key={mcpTool.name}
                              style={{ padding: '5px 8px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '5px', fontSize: '11px' }}
                            >
                              <div style={{ fontWeight: 500, color: '#4338ca' }}>⚡ {mcpTool.name}</div>
                              {mcpTool.description && (
                                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{mcpTool.description}</div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {previewTools.length === 0 && (
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>No tools selected. Use the search below to add.</p>
              )}
            </div>
            {/* Search to add */}
            <div style={{ position: 'relative' }}>
              <input
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Search tools, MCP, RAG, sub-agents..."
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', background: 'white' }}
              />
              {toolSearch && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                  {availableTools
                    .filter((t) => {
                      const q = toolSearch.toLowerCase();
                      const toolRef = `int:${t.id}`;
                      const alreadyAdded = previewTools.includes(toolRef) || previewTools.includes(t.id);
                      return !alreadyAdded && (t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q));
                    })
                    .map((tool) => {
                      const typeLabel = tool.type === 'webhook' ? 'API' : tool.type === 'lambda' ? 'Lambda' : tool.type === 'mcp' ? 'MCP' : tool.type === 'subagent' ? 'Agent' : tool.type;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => {
                            const toolRef = `int:${tool.id}`;
                            // Add to workflow nodes if they exist
                            const stepNodes = nodes.filter((n) => n.type === 'step');
                            if (stepNodes.length > 0) {
                              const current = (stepNodes[0].data as unknown as WorkflowStepData).tools || [];
                              if (!current.includes(toolRef)) {
                                updateNodeData(stepNodes[0].id, { tools: [...current, toolRef] });
                              }
                            }
                            // Also update the edited tools list directly
                            setEditedToolsList((prev) => {
                              const currentTools = prev !== null ? prev : previewTools;
                              if (!currentTools.includes(toolRef)) return [...currentTools, toolRef];
                              return currentTools;
                            });
                            setPromptDirty(true);
                            setToolSearch('');
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'white', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                        >
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155', flex: 1 }}>{tool.name}</span>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>{typeLabel}</span>
                        </button>
                      );
                    })}
                  {/* RAG Knowledge Bases */}
                  {ragSources
                    .filter((kb) => {
                      const q = toolSearch.toLowerCase();
                      const ragRef = `rag:${kb.id}`;
                      const alreadyAdded = previewTools.includes(ragRef);
                      return !alreadyAdded && (kb.name.toLowerCase().includes(q) || 'rag'.includes(q) || 'knowledge'.includes(q) || (kb.description || '').toLowerCase().includes(q));
                    })
                    .map((kb) => (
                      <button
                        key={`rag-${kb.id}`}
                        onClick={() => {
                          const ragRef = `rag:${kb.id}`;
                          const stepNodes = nodes.filter((n) => n.type === 'step');
                          if (stepNodes.length > 0) {
                            const current = (stepNodes[0].data as unknown as WorkflowStepData).tools || [];
                            if (!current.includes(ragRef)) {
                              updateNodeData(stepNodes[0].id, { tools: [...current, ragRef] });
                            }
                          }
                          setEditedToolsList((prev) => {
                            const currentTools = prev !== null ? prev : previewTools;
                            if (!currentTools.includes(ragRef)) return [...currentTools, ragRef];
                            return currentTools;
                          });
                          setPromptDirty(true);
                          setToolSearch('');
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'white', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155', flex: 1 }}>{kb.name}</span>
                        <span style={{ fontSize: '10px', color: '#10b981' }}>RAG</span>
                      </button>
                    ))}
                  {availableTools.filter((t) => {
                    const q = toolSearch.toLowerCase();
                    const toolRef = `int:${t.id}`;
                    const alreadyAdded = previewTools.includes(toolRef) || previewTools.includes(t.id);
                    return !alreadyAdded && (t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q));
                  }).length === 0 && ragSources.filter((kb) => {
                    const q = toolSearch.toLowerCase();
                    const ragRef = `rag:${kb.id}`;
                    const alreadyAdded = previewTools.includes(ragRef);
                    return !alreadyAdded && (kb.name.toLowerCase().includes(q) || 'rag'.includes(q) || 'knowledge'.includes(q) || (kb.description || '').toLowerCase().includes(q));
                  }).length === 0 && (
                    <p style={{ padding: '10px', fontSize: '12px', color: '#94a3b8', textAlign: 'center', margin: 0 }}>No matching tools</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tool detail popup */}
      {toolDetailId && (() => {
        const tool = availableTools.find((t) => t.id === toolDetailId || `int:${t.id}` === toolDetailId);
        if (!tool) { setToolDetailId(null); return null; }
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setToolDetailId(null)}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{tool.name}</h3>
                <button onClick={() => setToolDetailId(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Type</span>
                  <p style={{ fontSize: '14px', color: '#334155', marginTop: '2px' }}>{tool.type === 'webhook' ? 'API (Webhook)' : tool.type === 'lambda' ? 'Lambda Function' : 'MCP Gateway'}</p>
                </div>
                {tool.description && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Description</span>
                    <p style={{ fontSize: '14px', color: '#334155', marginTop: '2px' }}>{tool.description}</p>
                  </div>
                )}
                {tool.endpoint && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Endpoint</span>
                    <p style={{ fontSize: '13px', color: '#475569', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{tool.method || 'POST'} {tool.endpoint}</p>
                  </div>
                )}
                {tool.functionArn && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Lambda ARN</span>
                    <p style={{ fontSize: '12px', color: '#475569', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{tool.functionArn}</p>
                  </div>
                )}
                {tool.gatewayId && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Gateway ID</span>
                    <p style={{ fontSize: '13px', color: '#475569', marginTop: '2px', fontFamily: 'monospace' }}>{tool.gatewayId}</p>
                  </div>
                )}
                {tool.timeout && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Timeout</span>
                    <p style={{ fontSize: '14px', color: '#334155', marginTop: '2px' }}>{tool.timeout}s</p>
                  </div>
                )}
                {tool.mockResponse && (
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Mock Response</span>
                    <pre style={{ fontSize: '12px', color: '#475569', marginTop: '2px', background: '#f8fafc', padding: '8px', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{tool.mockResponse}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default WorkflowCanvas;
