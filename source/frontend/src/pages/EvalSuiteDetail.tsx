import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEvalSuite, updateEvalSuite } from '../services/evalSuitesApi';
import type { EvalSuite } from '../services/evalSuitesApi';
import { listEvalJobsBySuite, startEvalJobWithOverride, deleteEvalJob, updateEvalJobName } from '../services/evalApi';
import type { EvalJob, EvalJobConfig } from '../services/evalApi';
import { listTools } from '../services/toolsApi';
import type { SavedTool } from '../services/toolsApi';
import { listDemos } from '../services/demosApi';
import type { Demo } from '../services/demosApi';
import { listRAGSources } from '../services/ragApi';
import type { RAGSource } from '../services/ragApi';

function EvalSuiteDetail() {
  const { id: suiteId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [suite, setSuite] = useState<EvalSuite | null>(null);
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [availableTools, setAvailableTools] = useState<SavedTool[]>([]);
  const [ragSources, setRagSources] = useState<RAGSource[]>([]);
  const [agents, setAgents] = useState<Demo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRunEval, setShowRunEval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline editing state
  const [editingSuiteName, setEditingSuiteName] = useState(false);
  const [editedSuiteName, setEditedSuiteName] = useState('');
  const [editingSuiteDesc, setEditingSuiteDesc] = useState(false);
  const [editedSuiteDesc, setEditedSuiteDesc] = useState('');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editedJobName, setEditedJobName] = useState('');

  // Sort state
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'model' | 'result' | 'created'>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Run Eval form state
  const [tcName, setTcName] = useState('');
  const [tcAgentId, setTcAgentId] = useState('');
  const [tcTools, setTcTools] = useState('');
  const [toolSearchEval, setToolSearchEval] = useState('');
  const [tcModel] = useState('nova-2-sonic');
  const [tcSonicModelId, setTcSonicModelId] = useState('');
  const [tcPromptOverride, setTcPromptOverride] = useState('');
  const [tcUserPrompt, setTcUserPrompt] = useState('');
  const [tcUserModelId, setTcUserModelId] = useState('claude-haiku');
  const [tcMaxTurns, setTcMaxTurns] = useState(15);
  const [tcInputMode, setTcInputMode] = useState<'text' | 'polly'>('text');
  const [tcUseMock, setTcUseMock] = useState(true);
  const [tcAllowHangup, setTcAllowHangup] = useState(true);
  const [tcMaxTokens, setTcMaxTokens] = useState(1024);
  const [tcTemperature, setTcTemperature] = useState(0.7);
  const [tcTopP, setTcTopP] = useState(0.9);
  const [tcEvalAspects, setTcEvalAspects] = useState('');
  const [tcCustomMetrics, setTcCustomMetrics] = useState<{name: string; description: string}[]>([]);
  const [showCustomMetricPopup, setShowCustomMetricPopup] = useState(false);
  const [tcNewMetricName, setTcNewMetricName] = useState('');
  const [tcNewMetricDesc, setTcNewMetricDesc] = useState('');

  const fetchData = useCallback(async () => {
    if (!suiteId) return;
    setLoading(true);
    try {
      const [suiteData, jobsData, toolsData, agentsData, ragData] = await Promise.all([
        getEvalSuite(suiteId),
        listEvalJobsBySuite(suiteId),
        listTools(),
        listDemos(),
        listRAGSources().catch(() => []),
      ]);
      setSuite(suiteData);
      setJobs(jobsData.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setAvailableTools(toolsData);
      setAgents(agentsData);
      setRagSources(ragData);
    } catch {
      // suite or jobs may not exist yet
    } finally {
      setLoading(false);
    }
  }, [suiteId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchData(); } catch {}
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm('Delete this eval job? This cannot be undone.')) return;
    try {
      await deleteEvalJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleRenameSuite = async () => {
    if (!suiteId || !suite || !editedSuiteName.trim()) return;
    if (editedSuiteName.trim() === suite.name) { setEditingSuiteName(false); return; }
    try {
      const updated = await updateEvalSuite(suiteId, { name: editedSuiteName.trim() });
      setSuite(updated);
      setEditingSuiteName(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename suite');
    }
  };

  const handleUpdateDescription = async () => {
    if (!suiteId || !suite) return;
    if (editedSuiteDesc.trim() === (suite.description || '')) { setEditingSuiteDesc(false); return; }
    try {
      const updated = await updateEvalSuite(suiteId, { description: editedSuiteDesc.trim() });
      setSuite(updated);
      setEditingSuiteDesc(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update description');
    }
  };

  const handleRenameJob = async (jobId: string) => {
    if (!editedJobName.trim()) { setEditingJobId(null); return; }
    const job = jobs.find((j) => j.id === jobId);
    if (editedJobName.trim() === job?.config.testName) { setEditingJobId(null); return; }
    try {
      await updateEvalJobName(jobId, editedJobName.trim());
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, config: { ...j.config, testName: editedJobName.trim() } } : j));
      setEditingJobId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename task');
    }
  };

  const handleRunEval = async () => {
    if (!suiteId || !suite || !tcName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const prompt = tcPromptOverride.trim();
      const tools = tcTools.trim() ? tcTools.split(',').map(s => s.trim()).filter(Boolean) : (() => {
        // Fallback: try to get tools from the source agent
        if (suite.sourceAgentId) {
          const agent = agents.find(a => a.id === suite.sourceAgentId);
          if (agent?.config?.tools?.length) return agent.config.tools;
        }
        return suite.tools || [];
      })();
      const agentConfigOverride: Record<string, any> = {
        systemPrompt: prompt,
        prompt: { instructions: prompt, greeting: '' },
        tools,
        customTools: [],
        model: [tcModel],
        modelId: tcSonicModelId.trim() || undefined,
        useMock: tcUseMock,
        voice: {},
        inferenceConfig: {
          maxTokens: tcMaxTokens,
          temperature: tcTemperature,
          topP: tcTopP,
        },
      };
      const aspects = tcEvalAspects.split(',').map(s => s.trim()).filter(Boolean);
      const evalConfig: EvalJobConfig = {
        testName: tcName.trim(),
        scenarioDescription: '',
        maxTurns: tcMaxTurns,
        userModelId: tcUserModelId,
        inputMode: tcInputMode,
        evaluationAspects: aspects.length > 0 ? aspects : ['overall quality'],
        useMock: tcUseMock,
        allowHangup: tcAllowHangup,
        userSystemPrompt: tcUserPrompt.trim(),
      };
      // Build rubrics from custom metrics
      if (tcCustomMetrics.length > 0) {
        const rubrics: Record<string, string[]> = {};
        for (const m of tcCustomMetrics) {
          rubrics[m.name] = m.description ? m.description.split(';').map(s => s.trim()).filter(Boolean) : [];
        }
        evalConfig.rubrics = rubrics;
      }
      await startEvalJobWithOverride(evalConfig, agentConfigOverride, suiteId, '', suite.sourceAgentId || '');
      resetForm();
      setShowRunEval(false);
      setIsSubmitting(false);
      await fetchData();
    } catch (err) {
      setIsSubmitting(false);
      alert(err instanceof Error ? err.message : 'Failed to start eval');
    }
  };

  const resetForm = () => {
    setTcName('');
    setTcAgentId('');
    setTcTools('');
    setTcSonicModelId('');
    setTcPromptOverride('');
    setTcUserPrompt('');
    setTcUserModelId('claude-haiku');
    setTcMaxTurns(15);
    setTcInputMode('text');
    setTcUseMock(true);
    setTcAllowHangup(true);
    setTcMaxTokens(1024);
    setTcTemperature(0.7);
    setTcTopP(0.9);
    setTcEvalAspects('');
    setTcCustomMetrics([]);
    setShowCustomMetricPopup(false);
    setTcNewMetricName('');
    setTcNewMetricDesc('');
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
  };

  const statusColor = (status: string): { bg: string; color: string } => {
    const colors: Record<string, { bg: string; color: string }> = {
      COMPLETED: { bg: '#f0fdf4', color: '#16a34a' },
      RUNNING: { bg: '#eff6ff', color: '#2563eb' },
      EVALUATING: { bg: '#eff6ff', color: '#2563eb' },
      PENDING: { bg: '#f8fafc', color: '#94a3b8' },
      FAILED: { bg: '#fef2f2', color: '#dc2626' },
      CANCELLED: { bg: '#f8fafc', color: '#64748b' },
    };
    return colors[status] || colors.PENDING;
  };

  const resolveToolName = (toolRef: string): string => {
    if (toolRef.startsWith('rag:')) {
      const kb = ragSources.find((r) => r.id === toolRef.replace('rag:', ''));
      return kb ? kb.name : toolRef;
    }
    const resolved = availableTools.find((t) => `int:${t.id}` === toolRef || t.id === toolRef);
    return resolved ? resolved.name : toolRef.replace('int:', '').substring(0, 12) + '...';
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created' ? 'desc' : 'asc');
    }
  };

  const sortedJobs = [...jobs].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = (a.config.testName || '').localeCompare(b.config.testName || '');
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'model': {
        const mA = (a.agentSnapshot as any)?.modelId || '';
        const mB = (b.agentSnapshot as any)?.modelId || '';
        cmp = mA.localeCompare(mB);
        break;
      }
      case 'result': {
        const rA = a.summary?.overallRating || '';
        const rB = b.summary?.overallRating || '';
        cmp = rA.localeCompare(rB);
        break;
      }
      case 'created':
        cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortIcon = ({ column }: { column: typeof sortKey }) => (
    <span style={{ marginLeft: '4px', display: 'inline-flex', opacity: sortKey === column ? 1 : 0.3 }}>
      {sortKey === column && sortDir === 'asc' ? '▲' : sortKey === column && sortDir === 'desc' ? '▼' : '⇅'}
    </span>
  );

  if (loading) return <div style={{ padding: '32px', color: '#94a3b8' }}>Loading...</div>;
  if (!suite) return <div style={{ padding: '32px', color: '#dc2626' }}>Suite not found.</div>;

  return (
    <div style={{ width: '100%' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          {editingSuiteName ? (
            <input
              autoFocus
              value={editedSuiteName}
              onChange={(e) => setEditedSuiteName(e.target.value)}
              onBlur={handleRenameSuite}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSuite(); if (e.key === 'Escape') setEditingSuiteName(false); }}
              style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', border: '1px solid #6366f1', borderRadius: '6px', padding: '2px 8px', outline: 'none', width: '100%', maxWidth: '400px' }}
            />
          ) : (
            <h1
              style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', cursor: 'pointer', borderBottom: '1px dashed transparent' }}
              onDoubleClick={() => { setEditedSuiteName(suite.name); setEditingSuiteName(true); }}
              title="Double-click to rename"
            >
              {suite.name}
              <button
                onClick={() => { setEditedSuiteName(suite.name); setEditingSuiteName(true); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: '6px', padding: '2px', verticalAlign: 'middle' }}
                title="Rename suite"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </h1>
          )}
          {editingSuiteDesc ? (
            <input
              autoFocus
              value={editedSuiteDesc}
              onChange={(e) => setEditedSuiteDesc(e.target.value)}
              onBlur={handleUpdateDescription}
              onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateDescription(); if (e.key === 'Escape') setEditingSuiteDesc(false); }}
              placeholder="Add a description..."
              style={{ fontSize: '14px', color: '#475569', border: '1px solid #6366f1', borderRadius: '4px', padding: '2px 6px', outline: 'none', width: '100%', maxWidth: '500px', marginTop: '2px' }}
            />
          ) : (
            <p
              style={{ fontSize: '14px', color: '#94a3b8', marginTop: '2px', cursor: 'pointer' }}
              onDoubleClick={() => { setEditedSuiteDesc(suite.description || ''); setEditingSuiteDesc(true); }}
              title="Double-click to edit description"
            >
              {suite.description || 'No description'}
              <button
                onClick={() => { setEditedSuiteDesc(suite.description || ''); setEditingSuiteDesc(true); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: '4px', padding: '2px', verticalAlign: 'middle' }}
                title="Edit description"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleRefresh} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 0.6s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button onClick={() => navigate(`/eval-suites/${suiteId}/compare`)} style={{ padding: '8px 16px', background: 'white', color: '#6366f1', border: '1px solid #6366f1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Compare
          </button>
          <button onClick={() => { setTcName(`${suite.name} - `); setShowRunEval(true); }} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Run Eval
          </button>
        </div>
      </div>

      {/* Eval Tasks table */}
      {jobs.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name<SortIcon column="name" /></th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('status')}>Status<SortIcon column="status" /></th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('model')}>Model / Expert<SortIcon column="model" /></th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('result')}>Result<SortIcon column="result" /></th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('created')}>Created<SortIcon column="created" /></th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#64748b', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedJobs.map((job) => {
              const c = statusColor(job.status);
              const sonicModelId = (job.agentSnapshot as any)?.modelId || '';
              const result = job.summary?.overallRating;
              return (
                <tr key={job.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={() => navigate(`/agents/${suite.sourceAgentId || '_'}/evaluation/${job.id}`)}>
                  <td style={{ padding: '12px', fontWeight: 500, color: '#6366f1' }} onClick={(e) => e.stopPropagation()}>
                    {editingJobId === job.id ? (
                      <input
                        autoFocus
                        value={editedJobName}
                        onChange={(e) => setEditedJobName(e.target.value)}
                        onBlur={() => handleRenameJob(job.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameJob(job.id); if (e.key === 'Escape') setEditingJobId(null); }}
                        style={{ fontSize: '14px', fontWeight: 500, color: '#6366f1', border: '1px solid #6366f1', borderRadius: '4px', padding: '2px 6px', outline: 'none', width: '100%' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => { e.stopPropagation(); setEditedJobName(job.config.testName || ''); setEditingJobId(job.id); }}
                        title="Double-click to rename"
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/agents/${suite.sourceAgentId || '_'}/evaluation/${job.id}`)}
                      >
                        {job.config.testName || 'Unnamed eval'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ fontSize: '12px', padding: '2px 8px', background: c.bg, color: c.color, borderRadius: '4px' }}>
                      {job.status.charAt(0) + job.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: '#64748b', fontSize: '13px' }}>
                    {sonicModelId ? (sonicModelId.split('.').pop()?.split(':')[0] || sonicModelId) : 'Nova Sonic'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {result ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', background: result === 'PASS' ? '#f0fdf4' : '#fef2f2', color: result === 'PASS' ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          {result}
                        </span>
                        {job.summary?.metricVerdicts && (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {Object.values(job.summary.metricVerdicts).filter((v) => v === 'PASS').length}/{Object.keys(job.summary.metricVerdicts).length}
                          </span>
                        )}
                      </div>
                    ) : <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px', color: '#64748b' }}>{formatDate(job.createdAt)}</td>
                  <td style={{ padding: '12px' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button title="Rename" onClick={() => { setEditedJobName(job.config.testName || ''); setEditingJobId(job.id); }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button title="Copy & Edit" onClick={() => {
                        const jc = job.config;
                        setTcName(`${jc.testName || 'Unnamed'} (copy)`);
                        setTcPromptOverride(job.agentSnapshot?.systemPrompt || '');
                        setTcTools((job.agentSnapshot?.tools || []).map((t: any) => typeof t === 'string' ? t : (t.id && t.id.includes(':') ? t.id : `int:${t.id}`)).join(', '));
                        // Restore Expert Tool settings
                        const snapshot = job.agentSnapshot as any;
                        setTcSonicModelId(snapshot?.modelId || '');
                        setTcUserPrompt(jc.userSystemPrompt || '');
                        setTcUserModelId(jc.userModelId || 'claude-haiku');
                        setTcMaxTurns(jc.maxTurns || 15);
                        setTcInputMode(jc.inputMode || 'text');
                        setTcUseMock(jc.useMock ?? true);
                        setTcAllowHangup(jc.allowHangup ?? true);
                        // Restore inference config
                        const infConf = snapshot?.inferenceConfig || {};
                        setTcMaxTokens(infConf.maxTokens || 1024);
                        setTcTemperature(infConf.temperature ?? 0.7);
                        setTcTopP(infConf.topP ?? 0.9);
                        setTcEvalAspects((jc.evaluationAspects || []).join(', '));
                        // Restore custom metrics from rubrics
                        if (jc.rubrics && typeof jc.rubrics === 'object') {
                          const metrics = Object.entries(jc.rubrics).map(([name, criteria]) => ({
                            name,
                            description: Array.isArray(criteria) ? (criteria as string[]).join('; ') : '',
                          }));
                          setTcCustomMetrics(metrics);
                        } else {
                          setTcCustomMetrics([]);
                        }
                        setShowRunEval(true);
                      }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                      <button title="Delete" onClick={() => handleDeleteJob(job.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          No eval tasks yet. Click "+ Run Eval" to start one.
        </div>
      )}

      {/* Run Eval Modal */}
      {showRunEval && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowRunEval(false)}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '28px', width: '70vw', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Run Evaluation</h2>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Name</label>
            <input value={tcName} onChange={(e) => setTcName(e.target.value)} placeholder="e.g. Baseline test" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }} />

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Load from Agent <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <select value={tcAgentId} onChange={(e) => {
              const agentId = e.target.value;
              setTcAgentId(agentId);
              if (agentId) {
                const agent = agents.find(a => a.id === agentId);
                if (agent) {
                  const config = agent.config;
                  setTcPromptOverride(config.prompt?.instructions || config.systemPrompt || '');
                  setTcTools((config.tools || []).join(', '));
                  setTcSonicModelId((config as any).modelId || '');
                }
              }
            }} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '16px', background: 'white' }}>
              <option value="">— None (configure manually) —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Model</label>
            <input value={tcModel} disabled style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '12px', background: '#f8fafc' }} />

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Sonic Model ID <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <input value={tcSonicModelId} onChange={(e) => setTcSonicModelId(e.target.value)} placeholder="e.g. amazon.nova-2-sonic-early-access:0 (leave empty for default)" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }} />

            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Tools</label>
              {/* Selected tools as breadcrumbs/chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px' }}>
                {tcTools.split(',').map(s => s.trim()).filter(Boolean).map((ref) => {
                  const tool = availableTools.find((t) => `int:${t.id}` === ref || t.id === ref);
                  const ragKb = ref.startsWith('rag:') ? ragSources.find((kb) => kb.id === ref.replace('rag:', '')) : null;
                  const label = tool ? tool.name : ragKb ? ragKb.name : ref.replace('int:', '').substring(0, 16);
                  const isRag = !!ragKb;
                  return (
                    <span key={ref} style={{ fontSize: '12px', padding: '4px 8px', background: isRag ? '#ecfdf5' : '#eef2ff', border: `1px solid ${isRag ? '#a7f3d0' : '#c7d2fe'}`, borderRadius: '14px', color: isRag ? '#065f46' : '#4338ca', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {label}
                      <button
                        type="button"
                        onClick={() => {
                          const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                          setTcTools(current.filter((r) => r !== ref).join(', '));
                        }}
                        style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '14px', padding: 0, lineHeight: 1, display: 'flex' }}
                        title="Remove tool"
                      >×</button>
                    </span>
                  );
                })}
                {!tcTools.trim() && <span style={{ fontSize: '12px', color: '#94a3b8' }}>No tools selected</span>}
              </div>
              {/* Add tool search */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search tools to add..."
                  value={toolSearchEval}
                  onChange={(e) => setToolSearchEval(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', background: 'white', color: '#475569' }}
                />
                {toolSearchEval && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {availableTools
                      .filter((t) => {
                        const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                        const q = toolSearchEval.toLowerCase();
                        return !current.includes(`int:${t.id}`) && !current.includes(t.id) && (t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q));
                      })
                      .map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                            setTcTools([...current, `int:${t.id}`].join(', '));
                            setToolSearchEval('');
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'white', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}
                        >
                          <span style={{ fontWeight: 500, color: '#334155', flex: 1 }}>{t.name}</span>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>{t.type === 'webhook' ? 'API' : t.type === 'mcp' ? 'MCP' : t.type}</span>
                        </button>
                      ))
                    }
                    {/* RAG Knowledge Bases */}
                    {ragSources
                      .filter((kb) => {
                        const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                        const q = toolSearchEval.toLowerCase();
                        return !current.includes(`rag:${kb.id}`) && (kb.name.toLowerCase().includes(q) || 'rag'.includes(q) || 'knowledge'.includes(q) || (kb.description || '').toLowerCase().includes(q));
                      })
                      .map((kb) => (
                        <button
                          key={`rag-${kb.id}`}
                          type="button"
                          onClick={() => {
                            const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                            setTcTools([...current, `rag:${kb.id}`].join(', '));
                            setToolSearchEval('');
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'white', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}
                        >
                          <span style={{ fontWeight: 500, color: '#334155', flex: 1 }}>{kb.name}</span>
                          <span style={{ fontSize: '10px', color: '#10b981' }}>RAG</span>
                        </button>
                      ))
                    }
                    {availableTools.filter((t) => {
                      const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                      const q = toolSearchEval.toLowerCase();
                      return !current.includes(`int:${t.id}`) && !current.includes(t.id) && (t.name.toLowerCase().includes(q) || t.type.includes(q) || (t.description || '').toLowerCase().includes(q));
                    }).length === 0 && ragSources.filter((kb) => {
                      const current = tcTools.split(',').map(s => s.trim()).filter(Boolean);
                      const q = toolSearchEval.toLowerCase();
                      return !current.includes(`rag:${kb.id}`) && (kb.name.toLowerCase().includes(q) || 'rag'.includes(q) || 'knowledge'.includes(q) || (kb.description || '').toLowerCase().includes(q));
                    }).length === 0 && (
                      <div style={{ padding: '10px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>No matching tools</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <details style={{ marginTop: '16px' }} open={!!tcPromptOverride}>
              <summary style={{ fontSize: '13px', fontWeight: 600, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>System Prompt {tcPromptOverride ? <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '11px' }}>({tcPromptOverride.length} chars)</span> : ''}</summary>
              <textarea value={tcPromptOverride} onChange={(e) => setTcPromptOverride(e.target.value)} placeholder="Enter the system prompt for this eval..." style={{ width: '100%', minHeight: '100px', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', resize: 'vertical', marginTop: '8px' }} />
            </details>

            {/* Eval Settings */}
            <div style={{ marginTop: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Eval Settings</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div onClick={() => setTcUseMock(!tcUseMock)} style={{ width: '32px', height: '18px', borderRadius: '9px', background: tcUseMock ? '#6366f1' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: tcUseMock ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                    </div>
                    <span style={{ fontSize: '11px', color: '#475569' }}>Mock</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div onClick={() => setTcAllowHangup(!tcAllowHangup)} style={{ width: '32px', height: '18px', borderRadius: '9px', background: tcAllowHangup ? '#6366f1' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: tcAllowHangup ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                    </div>
                    <span style={{ fontSize: '11px', color: '#475569' }}>Hangup</span>
                  </div>
                </div>
              </div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '4px' }}>User Simulator Persona</label>
              <textarea value={tcUserPrompt} onChange={(e) => setTcUserPrompt(e.target.value)} placeholder="Describe how the simulated caller should behave..." rows={6} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', resize: 'vertical', marginBottom: '10px' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>User Simulator LLM</label>
                  <select value={tcUserModelId} onChange={(e) => setTcUserModelId(e.target.value)} style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', background: 'white' }}>
                    <option value="claude-haiku">Claude Haiku (fast)</option>
                    <option value="claude-sonnet">Claude Sonnet (smarter)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>Input Mode</label>
                  <select value={tcInputMode} onChange={(e) => setTcInputMode(e.target.value as 'text' | 'polly')} style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', background: 'white' }}>
                    <option value="text">Text (faster)</option>
                    <option value="polly">Polly (audio via TTS)</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>Max Turns</label>
                  <input type="number" value={tcMaxTurns} onChange={(e) => setTcMaxTurns(parseInt(e.target.value) || 15)} style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
                </div>
              </div>

              {/* Inference Config */}
              <details style={{ marginBottom: '10px' }}>
                <summary style={{ fontSize: '12px', fontWeight: 600, color: '#475569', cursor: 'pointer', userSelect: 'none', marginBottom: '8px' }}>Inference Config</summary>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', paddingLeft: '4px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>Max Tokens</label>
                    <input type="number" value={tcMaxTokens} onChange={(e) => setTcMaxTokens(parseInt(e.target.value) || 1024)} min={1} max={4096} style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>Temperature</label>
                    <input type="number" value={tcTemperature} onChange={(e) => setTcTemperature(parseFloat(e.target.value) || 0.7)} min={0} max={1} step={0.1} style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '3px' }}>Top P</label>
                    <input type="number" value={tcTopP} onChange={(e) => setTcTopP(parseFloat(e.target.value) || 0.9)} min={0} max={1} step={0.05} style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
                  </div>
                </div>
              </details>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '6px' }}>Evaluation Aspects</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {['Goal Achievement', 'Response Quality', 'Conversation Flow', 'Tool Usage', 'Tone & Professionalism'].map((aspect) => {
                    const selected = tcEvalAspects.split(',').map(s => s.trim()).includes(aspect);
                    return (
                      <button
                        key={aspect}
                        type="button"
                        onClick={() => {
                          const current = tcEvalAspects.split(',').map(s => s.trim()).filter(Boolean);
                          if (selected) {
                            setTcEvalAspects(current.filter(a => a !== aspect).join(', '));
                          } else {
                            setTcEvalAspects([...current, aspect].join(', '));
                          }
                        }}
                        style={{
                          padding: '4px 10px', fontSize: '11px', borderRadius: '14px', cursor: 'pointer',
                          border: selected ? '1px solid #6366f1' : '1px solid #e2e8f0',
                          background: selected ? '#eef2ff' : 'white',
                          color: selected ? '#6366f1' : '#64748b',
                        }}
                      >
                        {aspect}
                      </button>
                    );
                  })}
                </div>

                {/* Custom metrics */}
                {tcCustomMetrics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {tcCustomMetrics.map((m) => (
                      <span key={m.name} style={{ fontSize: '11px', padding: '3px 8px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '4px', color: '#4f46e5', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {m.name}
                        <button onClick={() => setTcCustomMetrics((prev) => prev.filter((x) => x.name !== m.name))} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setShowCustomMetricPopup(true)}
                    style={{ padding: '5px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px', color: '#475569', cursor: 'pointer' }}
                  >
                    + Add Custom Metric
                  </button>
                </div>

                {/* Custom metric popup */}
                {showCustomMetricPopup && (
                  <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '11px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '3px' }}>Metric Name</label>
                        <input value={tcNewMetricName} onChange={(e) => setTcNewMetricName(e.target.value)} placeholder="e.g. End call tool invocation" style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '3px' }}>Description / Rubric Questions (semicolon-separated)</label>
                        <textarea value={tcNewMetricDesc} onChange={(e) => setTcNewMetricDesc(e.target.value)} placeholder="Describe what success looks like, or add rubric questions separated by ;" rows={2} style={{ width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', resize: 'vertical' }} />
                      </div>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => { setShowCustomMetricPopup(false); setTcNewMetricName(''); setTcNewMetricDesc(''); }} style={{ padding: '5px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                        <button type="button" disabled={!tcNewMetricName.trim()} onClick={() => {
                          const name = tcNewMetricName.trim();
                          const desc = tcNewMetricDesc.trim();
                          setTcCustomMetrics((prev) => [...prev, { name, description: desc }]);
                          const current = tcEvalAspects.split(',').map(s => s.trim()).filter(Boolean);
                          if (!current.includes(name)) setTcEvalAspects([...current, name].join(', '));
                          setShowCustomMetricPopup(false);
                          setTcNewMetricName('');
                          setTcNewMetricDesc('');
                        }} style={{ padding: '5px 10px', background: tcNewMetricName.trim() ? '#6366f1' : '#e2e8f0', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: tcNewMetricName.trim() ? 'pointer' : 'not-allowed' }}>Add</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button onClick={() => { resetForm(); setShowRunEval(false); }} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleRunEval} disabled={!tcName.trim() || isSubmitting} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: (tcName.trim() && !isSubmitting) ? 1 : 0.5 }}>{isSubmitting ? 'Running...' : 'Run'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EvalSuiteDetail;
