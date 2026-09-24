import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listRAGSources,
  createRAGSource,
  deleteRAGSource,
  getUploadUrl,
  uploadDocument,
  syncRAGSource,
  queryRAGSource,
  listRAGFiles,
  getRAGConfig,
  setRAGConfig,
  listAccountKnowledgeBases,
} from '../../services/ragApi';
import type { RAGSource, CreateRAGSourceInput, RAGQueryResult, RAGFile, AccountKnowledgeBase } from '../../services/ragApi';
import { useAuth } from '../../context/AuthContext';
import { useFilter } from '../../context/FilterContext';
import styles from './RAG.module.css';

function RAG() {
  const { user } = useAuth();
  const { showOnlyMine } = useFilter();
  const [kbs, setKbs] = useState<RAGSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RAGSource | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<RAGQueryResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  // Which citations are expanded (by index). Collapsed by default.
  const [expandedCitations, setExpandedCitations] = useState<Record<number, boolean>>({});
  const [filesMap, setFilesMap] = useState<Record<string, RAGFile[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadKbId, setActiveUploadKbId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // KB configuration (the Bedrock Knowledge Base id, set from the UI).
  // null = not loaded yet, '' = not configured.
  const [kbId, setKbId] = useState<string | null>(null);
  const [kbIdInput, setKbIdInput] = useState('');
  const [savingKbId, setSavingKbId] = useState(false);
  const [editingKbId, setEditingKbId] = useState(false);
  // Bedrock KBs that exist in the account, for selection.
  const [accountKbs, setAccountKbs] = useState<AccountKnowledgeBase[]>([]);
  const [loadingAccountKbs, setLoadingAccountKbs] = useState(false);

  const fetchKbs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listRAGSources();
      setKbs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge bases');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const cfg = await getRAGConfig();
      setKbId(cfg.kbId || '');
      setKbIdInput(cfg.kbId || '');
    } catch {
      setKbId('');
    }
  }, []);

  const fetchAccountKbs = useCallback(async () => {
    setLoadingAccountKbs(true);
    try {
      const list = await listAccountKnowledgeBases();
      setAccountKbs(list);
    } catch {
      setAccountKbs([]);
    } finally {
      setLoadingAccountKbs(false);
    }
  }, []);

  const handleSaveKbId = async () => {
    setSavingKbId(true);
    setError(null);
    try {
      const cfg = await setRAGConfig(kbIdInput.trim());
      setKbId(cfg.kbId || '');
      setEditingKbId(false);
      // Reload sources now that the KB is (re)configured.
      if (cfg.kbId) await fetchKbs();
      else setKbs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Knowledge Base ID');
    } finally {
      setSavingKbId(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchAccountKbs();
  }, [fetchConfig, fetchAccountKbs]);

  useEffect(() => {
    // Only load data sources once a KB is configured.
    if (kbId) fetchKbs();
    else if (kbId === '') setLoading(false);
  }, [kbId, fetchKbs]);

  const handleCreate = async () => {
    if (!formName.trim()) return;
    if (!kbId) {
      setError('Set a Knowledge Base ID before adding data sources.');
      return;
    }
    setCreating(true);
    try {
      const input: CreateRAGSourceInput = {
        name: formName.trim(),
        description: formDescription.trim(),
      };
      const newKb = await createRAGSource(input);
      setKbs((prev) => [newKb, ...prev]);
      setShowCreate(false);
      setFormName('');
      setFormDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create knowledge base');
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (kbId: string, files: FileList) => {
    setUploadingId(kbId);
    try {
      for (const file of Array.from(files)) {
        const { uploadUrl } = await getUploadUrl(kbId, file.name, file.type);
        await uploadDocument(uploadUrl, file);
      }
      // Update status
      setKbs((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, status: 'SYNCING' } : kb))
      );
      setUploadingId(null);
      // Auto-sync
      await handleSync(kbId);
      // Refresh file list if expanded
      if (expandedId === kbId) {
        const updatedFiles = await listRAGFiles(kbId);
        setFilesMap((prev) => ({ ...prev, [kbId]: updatedFiles }));
      }
      await fetchKbs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadingId(null);
    }
  };

  const handleSync = async (kbId: string) => {
    setSyncingId(kbId);
    try {
      await syncRAGSource(kbId);
      setKbs((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, status: 'SYNCING' } : kb))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRAGSource(deleteTarget.id);
      setKbs((prev) => prev.filter((kb) => kb.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleteTarget(null);
    }
  };

  const handleExpand = async (kbId: string) => {
    if (expandedId === kbId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(kbId);
    try {
      const files = await listRAGFiles(kbId);
      setFilesMap((prev) => ({ ...prev, [kbId]: files }));
    } catch {
      // silently fail
    }
  };

  const handleTest = async (kbId: string) => {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    setExpandedCitations({});
    try {
      const result = await queryRAGSource(kbId, testQuery.trim());
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setTestLoading(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch { return ''; }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Knowledge Base</h1>
          <p className={styles.subtitle}>
            Create and manage knowledge bases for your voice agents.
          </p>
        </div>
        {kbId ? (
          <>
            <button className={styles.createBtn} onClick={() => setShowCreate(true)}>
              + New Data Source
            </button>
            <button className={styles.refreshBtn} onClick={fetchKbs} disabled={loading}>
              ↻
            </button>
          </>
        ) : null}
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button className={styles.dismissBtn} onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Intro / setup when no KB is configured */}
      {kbId === '' && !editingKbId && (
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#3730a3', marginBottom: '8px' }}>Connect a Bedrock Knowledge Base</h3>
          <p style={{ fontSize: '13px', color: '#4338ca', lineHeight: 1.7, marginBottom: '14px' }}>
            RAG uses an Amazon Bedrock Knowledge Base, which is <strong>not created by this solution</strong>.
            Create one in your AWS account (Bedrock console → Knowledge Bases), then paste its Knowledge Base ID
            below. Once set, you can add data sources, upload documents, and test retrieval here. The KB ID is
            not a secret — it's stored so the app can manage data sources against your KB.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {loadingAccountKbs ? (
              <span style={{ fontSize: '13px', color: '#4338ca' }}>Loading Knowledge Bases…</span>
            ) : accountKbs.length > 0 ? (
              <select
                value={kbIdInput}
                onChange={(e) => setKbIdInput(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '13px', background: '#fff', minWidth: '320px' }}
              >
                <option value="">— Select a Knowledge Base —</option>
                {accountKbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.id}){kb.status && kb.status !== 'ACTIVE' ? ` — ${kb.status}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              // Fallback: no KBs found (or listing not permitted) — allow manual entry.
              <input
                value={kbIdInput}
                onChange={(e) => setKbIdInput(e.target.value)}
                placeholder="Knowledge Base ID (e.g. ABCDE12345)"
                style={{ padding: '8px 12px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace', width: '260px' }}
              />
            )}
            <button
              className={styles.submitBtn}
              onClick={handleSaveKbId}
              disabled={!kbIdInput.trim() || savingKbId}
            >
              {savingKbId ? 'Saving…' : 'Save'}
            </button>
            <button className={styles.cancelBtn} onClick={fetchAccountKbs} disabled={loadingAccountKbs}>
              Refresh list
            </button>
            <a
              href="https://console.aws.amazon.com/bedrock/home#/knowledge-bases"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '13px', color: '#6366f1', fontWeight: 500 }}
            >
              Open Bedrock console →
            </a>
          </div>
        </div>
      )}

      {/* Configured KB bar (with change/edit) */}
      {kbId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Knowledge Base ID:</span>
          {editingKbId ? (
            <>
              {accountKbs.length > 0 ? (
                <select
                  value={kbIdInput}
                  onChange={(e) => setKbIdInput(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', background: '#fff', minWidth: '300px' }}
                >
                  <option value="">— Select a Knowledge Base —</option>
                  {accountKbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>{kb.name} ({kb.id})</option>
                  ))}
                </select>
              ) : (
                <input
                  value={kbIdInput}
                  onChange={(e) => setKbIdInput(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace', width: '220px' }}
                />
              )}
              <button className={styles.submitBtn} onClick={handleSaveKbId} disabled={savingKbId}>
                {savingKbId ? 'Saving…' : 'Save'}
              </button>
              <button className={styles.cancelBtn} onClick={() => { setEditingKbId(false); setKbIdInput(kbId); }}>Cancel</button>
            </>
          ) : (
            <>
              <code style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{kbId}</code>
              <button
                onClick={() => { setEditingKbId(true); setKbIdInput(kbId); }}
                style={{ marginLeft: 'auto', fontSize: '12px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                Change
              </button>
            </>
          )}
        </div>
      )}

      {kbId ? (
      <>
      <div className={styles.infoBanner}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Platform</span>
          <span className={styles.infoValue}>AgentCore MKB</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Embedding</span>
          <span className={styles.infoValue}>Nova MME</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Generation</span>
          <span className={styles.infoValue}>Nova 2 Lite — inference for responses</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Storage</span>
          <span className={styles.infoValue}>AgentCore MKB managed storage</span>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className={styles.createForm}>
          <h3 className={styles.formTitle}>Create Data Source</h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Name *</label>
              <input
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Product Documentation"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What content will this KB contain?"
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button
              className={styles.cancelBtn}
              onClick={() => { setShowCreate(false); setFormName(''); setFormDescription(''); }}
            >
              Cancel
            </button>
            <button
              className={styles.submitBtn}
              onClick={handleCreate}
              disabled={!formName.trim() || creating}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* KB List */}
      {loading ? (
        <div className={styles.loading}>Loading data sources...</div>
      ) : kbs.length === 0 && !showCreate ? (
        <div className={styles.emptyState}>
          <p>No data sources yet. Create one to start uploading documents.</p>
        </div>
      ) : (
        <div className={styles.sourcesList}>
          {kbs.filter((kb) => !showOnlyMine || !user?.email || !kb.userEmail || kb.userEmail === user.email).map((kb) => (
            <div key={kb.id} className={styles.sourceCard}>
              <div className={styles.sourceHeader} onClick={() => handleExpand(kb.id)}>
                <div>
                  <h3 className={styles.sourceName}>{kb.name}</h3>
                  {kb.description && <p className={styles.sourceDesc}>{kb.description}</p>}
                </div>
                <span className={`${styles.statusBadge} ${
                  kb.status === 'ACTIVE' ? styles.statusReady :
                  kb.status === 'CREATING' ? styles.statusPending : ''
                }`}>
                  {kb.status}
                </span>
              </div>

              <div className={styles.sourceMeta}>
                {kb.documentCount !== undefined && (
                  <span className={styles.metaItem}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>{kb.documentCount} docs</span>
                )}
                {(kb as any).lastSyncStatus && (
                  <span className={styles.metaItem}>
                    Sync: {(kb as any).lastSyncStatus}
                  </span>
                )}
                {(kb as any).lastSync && (
                  <span className={styles.metaItem}>
                    Last sync: {formatDate((kb as any).lastSync)}
                  </span>
                )}
                <span className={styles.metaItem}>ID: {kb.id}</span>
              </div>

              <div className={styles.sourceActions}>
                <input
                  type="file"
                  ref={activeUploadKbId === kb.id ? fileInputRef : undefined}
                  className={styles.hiddenInput}
                  multiple
                  accept=".pdf,.txt,.html,.md,.doc,.docx,.csv"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleUpload(kb.id, e.target.files);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    setActiveUploadKbId(kb.id);
                    setTimeout(() => fileInputRef.current?.click(), 0);
                  }}
                  disabled={uploadingId === kb.id || kb.status === 'CREATING'}
                >
                  {uploadingId === kb.id ? 'Uploading...' : 'Upload Files'}
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleSync(kb.id)}
                  disabled={syncingId === kb.id}
                >
                  {syncingId === kb.id ? 'Syncing...' : 'Sync'}
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    setTestingId(testingId === kb.id ? null : kb.id);
                    setTestResult(null);
                    setTestQuery('');
                  }}
                >
                  {testingId === kb.id ? 'Close' : 'Test'}
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => setDeleteTarget(kb)}
                >
                  Delete
                </button>
              </div>

              {/* Expanded: Files */}
              {expandedId === kb.id && (
                <div className={styles.filesList}>
                  {!filesMap[kb.id] || filesMap[kb.id].length === 0 ? (
                    <p className={styles.noFiles}>No files uploaded yet.</p>
                  ) : (
                    filesMap[kb.id].map((file) => (
                      <div key={file.key} className={styles.fileItem}>
                        <span className={styles.fileName}>{file.filename}</span>
                        <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                        <a
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.downloadBtn}
                        >
                          Download
                        </a>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Test Panel */}
              {testingId === kb.id && (
                <div className={styles.testPanel}>
                  <div className={styles.testInputRow}>
                    <input
                      className={styles.testInput}
                      value={testQuery}
                      onChange={(e) => setTestQuery(e.target.value)}
                      placeholder="Ask a question..."
                      onKeyDown={(e) => { if (e.key === 'Enter') handleTest(kb.id); }}
                      disabled={testLoading}
                    />
                    <button
                      className={styles.testBtn}
                      onClick={() => handleTest(kb.id)}
                      disabled={!testQuery.trim() || testLoading}
                    >
                      {testLoading ? '...' : 'Ask'}
                    </button>
                  </div>
                  {testResult && (
                    <div className={styles.testResult}>
                      <p className={styles.testAnswer}>{testResult.answer}</p>
                      {testResult.citations.length > 0 && (
                        <div className={styles.testCitations}>
                          <span className={styles.citationsLabel}>Sources ({testResult.citations.length})</span>
                          {testResult.citations.map((c, i) => {
                            const open = !!expandedCitations[i];
                            return (
                              <div key={i} className={styles.citationItem}>
                                <button
                                  type="button"
                                  className={styles.citationSource}
                                  onClick={() => setExpandedCitations((prev) => ({ ...prev, [i]: !prev[i] }))}
                                  aria-expanded={open}
                                >
                                  <span className={styles.citationIndex}>{i + 1}</span>
                                  <span className={styles.citationName}>{c.source || c.location || 'Knowledge Base'}</span>
                                  {typeof c.score === 'number' && (
                                    <span className={styles.citationScore}>score {c.score.toFixed(2)}</span>
                                  )}
                                  <span className={styles.citationChevron}>{open ? '▾' : '▸'}</span>
                                </button>
                                {open && <p className={styles.citationText}>{c.text}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      </>
      ) : null}

      {/* Delete Modal */}
      {deleteTarget && (
        <div className={styles.modal} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Delete Data Source</h2>
            <p className={styles.modalText}>
              Are you sure you want to delete &ldquo;{deleteTarget.name}&rdquo;?
              This will remove the data source and all its documents.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className={styles.confirmDeleteBtn} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RAG;
