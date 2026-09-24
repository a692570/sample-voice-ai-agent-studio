import { useState, useEffect, useCallback } from 'react';
import { listRuntimes, listTools, createTool, deleteTool, updateTool } from '../../services/toolsApi';
import type { AgentRuntime, SavedTool } from '../../services/toolsApi';
import { useAuth } from '../../context/AuthContext';
import { useFilter } from '../../context/FilterContext';
import ParameterBuilder from '../../components/ParameterBuilder';
import styles from './Tools.module.css';

const REGION = 'us-east-1';

function SubAgents() {
  const { user } = useAuth();
  const { showOnlyMine } = useFilter();
  const [runtimes, setRuntimes] = useState<AgentRuntime[]>([]);
  const [subAgents, setSubAgents] = useState<SavedTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRuntimes, setLoadingRuntimes] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRuntime, setSelectedRuntime] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formParameters, setFormParameters] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<SavedTool | null>(null);

  const fetchSubAgents = useCallback(async () => {
    try {
      setLoading(true);
      const all = await listTools();
      setSubAgents(all.filter((t) => t.type === 'subagent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubAgents();
  }, [fetchSubAgents]);

  useEffect(() => {
    if (showAdd && runtimes.length === 0 && !loadingRuntimes) {
      setLoadingRuntimes(true);
      listRuntimes()
        .then(setRuntimes)
        .catch(() => {})
        .finally(() => setLoadingRuntimes(false));
    }
  }, [showAdd]);

  const handleAdd = async () => {
    if (!selectedRuntime && !formName.trim()) return;
    try {
      const rt = runtimes.find((r) => r.id === selectedRuntime);
      const newAgent = await createTool({
        name: formName.trim() || rt?.name || selectedRuntime,
        type: 'subagent',
        description: formDescription.trim() || rt?.description || '',
        gatewayId: selectedRuntime, // reuse gatewayId field to store runtime ID
        parameters: formParameters.trim(),
      });
      setSubAgents((prev) => [newAgent, ...prev]);
      setShowAdd(false);
      setFormName('');
      setFormDescription('');
      setFormParameters('');
      setSelectedRuntime('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTool(id);
      setSubAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleEdit = (agent: SavedTool) => {
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormDescription(agent.description || '');
    setFormParameters(agent.parameters || '');
    setSelectedRuntime(agent.gatewayId || '');
    setShowAdd(true);
  };

  const handleSaveEdit = async () => {
    if (!editingAgent) return;
    try {
      const updated = await updateTool(editingAgent.id, {
        name: formName.trim(),
        description: formDescription.trim(),
        gatewayId: selectedRuntime || editingAgent.gatewayId,
        parameters: formParameters.trim(),
      });
      setSubAgents((prev) => prev.map((a) => a.id === updated.id ? updated : a));
      setEditingAgent(null);
      setShowAdd(false);
      setFormName('');
      setFormDescription('');
      setFormParameters('');
      setSelectedRuntime('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sub Agents</h1>
          <p className={styles.subtitle}>
            Add AgentCore runtime instances as sub-agents for delegation.
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Sub Agent
        </button>
      </div>

      <div style={{ marginBottom: '16px', padding: '14px 18px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Select existing AgentCore runtimes (non-WebSocket) to use as sub-agents. Create new runtimes in the AWS Console.
        </p>
        <a
          href={`https://${REGION}.console.aws.amazon.com/bedrock/home?region=${REGION}#/agentcore/runtimes`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 500, textDecoration: 'none' }}
        >
          Open AgentCore Runtimes Console →
        </a>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '13px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className={styles.addForm}>
          <h3 className={styles.formTitle}>Add Sub Agent</h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>AgentCore Runtime</label>
              {loadingRuntimes ? (
                <p className={styles.loadingText}>Loading runtimes...</p>
              ) : runtimes.length > 0 ? (
                <select
                  className={styles.input}
                  value={selectedRuntime}
                  onChange={(e) => {
                    setSelectedRuntime(e.target.value);
                    const rt = runtimes.find((r) => r.id === e.target.value);
                    if (rt && !formName) setFormName(rt.name);
                  }}
                >
                  <option value="">Select a runtime...</option>
                  {runtimes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name} ({rt.status})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={styles.input}
                  value={selectedRuntime}
                  onChange={(e) => setSelectedRuntime(e.target.value)}
                  placeholder="Runtime ID"
                />
              )}
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Display name for this sub-agent"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What does this agent handle?"
              />
            </div>
            <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.label}>Parameter Definitions</label>
              <ParameterBuilder value={formParameters} onChange={setFormParameters} showLocation={false} />
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={() => { setShowAdd(false); setEditingAgent(null); setSelectedRuntime(''); setFormName(''); setFormDescription(''); setFormParameters(''); }}>
              Cancel
            </button>
            <button
              className={styles.submitBtn}
              onClick={editingAgent ? handleSaveEdit : handleAdd}
              disabled={!selectedRuntime && !formName.trim()}
            >
              {editingAgent ? 'Save Changes' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className={styles.emptyState}><p>Loading...</p></div>
      ) : subAgents.length === 0 ? (
        <div className={styles.emptyState}><p>No sub-agents added yet.</p></div>
      ) : (
        <div className={styles.toolList}>
          {subAgents.filter((a) => !showOnlyMine || !user?.email || !a.userEmail || a.userEmail === user.email).map((agent) => (
            <div key={agent.id} className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName}>{agent.name}</h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className={styles.deleteBtn} style={{ color: '#475569', borderColor: '#e2e8f0' }} onClick={() => handleEdit(agent)}>Edit</button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(agent.id)}>Delete</button>
                </div>
              </div>
              {agent.description && <p className={styles.toolDesc}>{agent.description}</p>}
              <div className={styles.toolMeta}>
                <span className={styles.metaValue}>Runtime: {agent.gatewayId}</span>
              </div>
              {agent.parameters && (
                <div style={{ marginTop: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Parameters</span>
                  <pre style={{ fontSize: '11px', color: '#475569', background: '#f8fafc', padding: '8px', borderRadius: '4px', border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap', marginTop: '3px', maxHeight: '100px', overflow: 'auto' }}>{agent.parameters}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SubAgents;
