import { useEffect, useState, useCallback } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import type { HostType, FrameworkType, PipelineType } from '../context/WizardContext';
import { useAuth } from '../context/AuthContext';
import { useFilter } from '../context/FilterContext';
import { listDemos, deleteDemo as deleteDemoApi, createDemo } from '../services/demosApi';
import type { Demo } from '../services/demosApi';
import { notifyAgentListChanged } from '../events/agentEvents';
import styles from './Demos.module.css';

function Demos() {
  const navigate = useNavigate();
  const { dispatch } = useWizard();
  const { isAdmin, user } = useAuth();
  const { showOnlyMine } = useFilter();

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };
  const [demos, setDemos] = useState<Demo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Demo | null>(null);

  const fetchDemos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listDemos();
      setDemos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDemos();
  }, [fetchDemos]);

  const handleEdit = (demo: Demo) => {
    const config = demo.config;
    dispatch({ type: 'SET_HOST', payload: (config.host || 'agentcore') as HostType });
    dispatch({ type: 'SET_FRAMEWORK', payload: (config.framework || 'strands-bidiagent') as FrameworkType });
    dispatch({ type: 'SET_MODEL', payload: config.model || ['nova-2-sonic'] });
    dispatch({ type: 'SET_PIPELINE', payload: (config.pipeline || 'speech-to-speech') as PipelineType });
    dispatch({
      type: 'SET_VOICE',
      payload: config.voice || { voiceId: '', language: 'en-US', gender: 'female' },
    });
    dispatch({
      type: 'SET_AGENTS',
      payload: { selectedAgents: config.tools || [], customTools: config.customTools || [] },
    });
    dispatch({
      type: 'SET_PROMPT',
      payload: config.prompt || {
        greeting: config.greeting || '',
        instructions: config.systemPrompt || '',
      },
    });
    dispatch({ type: 'SET_TELEPHONY_ENABLED', payload: config.telephonyEnabled ?? false });
    dispatch({ type: 'SET_AGENT_START_FIRST', payload: config.agentStartFirst ?? true });
    dispatch({ type: 'SET_PHONE', payload: config.telephony?.phoneNumber || '' });
    navigate('/summary');
  };

  const handleLaunch = (demo: Demo) => {
    handleEdit(demo);
    navigate('/poc', { state: { fromSavedAgent: true, agentName: demo.name } });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDemoApi(deleteTarget.id);
      setDemos((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
      notifyAgentListChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
      setDeleteTarget(null);
    }
  };

  const handleCopy = async (demo: Demo) => {
    try {
      const newName = `${demo.name} (copy)`;
      const created = await createDemo({ name: newName, config: demo.config });
      setDemos((prev) => [created, ...prev]);
      notifyAgentListChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy agent');
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<'name' | 'createdAt' | 'model' | 'owner'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const PAGE_SIZE = 10;

  const handleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  // Filter, sort, and paginate
  const filteredDemos = demos.filter((d) => {
    if (showOnlyMine && user?.email && d.userEmail !== user.email) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return d.name.toLowerCase().includes(q) || (d.config.model?.join(' ') || '').toLowerCase().includes(q);
  });

  const sortedDemos = [...filteredDemos].sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'createdAt':
        cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
        break;
      case 'model':
        cmp = (a.config.model?.join(',') || '').localeCompare(b.config.model?.join(',') || '');
        break;
      case 'owner':
        cmp = (a.userEmail || a.userId || '').localeCompare(b.userEmail || b.userId || '');
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sortedDemos.length / PAGE_SIZE);
  const paginatedDemos = sortedDemos.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when search changes
  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Agents</h1>
          <p className={styles.subtitle}>Manage your saved voice agent configurations.</p>
        </div>
        <button className={styles.createBtn} onClick={() => navigate('/launch')}>
          + Create New Agent
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Search bar + pagination on same row */}
      {!loading && demos.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by name or model..."
            style={{ flex: 1, maxWidth: '720px', padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: 'white' }}
          />
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredDemos.length)} of {filteredDemos.length}</span>
              <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '5px', background: 'white', fontSize: '12px', color: currentPage === 1 ? '#cbd5e1' : '#334155', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>←</button>
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '5px', background: 'white', fontSize: '12px', color: currentPage === totalPages ? '#cbd5e1' : '#334155', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>→</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Loading agents...</div>
      ) : demos.length === 0 ? (
        <div className={styles.emptyState}>
          No agents saved yet. Create one using the wizard and save it from the Summary page.
        </div>
      ) : (
        <>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name {sortColumn === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('createdAt')}>Created {sortColumn === 'createdAt' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('model')}>Model {sortColumn === 'model' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              {isAdmin && <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('owner')}>Owner {sortColumn === 'owner' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedDemos.map((demo) => (
              <tr key={demo.id}>
                <td className={styles.demoName}>
                  <a onClick={() => navigate(`/agents/${demo.id}/summary`)} style={{ color: '#6366f1', cursor: 'pointer', textDecoration: 'none', fontWeight: 600 }}>
                    {demo.name}
                  </a>
                </td>
                <td className={styles.meta}>{formatDate(demo.createdAt)}</td>
                <td className={styles.meta}>
                  {demo.config.model?.join(', ') || '—'}
                </td>
                {isAdmin && (
                  <td className={styles.meta}>
                    {demo.userEmail || demo.userId || '—'}
                  </td>
                )}
                <td>
                  <div className={styles.actions}>
                    <ActionMenu
                      actions={[
                        { icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>', label: 'Try It', onClick: () => handleLaunch(demo) },
                        { icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', label: 'Edit', onClick: () => { handleEdit(demo); navigate('/voice-1s'); } },
                        { icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', label: 'Duplicate', onClick: () => handleCopy(demo) },

                        { icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: 'Delete', onClick: () => setDeleteTarget(demo), danger: true },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredDemos.length === 0 && searchQuery && (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8', fontSize: '14px' }}>
            No agents match "{searchQuery}"
          </div>
        )}
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className={styles.modal} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Delete Agent</h2>
            <p className={styles.modalText}>
              Are you sure you want to delete &ldquo;{deleteTarget.name}&rdquo;? This action cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className={styles.confirmDeleteBtn} onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dropdown action menu triggered by a ⋯ button */
function ActionMenu({ actions }: { actions: Array<{ icon: string; label: string; onClick: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={styles.iconBtn}
        onClick={() => setOpen(!open)}
        aria-label="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: '4px',
          background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, minWidth: '160px',
          padding: '4px 0',
        }}>
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => { action.onClick(); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                padding: '8px 14px', border: 'none', background: 'none',
                fontSize: '13px', color: action.danger ? '#dc2626' : '#334155',
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span dangerouslySetInnerHTML={{ __html: action.icon }} style={{ display: 'flex', opacity: 0.7 }} />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Demos;
