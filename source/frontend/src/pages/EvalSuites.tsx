import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDemos } from '../services/demosApi';
import type { Demo } from '../services/demosApi';
import { listEvalSuites, createEvalSuite, deleteEvalSuite } from '../services/evalSuitesApi';
import type { EvalSuite } from '../services/evalSuitesApi';
import { listAllEvalJobs } from '../services/evalApi';
import type { EvalJob } from '../services/evalApi';
import { useAuth } from '../context/AuthContext';
import { useFilter } from '../context/FilterContext';
import styles from './Demos.module.css';

function EvalSuites() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { showOnlyMine } = useFilter();
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [agents, setAgents] = useState<Demo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sortColumn, setSortColumn] = useState<'name' | 'description' | 'created'>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [suiteJobs, setSuiteJobs] = useState<Record<string, EvalJob[]>>({});

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [suitesData, agentsData] = await Promise.all([
        listEvalSuites(),
        listDemos(),
      ]);
      setSuites(suitesData);
      setAgents(agentsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load eval suites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch all jobs in one call and group by suiteId
  useEffect(() => {
    if (suites.length === 0) return;
    listAllEvalJobs().then((allJobs) => {
      const grouped: Record<string, EvalJob[]> = {};
      for (const job of allJobs) {
        const sid = job.suiteId;
        if (sid) {
          if (!grouped[sid]) grouped[sid] = [];
          grouped[sid].push(job);
        }
      }
      setSuiteJobs(grouped);
    }).catch(() => {});
  }, [suites]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchData(); } catch {}
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleCreate = async () => {
    try {
      const sourceAgentId = selectedAgentId || undefined;

      const suite = await createEvalSuite({
        name: newName.trim(),
        description: newDescription.trim(),
        basePrompt: '',
        tools: [],
        sourceAgentId,
      });

      setSuites((prev) => [suite, ...prev]);
      resetCreateForm();
      setShowCreate(false);
      navigate(`/eval-suites/${suite.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create eval suite');
    }
  };

  const handleDelete = async (suiteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this eval suite? This cannot be undone.')) return;
    try {
      await deleteEvalSuite(suiteId);
      setSuites((prev) => prev.filter((s) => s.id !== suiteId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const resetCreateForm = () => {
    setNewName('');
    setNewDescription('');
    setSelectedAgentId('');
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
  };

  const handleSort = (column: 'name' | 'description' | 'created') => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'created' ? 'desc' : 'asc');
    }
  };

  const filteredSuites = showOnlyMine && user?.email
    ? suites.filter((s) => s.userEmail === user.email)
    : suites;

  const sortedSuites = [...filteredSuites].sort((a, b) => {
    let cmp = 0;
    if (sortColumn === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortColumn === 'description') {
      cmp = (a.description || '').localeCompare(b.description || '');
    } else {
      cmp = a.createdAt.localeCompare(b.createdAt);
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const SortIcon = ({ column }: { column: 'name' | 'description' | 'created' }) => {
    if (sortColumn !== column) return <span style={{ marginLeft: '4px', color: '#cbd5e1' }}>↕</span>;
    return <span style={{ marginLeft: '4px' }}>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const getPassFailLabel = (suiteId: string) => {
    const jobs = suiteJobs[suiteId];
    if (!jobs || jobs.length === 0) return <span style={{ color: '#94a3b8', fontSize: '13px' }}>—</span>;
    const completed = jobs.filter((j) => j.status === 'COMPLETED' && j.summary);
    if (completed.length === 0) {
      const running = jobs.filter((j) => j.status === 'RUNNING' || j.status === 'PENDING' || j.status === 'EVALUATING').length;
      if (running > 0) return <span style={{ color: '#f59e0b', fontSize: '13px' }}>{running} running</span>;
      return <span style={{ color: '#94a3b8', fontSize: '13px' }}>{jobs.length} jobs</span>;
    }
    // Aggregate metric verdicts across all completed jobs
    let totalMetrics = 0;
    let passedMetrics = 0;
    for (const j of completed) {
      const verdicts = j.summary?.metricVerdicts;
      if (verdicts && typeof verdicts === 'object') {
        const vals = Object.values(verdicts);
        totalMetrics += vals.length;
        passedMetrics += vals.filter((v) => v === 'PASS').length;
      }
    }
    if (totalMetrics === 0) {
      // Fallback to overallRating if no metric verdicts
      const passed = completed.filter((j) => j.summary?.overallRating === 'PASS').length;
      const total = completed.length;
      const color = passed === total ? '#16a34a' : '#dc2626';
      return <span style={{ color, fontSize: '13px', fontWeight: 600 }}>{passed}/{total} passed</span>;
    }
    const pct = Math.round((passedMetrics / totalMetrics) * 100);
    const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626';
    return <span style={{ color, fontSize: '13px', fontWeight: 600 }}>{passedMetrics}/{totalMetrics} metrics ({pct}%)</span>;
  };

  return (
    <div className={styles.container}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Eval Suites</h1>
          <p className={styles.subtitle}>Create and manage evaluation suites for your agents.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={handleRefresh} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin 0.6s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button onClick={() => setShowCreate(true)} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + New Suite
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Loading eval suites...</div>
      ) : suites.length === 0 ? (
        <div className={styles.emptyState}>
          No eval suites yet. Click "+ New Suite" to create one, or go to an agent and select "Evals" from the action menu.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name<SortIcon column="name" /></th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('description')}>Description<SortIcon column="description" /></th>
              <th>Results</th>
              <th>Created By</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('created')}>Created<SortIcon column="created" /></th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedSuites.map((suite) => (
              <tr key={suite.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/eval-suites/${suite.id}`)}>
                <td className={styles.demoName} style={{ color: '#6366f1', fontWeight: 600 }}>
                  {suite.name}
                </td>
                <td className={styles.meta} title={suite.description || ''} style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{suite.description || '—'}</td>
                <td className={styles.meta}>{getPassFailLabel(suite.id)}</td>
                <td className={styles.meta}>{suite.userEmail?.split('@')[0] || '—'}</td>
                <td className={styles.meta}>{formatDate(suite.createdAt)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    title="Delete"
                    onClick={(e) => handleDelete(suite.id, e)}
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create Suite Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => { resetCreateForm(); setShowCreate(false); }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '28px', width: '540px', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px' }}>Create Eval Suite</h2>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Booking Agent Baseline" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '12px' }} />

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Description</label>
            <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional description" style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', marginBottom: '16px' }} />

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Source Agent (optional)</label>
            <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: 'white' }}>
              <option value="">— None (from scratch) —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>Selecting an agent links the suite to it for reference. System prompt, tools, and model are configured per eval task.</p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button onClick={() => { resetCreateForm(); setShowCreate(false); }} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: !newName.trim() ? 0.5 : 1 }}
              >
                Create Suite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EvalSuites;
