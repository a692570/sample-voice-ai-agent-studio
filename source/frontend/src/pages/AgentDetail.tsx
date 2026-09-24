import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { getDemo } from '../services/demosApi';
import { useWizard } from '../context/WizardContext';
import type { HostType, FrameworkType, PipelineType } from '../context/WizardContext';
import type { Demo } from '../services/demosApi';
import WorkflowCanvas from '../components/WorkflowCanvas';
import type { WorkflowData } from '../components/workflowUtils';
import { generatePromptFromWorkflow } from '../components/workflowUtils';
import { generatePromptFromApi } from '../services/generatePrompt';
import { updateDemo, createDemo } from '../services/demosApi';
import { listTools } from '../services/toolsApi';
import type { SavedTool } from '../services/toolsApi';
import { notifyAgentListChanged } from '../events/agentEvents';
import EvaluationTab from '../components/EvaluationTab';
import CallHistoryTab from '../components/CallHistoryTab';

type Tab = 'dashboard' | 'summary' | 'prompt' | 'voice' | 'tools' | 'evaluation' | 'workflow' | 'cost' | 'history' | 'users';

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { dispatch } = useWizard();

  // Extract jobId from URL if on evaluation detail route
  const jobIdMatch = location.pathname.match(/\/evaluation\/([^/]+)$/);
  const initialJobId = jobIdMatch ? jobIdMatch[1] : undefined;
  const [demo, setDemo] = useState<Demo | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableTools, setAvailableTools] = useState<SavedTool[]>([]);
  const [chartMetric, setChartMetric] = useState<'conversations' | 'duration' | 'totalCost' | 'avgCost'>('conversations');
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const lastGeneratedPromptRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dirty, setDirty] = useState(false);

  // Derive active tab from URL path
  const pathSuffix = location.pathname.split(`/agents/${id}`)[1] || '';
  const activeTab: Tab = pathSuffix === '/summary' ? 'summary'
    : pathSuffix === '/prompt' ? 'prompt'
    : pathSuffix === '/voice' ? 'voice'
    : pathSuffix === '/tools' ? 'tools'
    : pathSuffix === '/conversations' ? 'history'
    : pathSuffix === '/users' ? 'users'
    : pathSuffix === '/workflow' ? 'workflow'
    : pathSuffix === '/cost' ? 'cost'
    : pathSuffix.startsWith('/evaluation') ? 'evaluation'
    : 'dashboard';

  // Dummy chart data
  const chartData = {
    conversations: [12, 18, 24, 15, 32, 28, 22, 35, 19, 27, 31, 25],
    duration: [2.4, 3.1, 2.8, 3.5, 2.9, 3.2, 2.6, 3.8, 2.7, 3.0, 3.3, 2.5],
    totalCost: [1.2, 1.8, 2.4, 1.5, 3.2, 2.8, 2.2, 3.5, 1.9, 2.7, 3.1, 2.5],
    avgCost: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10],
  };
  const chartLabels = ['Jul 25', 'Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26'];
  const chartUnits = { conversations: '', duration: ' min', totalCost: '$', avgCost: '$' };
  const maxVal = Math.max(...chartData[chartMetric]);

  useEffect(() => {
    if (!id || id === '_') {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDemo(id).then(setDemo).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    listTools().then(setAvailableTools).catch(() => {});
  }, []);

  const handleEdit = () => {
    if (!demo) return;
    const config = demo.config;
    dispatch({ type: 'SET_HOST', payload: (config.host || 'agentcore') as HostType });
    dispatch({ type: 'SET_FRAMEWORK', payload: (config.framework || 'strands-bidiagent') as FrameworkType });
    dispatch({ type: 'SET_MODEL', payload: config.model || ['nova-2-sonic'] });
    dispatch({ type: 'SET_PIPELINE', payload: (config.pipeline || 'speech-to-speech') as PipelineType });
    dispatch({ type: 'SET_VOICE', payload: config.voice || { voiceId: '', language: 'en-US', gender: 'female' } });
    dispatch({ type: 'SET_AGENTS', payload: { selectedAgents: config.tools || [], customTools: config.customTools || [] } });
    dispatch({
      type: 'SET_PROMPT',
      payload: config.prompt || { greeting: config.greeting || '', instructions: config.systemPrompt || '' },
    });
    dispatch({ type: 'SET_TELEPHONY_ENABLED', payload: config.telephonyEnabled ?? false });
    dispatch({ type: 'SET_AGENT_START_FIRST', payload: config.agentStartFirst ?? true });
    dispatch({ type: 'SET_PHONE', payload: config.telephony?.phoneNumber || '' });
    dispatch({ type: 'SET_USE_MOCK', payload: config.useMock ?? true });
    dispatch({ type: 'SET_EDITING_DEMO', payload: { id: demo.id, name: demo.name } });
    navigate('/voice-1s');
  };

  if (loading) return <div style={{ padding: '32px', color: '#94a3b8' }}>Loading...</div>;
  if (!demo && id === '_' && activeTab === 'evaluation' && initialJobId) {
    return (
      <div style={{ width: '100%' }}>
        <EvaluationTab agentId="_" agentName="" systemPrompt="" initialJobId={initialJobId} />
      </div>
    );
  }
  if (!demo) return <div style={{ padding: '32px', color: '#dc2626' }}>Agent not found.</div>;

  const config = demo.config;
  const systemPrompt = config.systemPrompt || config.prompt?.instructions || '';

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{demo.name}</h1>
          <p style={{ fontSize: '15px', color: '#94a3b8', marginTop: '2px' }}>
            Created {new Date(demo.createdAt).toLocaleDateString()} · {config.pipeline || 'speech-to-speech'} · {config.model?.[0] || 'nova-2-sonic'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {activeTab !== 'summary' && activeTab !== 'dashboard' && (
            <>
              {saveStatus === 'saved' && <span style={{ fontSize: '13px', color: '#10b981', fontWeight: 500 }}>✓ Saved</span>}
              <button
                disabled={!dirty || saveStatus === 'saving'}
                onClick={async () => {
                  if (!dirty || !id) return;
                  setSaveStatus('saving');
                  try {
                    if (activeTab === 'prompt' && (window as any).__promptEditorSave) {
                      await (window as any).__promptEditorSave();
                    } else if (activeTab === 'workflow' && workflowData) {
                      const allTools = workflowData.editedTools !== undefined
                        ? workflowData.editedTools
                        : [...new Set(workflowData.nodes.filter((n: any) => n.type === 'step').flatMap((n: any) => (n.data?.tools || []).filter(Boolean)))];
                      const prompt = workflowData.editedPrompt || lastGeneratedPromptRef.current || generatePromptFromWorkflow(workflowData).prompt;
                      const configToSave = { ...config, workflow: JSON.stringify(workflowData), systemPrompt: prompt, prompt: { greeting: config.prompt?.greeting || '', instructions: prompt }, tools: allTools };
                      const updated = await updateDemo(id, { config: configToSave });
                      setDemo(updated);
                      setDirty(false);
                      setSaveStatus('saved');
                      setTimeout(() => setSaveStatus('idle'), 2000);
                    }
                  } catch (e) {
                    setSaveStatus('idle');
                    alert(e instanceof Error ? e.message : 'Failed to save');
                  }
                }}
                style={{
                  padding: '8px 18px',
                  background: dirty ? '#6366f1' : '#e2e8f0',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: dirty ? 'white' : '#94a3b8',
                  cursor: dirty ? 'pointer' : 'not-allowed',
                  opacity: saveStatus === 'saving' ? 0.7 : 1,
                }}
              >
                {saveStatus === 'saving' ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
          {activeTab === 'summary' && (
            <>
              <button onClick={() => { handleEdit(); navigate('/poc', { state: { fromSavedAgent: true, agentName: demo.name } }); }} style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Try It
              </button>
              <button
                onClick={() => { handleEdit(); navigate('/voice-1s'); }}
                style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
              <button
                onClick={async () => {
                  try {
                    const copy = await createDemo({ name: `${demo.name} (copy)`, config: demo.config });
                    notifyAgentListChanged();
                    navigate(`/agents/${copy.id}/summary`);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Failed to duplicate');
                  }
                }}
                style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Duplicate
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'dashboard' && (
        <div>
          {/* Chart with metric tabs */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
            {/* Metric tabs on top */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
              {([
                { id: 'conversations', label: 'Conversations' },
                { id: 'duration', label: 'Avg Duration' },
                { id: 'totalCost', label: 'Total Cost' },
                { id: 'avgCost', label: 'Avg Cost' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setChartMetric(m.id)}
                  style={{
                    padding: '6px 14px', background: chartMetric === m.id ? '#eef2ff' : 'none', border: 'none',
                    borderBottom: chartMetric === m.id ? '2px solid #6366f1' : '2px solid transparent',
                    fontSize: '14px', fontWeight: chartMetric === m.id ? 600 : 450,
                    color: chartMetric === m.id ? '#6366f1' : '#64748b', cursor: 'pointer',
                    borderRadius: '4px 4px 0 0', transition: 'all 0.15s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {/* Line chart */}
            <div style={{ position: 'relative', height: '140px' }}>
              <svg width="100%" height="100%" viewBox="0 0 600 140" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                {/* Grid lines */}
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} x1="0" y1={i * 35 + 25} x2="600" y2={i * 35 + 25} stroke="#e2e8f0" strokeWidth="0.5" />
                  ))}
                  {/* Line */}
                  <polyline
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={chartData[chartMetric].map((val, i) => `${(i / 11) * 580 + 10},${125 - (val / maxVal) * 95}`).join(' ')}
                  />
                  {/* Area fill */}
                  <polygon
                    fill="url(#chartGradient)"
                    opacity="0.15"
                    points={`10,125 ${chartData[chartMetric].map((val, i) => `${(i / 11) * 580 + 10},${125 - (val / maxVal) * 95}`).join(' ')} 590,125`}
                  />
                  {/* Dots with labels */}
                  {chartData[chartMetric].map((val, i) => (
                    <g key={i}>
                      <circle cx={(i / 11) * 580 + 10} cy={125 - (val / maxVal) * 95} r="3" fill="#6366f1" />
                      <text x={(i / 11) * 580 + 10} y={125 - (val / maxVal) * 95 - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                        {chartUnits[chartMetric] === '$' ? `$${val.toFixed(2)}` : `${val}${chartUnits[chartMetric]}`}
                      </text>
                    </g>
                  ))}
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* X-axis labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                  {chartLabels.map((label, i) => (
                    <span key={i} style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'center', flex: 1 }}>{label}</span>
                  ))}
                </div>
            </div>
          </div>

          {/* Metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            {[
              { label: 'Success Rate', value: '87%', note: '↑ 2% from last month' },
              { label: 'Avg Response Time', value: '1.2s', note: '↓ 0.1s improvement' },
              { label: 'Conversion Rate', value: '34%', note: '↑ 2% from last month' },
              { label: 'Abandoned Calls', value: '4.2%', note: '↓ 0.8% improvement' },
            ].map((metric) => (
              <div key={metric.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{metric.label}</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#0f172a', marginTop: '8px' }}>{metric.value}</div>
                <div style={{ fontSize: '15px', color: '#94a3b8', marginTop: '8px' }}>{metric.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'summary' && (
        <div>
          {/* System Prompt — collapsed by default */}
          <details style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
            <summary style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', cursor: 'pointer', userSelect: 'none' }}>System Prompt</summary>
            <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginTop: '10px' }}>{systemPrompt || '—'}</p>
          </details>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Infrastructure</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[['Host', config.host || 'agentcore'], ['Framework', config.framework || 'strands-bidiagent'], ['Pipeline', config.pipeline || 'speech-to-speech'], ['Model', config.model?.join(', ') || '—']].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '14px', color: '#64748b' }}>{l}</span><span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 500 }}>{v}</span></div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Voice</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[['Voice ID', config.voice?.voiceId || '—'], ['Language', config.voice?.language || 'en-US'], ['Gender', config.voice?.gender || '—']].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '14px', color: '#64748b' }}>{l}</span><span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 500 }}>{v}</span></div>
                  ))}
                </div>
              </div>
            </div>
            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Tools ({config.tools?.length || 0})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {config.tools?.map((tool: string) => {
                    const resolved = availableTools.find((t) => `int:${t.id}` === tool || t.id === tool);
                    const label = resolved ? resolved.name : tool.replace('int:', '').substring(0, 8) + '...';
                    const typeLabel = resolved ? (resolved.type === 'webhook' ? 'API' : resolved.type) : '';
                    return (
                      <span key={tool} style={{ fontSize: '12px', padding: '4px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {label}
                        {typeLabel && <span style={{ fontSize: '10px', color: '#94a3b8' }}>({typeLabel})</span>}
                      </span>
                    );
                  })}
                  {(!config.tools || config.tools.length === 0) && <span style={{ fontSize: '14px', color: '#94a3b8' }}>None</span>}
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Logging</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#64748b' }}>Chat History</span>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: (config as any).callHistoryEnabled !== false ? '#10b981' : '#94a3b8' }}>
                      {(config as any).callHistoryEnabled !== false ? '● Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#64748b' }}>Raw Event Log</span>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: (config as any).callLogEnabled ? '#6366f1' : '#94a3b8' }}>
                      {(config as any).callLogEnabled ? '● Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'evaluation' && initialJobId && (
        <EvaluationTab agentId={id!} agentName={demo?.name || ''} systemPrompt={systemPrompt} initialJobId={initialJobId} />
      )}

      {activeTab === 'evaluation' && !initialJobId && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748b' }}>
          <p style={{ fontSize: '15px', marginBottom: '12px' }}>Evaluations have moved to Eval Suites.</p>
          <button onClick={() => navigate('/eval-suites')} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Go to Eval Suites
          </button>
        </div>
      )}

      {activeTab === 'prompt' && (
        <PromptEditor
          demo={demo}
          onSaved={(updatedDemo) => { setDemo(updatedDemo); setDirty(false); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000); }}
          onDirtyChange={(d) => setDirty(d)}
        />
      )}

      {activeTab === 'voice' && (
        <div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '12px' }}>Voice & Model Configuration</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[['Model', config.model?.join(', ') || '—'], ['Pipeline', config.pipeline || 'speech-to-speech'], ['Framework', config.framework || 'strands-bidiagent'], ['Host', config.host || 'agentcore']].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '14px', color: '#64748b' }}>{l}</span><span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 500 }}>{v}</span></div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[['Voice ID', config.voice?.voiceId || '—'], ['Language', config.voice?.language || 'en-US'], ['Gender', config.voice?.gender || '—'], ['Agent Starts First', config.agentStartFirst ? 'Yes' : 'No']].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '14px', color: '#64748b' }}>{l}</span><span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 500 }}>{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tools' && (
        <div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '12px' }}>Agent Tools ({config.tools?.length || 0})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {config.tools?.map((tool: string) => {
                const resolved = availableTools.find((t) => `int:${t.id}` === tool || t.id === tool);
                const label = resolved ? resolved.name : tool.replace('int:', '').substring(0, 8) + '...';
                const typeLabel = resolved ? (resolved.type === 'webhook' ? 'API' : resolved.type) : '';
                return (
                  <span key={tool} style={{ fontSize: '13px', padding: '6px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#475569', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {label}
                    {typeLabel && <span style={{ fontSize: '10px', color: '#94a3b8' }}>({typeLabel})</span>}
                  </span>
                );
              })}
              {(!config.tools || config.tools.length === 0) && <span style={{ fontSize: '14px', color: '#94a3b8' }}>No tools configured</span>}
            </div>
          </div>
          {config.customTools && config.customTools.length > 0 && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginTop: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '12px' }}>Custom Tools ({config.customTools.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {config.customTools.map((tool: any) => (
                  <div key={tool.name} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{tool.name}</div>
                    {tool.description && <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0' }}>{tool.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'workflow' && (
        <WorkflowCanvas
          initialData={typeof config.workflow === 'string' ? JSON.parse(config.workflow) : config.workflow || null}
          initialPrompt={config.systemPrompt || null}
          initialTools={config.tools || null}
          onStateChange={(data: WorkflowData) => { setWorkflowData(data); setDirty(true); }}
          onGenerate={(prompt, tools) => { lastGeneratedPromptRef.current = prompt; setDirty(true); }}
          onSave={async (data: WorkflowData) => {
            if (!id) return;
            setSaveStatus('saving');
            try {
              // Collect tools from nodes (or use editedTools if provided from prompt tab save)
              const allTools = data.editedTools !== undefined
                ? data.editedTools
                : [...new Set(data.nodes.filter((n: any) => n.type === 'step').flatMap((n: any) => (n.data?.tools || []).filter(Boolean)))];

              // Use editedPrompt (from direct prompt editing), or lastGeneratedPromptRef, or fallback
              const prompt = data.editedPrompt || lastGeneratedPromptRef.current || generatePromptFromWorkflow(data).prompt;
              const tools = allTools;

              // Stringify workflow to avoid DynamoDB float issues
              const configToSave = { ...config, workflow: JSON.stringify(data), systemPrompt: prompt, prompt: { greeting: config.prompt?.greeting || '', instructions: prompt }, tools };
              const updated = await updateDemo(id, { config: configToSave });
              setDemo(updated);
              setDirty(false);
              setSaveStatus('saved');
              setTimeout(() => setSaveStatus('idle'), 2000);
            } catch (e) {
              setSaveStatus('idle');
              console.error('Failed to save workflow:', e);
              alert(e instanceof Error ? e.message : 'Failed to save workflow');
            }
          }}
        />
      )}

      {activeTab === 'cost' && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
          <p style={{ fontSize: '15px' }}>Cost tracking and usage analytics.</p>
          <p style={{ fontSize: '15px', marginTop: '8px', color: '#cbd5e1' }}>Coming soon — monitor Bedrock token usage, latency, and per-session costs.</p>
        </div>
      )}

      {activeTab === 'history' && (
        <CallHistoryTab agentId={id || ''} />
      )}

      {activeTab === 'users' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>User Profile Analysis</h2>
            <p style={{ fontSize: '14px', color: '#64748b' }}>Customer interaction patterns, preferences, and behavioral insights derived from conversation history.</p>
          </div>

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
            {[
              { label: 'Total Users', value: '1,247', note: '+89 this month' },
              { label: 'Returning Users', value: '68%', note: '↑ 4% from last month' },
              { label: 'Avg Sessions/User', value: '3.2', note: '↑ 0.3 improvement' },
              { label: 'Satisfaction Score', value: '4.6/5', note: 'Based on 412 ratings' },
            ].map((metric) => (
              <div key={metric.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{metric.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>{metric.value}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>{metric.note}</div>
              </div>
            ))}
          </div>

          {/* User Segments */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>User Segments</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              {[
                { segment: 'Frequent Callers', count: 312, pct: '25%', color: '#6366f1', traits: 'Call 3+ times/month, prefer quick resolution, high loyalty' },
                { segment: 'New Users', count: 189, pct: '15%', color: '#10b981', traits: 'First-time callers, need more guidance, longer call duration' },
                { segment: 'Complex Issues', count: 156, pct: '13%', color: '#f59e0b', traits: 'Multi-topic inquiries, often require escalation, detailed explanations needed' },
                { segment: 'Self-Service Oriented', count: 402, pct: '32%', color: '#06b6d4', traits: 'Quick balance checks, status inquiries, minimal agent interaction' },
                { segment: 'Sensitive/VIP', count: 98, pct: '8%', color: '#ec4899', traits: 'High-value accounts, expect personalized service, low tolerance for errors' },
                { segment: 'At-Risk', count: 90, pct: '7%', color: '#dc2626', traits: 'Expressed dissatisfaction, multiple unresolved issues, churn indicators' },
              ].map((seg) => (
                <div key={seg.segment} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: seg.color }} />
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{seg.segment}</span>
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>{seg.count} <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 400 }}>({seg.pct})</span></div>
                  <p style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', lineHeight: 1.4 }}>{seg.traits}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent User Profiles */}
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Recent User Profiles</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { name: 'Sarah Johnson', id: 'USR-4521', segment: 'Frequent Callers', lastContact: '2 hours ago', sentiment: 'Positive', topics: ['account balance', 'mortgage inquiry'] },
                { name: 'Michael Chen', id: 'USR-7832', segment: 'New Users', lastContact: '1 day ago', sentiment: 'Neutral', topics: ['account setup', 'card activation'] },
                { name: 'Emily Rodriguez', id: 'USR-2198', segment: 'Complex Issues', lastContact: '3 days ago', sentiment: 'Negative', topics: ['dispute', 'refund request', 'escalation'] },
                { name: 'James Park', id: 'USR-9043', segment: 'Self-Service Oriented', lastContact: '5 hours ago', sentiment: 'Positive', topics: ['quick balance check'] },
                { name: 'Linda Thompson', id: 'USR-5567', segment: 'Sensitive/VIP', lastContact: '1 day ago', sentiment: 'Positive', topics: ['investment inquiry', 'account review'] },
              ].map((user) => (
                <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600, color: '#64748b', flexShrink: 0 }}>
                    {user.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{user.name}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{user.id}</span>
                      <span style={{ fontSize: '10px', padding: '2px 6px', background: '#eef2ff', color: '#6366f1', borderRadius: '3px' }}>{user.segment}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{user.lastContact}</span>
                      <span style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '3px', background: user.sentiment === 'Positive' ? '#f0fdf4' : user.sentiment === 'Negative' ? '#fef2f2' : '#f8fafc', color: user.sentiment === 'Positive' ? '#16a34a' : user.sentiment === 'Negative' ? '#dc2626' : '#64748b' }}>{user.sentiment}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {user.topics.map((t) => (
                          <span key={t} style={{ fontSize: '10px', padding: '1px 5px', background: '#f1f5f9', borderRadius: '3px', color: '#64748b' }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline prompt editor with save capability */
function PromptEditor({ demo, onSaved, onDirtyChange }: { demo: Demo; onSaved: (d: Demo) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const config = demo.config;
  const [instructions, setInstructions] = useState(config.systemPrompt || config.prompt?.instructions || '');
  const [greeting, setGreeting] = useState(config.prompt?.greeting || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const hasChanges = instructions !== (config.systemPrompt || config.prompt?.instructions || '')
    || greeting !== (config.prompt?.greeting || '');

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  // Expose a save function via the parent's global save button
  useEffect(() => {
    (window as any).__promptEditorSave = async () => {
      setSaving(true);
      setError('');
      setSaved(false);
      try {
        const updatedConfig = {
          ...config,
          systemPrompt: instructions,
          prompt: { greeting, instructions },
        };
        const result = await updateDemo(demo.id, { config: updatedConfig });
        onSaved(result);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save');
      } finally {
        setSaving(false);
      }
    };
    return () => { delete (window as any).__promptEditorSave; };
  }, [instructions, greeting, config, demo.id, onSaved]);

  return (
    <div>
      {error && (
        <div style={{ marginBottom: '12px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' }}>
          <span style={{ fontSize: '13px', color: '#dc2626' }}>{error}</span>
        </div>
      )}

      {/* System Prompt */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>System Prompt</div>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          style={{
            width: '100%',
            minHeight: '300px',
            fontSize: '14px',
            color: '#334155',
            lineHeight: '1.7',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '14px',
            resize: 'vertical',
            fontFamily: 'inherit',
            background: 'white',
          }}
          placeholder="Enter system prompt instructions..."
        />
      </div>

      {/* Greeting */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Greeting</div>
        <textarea
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          style={{
            width: '100%',
            minHeight: '80px',
            fontSize: '14px',
            color: '#334155',
            lineHeight: '1.7',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '14px',
            resize: 'vertical',
            fontFamily: 'inherit',
            background: 'white',
          }}
          placeholder="What the agent says when the conversation starts..."
        />
      </div>
    </div>
  );
}

export default AgentDetail;
