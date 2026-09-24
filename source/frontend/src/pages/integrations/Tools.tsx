import { useState, useEffect, useCallback } from 'react';
import { listLambdaFunctions, listGateways, listTools, createTool, deleteTool, updateTool, testTool, getGatewayDetail, mcpCallToolViaBackend } from '../../services/toolsApi';
import type { LambdaFunction, Gateway, SavedTool, TestResult, GatewayDetail } from '../../services/toolsApi';
import type { McpTool } from '../../services/mcpApi';
import { useAuth } from '../../context/AuthContext';
import { useFilter } from '../../context/FilterContext';
import ParameterBuilder from '../../components/ParameterBuilder';
import styles from './Tools.module.css';

type TabType = 'webhook' | 'lambda' | 'mcp';

const REGION = 'us-east-1';

function Tools() {
  const { user, refreshToken } = useAuth();
  const { showOnlyMine } = useFilter();
  const [activeTab, setActiveTab] = useState<TabType>('webhook');
  const [tools, setTools] = useState<SavedTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [lambdas, setLambdas] = useState<LambdaFunction[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loadingLambdas, setLoadingLambdas] = useState(false);
  const [loadingGateways, setLoadingGateways] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testParamsId, setTestParamsId] = useState<string | null>(null);
  const [testParamValues, setTestParamValues] = useState<Record<string, string>>({});
  // MCP test state
  const [mcpTestId, setMcpTestId] = useState<string | null>(null);
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [mcpLoadingTools, setMcpLoadingTools] = useState(false);
  const [mcpSelectedTool, setMcpSelectedTool] = useState<string>('');
  const [mcpArgs, setMcpArgs] = useState<string>('{}');
  const [mcpResult, setMcpResult] = useState<any>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [editingTool, setEditingTool] = useState<SavedTool | null>(null);
  const [gatewayDetail, setGatewayDetail] = useState<GatewayDetail | null>(null);
  const [loadingGatewayDetail, setLoadingGatewayDetail] = useState(false);
  const [gatewayDetails, setGatewayDetails] = useState<Record<string, GatewayDetail>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEndpoint, setFormEndpoint] = useState('');
  const [formMethod, setFormMethod] = useState('POST');
  const [formTimeout, setFormTimeout] = useState('30');
  const [formHeaders, setFormHeaders] = useState('');
  const [formMockResponse, setFormMockResponse] = useState('');
  const [formArn, setFormArn] = useState('');
  const [formGatewayId, setFormGatewayId] = useState('');
  const [formParameters, setFormParameters] = useState('');

  // Load resources when switching tabs or opening add form
  useEffect(() => {
    if (activeTab === 'lambda' && lambdas.length === 0 && !loadingLambdas) {
      setLoadingLambdas(true);
      listLambdaFunctions()
        .then((fns) => setLambdas(fns.sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => {})
        .finally(() => setLoadingLambdas(false));
    }
    if (activeTab === 'mcp' && gateways.length === 0 && !loadingGateways) {
      setLoadingGateways(true);
      listGateways()
        .then(setGateways)
        .catch(() => {})
        .finally(() => setLoadingGateways(false));
    }
  }, [activeTab]);

  const fetchTools = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listTools();
      setTools(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  // Fetch gateway details for all MCP tools when tab is active and tools are loaded
  useEffect(() => {
    if (activeTab !== 'mcp') return;
    const mcpTools = tools.filter((t) => t.type === 'mcp' && t.gatewayId);
    const missingIds = mcpTools.filter((t) => t.gatewayId && !gatewayDetails[t.gatewayId]).map((t) => t.gatewayId!);
    if (missingIds.length === 0) return;
    missingIds.forEach((gwId) => {
      getGatewayDetail(gwId)
        .then((detail) => setGatewayDetails((prev) => ({ ...prev, [gwId]: detail })))
        .catch(() => {});
    });
  }, [activeTab, tools]);

  const handleAdd = async () => {
    if (!formName.trim()) return;
    try {
      const newTool = await createTool({
        name: formName.trim(),
        type: activeTab,
        description: formDescription.trim(),
        endpoint: activeTab === 'webhook' ? formEndpoint.trim() : undefined,
        method: activeTab === 'webhook' ? formMethod : undefined,
        timeout: activeTab === 'webhook' ? formTimeout : undefined,
        headers: activeTab === 'webhook' ? formHeaders.trim() : undefined,
        mockResponse: formMockResponse.trim(),
        functionArn: activeTab === 'lambda' ? formArn.trim() : undefined,
        gatewayId: activeTab === 'mcp' ? formGatewayId.trim() : undefined,
        parameters: (activeTab === 'webhook' || activeTab === 'lambda') ? formParameters.trim() : undefined,
      });
      setTools((prev) => [newTool, ...prev]);
      resetForm();
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tool');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTool(id);
      setTools((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleEdit = (tool: SavedTool) => {
    setEditingTool(tool);
    setFormName(tool.name);
    setFormDescription(tool.description || '');
    setFormEndpoint(tool.endpoint || '');
    setFormMethod(tool.method || 'POST');
    setFormTimeout(tool.timeout || '30');
    setFormHeaders(tool.headers || '');
    setFormMockResponse(tool.mockResponse || '');
    setFormArn(tool.functionArn || '');
    setFormGatewayId(tool.gatewayId || '');
    setFormParameters(tool.parameters || '');
    setActiveTab(tool.type as TabType);
    setShowAdd(true);
    // Scroll to the edit form at top
    setTimeout(() => {
      document.querySelector('[class*="addForm"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleSaveEdit = async () => {
    if (!editingTool || !formName.trim()) return;
    try {
      const updated = await updateTool(editingTool.id, {
        name: formName.trim(),
        description: formDescription.trim(),
        endpoint: formEndpoint.trim(),
        method: formMethod,
        timeout: formTimeout,
        headers: formHeaders.trim(),
        mockResponse: formMockResponse.trim(),
        functionArn: formArn.trim(),
        gatewayId: formGatewayId.trim(),
        parameters: formParameters.trim(),
      });
      setTools((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingTool(null);
      resetForm();
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormEndpoint('');
    setFormMethod('POST');
    setFormTimeout('30');
    setFormHeaders('');
    setFormMockResponse('');
    setFormArn('');
    setFormGatewayId('');
    setFormParameters('');
  };

  const filteredTools = tools.filter((t) => {
    if (t.type !== activeTab) return false;
    if (showOnlyMine && user?.email) {
      // For admin users seeing all tools, filter by userEmail if available
      if (t.userEmail) return t.userEmail === user.email;
      // If no userEmail on item, keep it (backend already scopes for non-admins)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesName = t.name.toLowerCase().includes(q);
      const matchesDesc = (t.description || '').toLowerCase().includes(q);
      if (!matchesName && !matchesDesc) return false;
    }
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredTools.length / PAGE_SIZE);
  const paginatedTools = filteredTools.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when search or tab changes
  useEffect(() => { setCurrentPage(1); }, [searchQuery, activeTab]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Tools</h1>
          <p className={styles.subtitle}>
            Add tools your voice agent can invoke during conversations.
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Tool
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'webhook' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('webhook')}
        >
          Webhook (API)
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'lambda' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('lambda')}
        >
          Lambda
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'mcp' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('mcp')}
        >
          MCP (AgentCore Gateway)
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className={styles.addForm}>
          <h3 className={styles.formTitle}>
            {editingTool ? 'Edit' : 'Add'} {activeTab === 'webhook' ? 'Webhook' : activeTab === 'lambda' ? 'Lambda' : 'MCP'} Tool
          </h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Name *</label>
              <input
                className={styles.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. check-order-status"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Description</label>
              <input
                className={styles.input}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What does this tool do?"
              />
            </div>
            {activeTab === 'webhook' && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>HTTP Method</label>
                  <select
                    className={styles.input}
                    value={formMethod}
                    onChange={(e) => setFormMethod(e.target.value)}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Endpoint URL *</label>
                  <input
                    className={styles.input}
                    value={formEndpoint}
                    onChange={(e) => setFormEndpoint(e.target.value)}
                    placeholder="https://api.example.com/check-order"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Timeout (seconds)</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={formTimeout}
                    onChange={(e) => setFormTimeout(e.target.value)}
                    placeholder="30"
                    min="1"
                    max="300"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Headers (JSON, optional)</label>
                  <input
                    className={styles.input}
                    value={formHeaders}
                    onChange={(e) => setFormHeaders(e.target.value)}
                    placeholder='{"Authorization": "Bearer ...", "Content-Type": "application/json"}'
                  />
                </div>
              </>
            )}
            {activeTab === 'lambda' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Lambda Function *</label>
                {loadingLambdas ? (
                  <p className={styles.loadingText}>Loading functions...</p>
                ) : (
                  <select
                    className={styles.input}
                    value={formArn}
                    onChange={(e) => {
                      setFormArn(e.target.value);
                      if (!formName) {
                        const fn = lambdas.find((l) => l.arn === e.target.value);
                        if (fn) setFormName(fn.name);
                      }
                    }}
                  >
                    <option value="">Select a function...</option>
                    {lambdas.map((fn) => (
                      <option key={fn.arn} value={fn.arn}>
                        {fn.name} ({fn.runtime})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {(activeTab === 'webhook' || activeTab === 'lambda') && (
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                <label className={styles.label}>Parameter Definitions</label>
                <ParameterBuilder value={formParameters} onChange={setFormParameters} showLocation={activeTab === 'webhook'} />
              </div>
            )}
            {activeTab === 'mcp' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>AgentCore Gateway *</label>
                {loadingGateways ? (
                  <p className={styles.loadingText}>Loading gateways...</p>
                ) : gateways.length > 0 ? (
                  <select
                    className={styles.input}
                    value={formGatewayId}
                    onChange={(e) => {
                      setFormGatewayId(e.target.value);
                      if (!formName) {
                        const gw = gateways.find((g) => g.id === e.target.value);
                        if (gw) setFormName(gw.name);
                      }
                      // Fetch gateway detail for inline schema
                      if (e.target.value) {
                        setLoadingGatewayDetail(true);
                        setGatewayDetail(null);
                        getGatewayDetail(e.target.value)
                          .then((detail) => {
                            setGatewayDetail(detail);
                            if (!formDescription && detail.instructions) {
                              setFormDescription(detail.instructions);
                            }
                          })
                          .catch(() => setGatewayDetail(null))
                          .finally(() => setLoadingGatewayDetail(false));
                      } else {
                        setGatewayDetail(null);
                      }
                    }}
                  >
                    <option value="">Select a gateway...</option>
                    {gateways.map((gw) => (
                      <option key={gw.id} value={gw.id}>
                        {gw.name} ({gw.status})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.input}
                    value={formGatewayId}
                    onChange={(e) => setFormGatewayId(e.target.value)}
                    placeholder="Gateway ID or MCP server URL"
                  />
                )}
              </div>
            )}
          </div>
          {/* Gateway Detail / Inline Schema */}
          {activeTab === 'mcp' && formGatewayId && (
            <div style={{ marginTop: '12px', padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              {loadingGatewayDetail ? (
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>Loading gateway details...</p>
              ) : gatewayDetail ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#64748b' }}>
                    <span><strong>Protocol:</strong> {gatewayDetail.protocolType}</span>
                    <span><strong>Status:</strong> {gatewayDetail.status}</span>
                    <span><strong>Auth:</strong> {gatewayDetail.authorizerType || 'NONE'}</span>
                    {gatewayDetail.searchType && <span><strong>Search:</strong> {gatewayDetail.searchType}</span>}
                    {gatewayDetail.supportedVersions?.length > 0 && <span><strong>MCP Versions:</strong> {gatewayDetail.supportedVersions.join(', ')}</span>}
                  </div>
                  {gatewayDetail.gatewayUrl && (
                    <div style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      <strong>URL:</strong> {gatewayDetail.gatewayUrl}
                    </div>
                  )}
                  {gatewayDetail.description && (
                    <div style={{ fontSize: '12px', color: '#475569' }}>
                      <strong>Description:</strong> {gatewayDetail.description}
                    </div>
                  )}
                  {gatewayDetail.instructions && (
                    <div>
                      <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Gateway Instructions (from MCP config)</label>
                      <pre style={{ fontSize: '12px', color: '#334155', background: 'white', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '6px', whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: '200px', overflow: 'auto' }}>{gatewayDetail.instructions}</pre>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: '12px', color: '#94a3b8' }}>Select a gateway to see its configuration.</p>
              )}
            </div>
          )}
          {/* Mock Response — available for all tool types */}
          <div style={{ marginTop: '12px' }}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Mock Response (for testing)</label>
              <textarea
                className={styles.textarea}
                value={formMockResponse}
                onChange={(e) => setFormMockResponse(e.target.value)}
                placeholder='When mock mode is enabled, the tool returns this response instead of calling the real endpoint. Example: {"balance": "$1,234.56", "status": "active"}'
                rows={3}
              />
              <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>If set, agents can use this tool in test mode without a real integration.</p>
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={() => { setShowAdd(false); setEditingTool(null); resetForm(); setGatewayDetail(null); }}>
              Cancel
            </button>
            <button
              className={styles.submitBtn}
              onClick={editingTool ? handleSaveEdit : handleAdd}
              disabled={!formName.trim()}
            >
              {editingTool ? 'Save Changes' : 'Add Tool'}
            </button>
          </div>
        </div>
      )}

      {/* Tool List */}
      {activeTab === 'mcp' ? (
        <div>
          <div style={{ marginBottom: '16px', padding: '14px 18px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Select an AgentCore Gateway to add as a tool. Create and manage gateways in the AWS Console.
            </p>
            <a
              href={`https://${REGION}.console.aws.amazon.com/bedrock/home?region=${REGION}#/agentcore/gateways`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 500, textDecoration: 'none' }}
            >
              Open AgentCore Gateway Console →
            </a>
          </div>
          {filteredTools.length === 0 ? (
            <div className={styles.emptyState}><p>No MCP gateways added yet. Use "+ Add Tool" to select one.</p></div>
          ) : (
            <div className={styles.toolList}>
              {filteredTools.map((tool) => (
                <div key={tool.id} className={styles.toolCard}>
                  <div className={styles.toolHeader}>
                    <h3 className={styles.toolName} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8h12z"/></svg>
                      {tool.name}
                    </h3>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className={styles.deleteBtn}
                        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                        onClick={() => handleEdit(tool)}
                      >
                        Edit
                      </button>
                      <button
                        className={styles.deleteBtn}
                        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                        onClick={async () => {
                          if (mcpTestId === tool.id) {
                            setMcpTestId(null);
                            setMcpTools([]);
                            setMcpResult(null);
                            setMcpError(null);
                            return;
                          }
                          setMcpTestId(tool.id);
                          setMcpResult(null);
                          setMcpError(null);
                          setMcpSelectedTool('');
                          setMcpArgs('{}');
                          // Use tools from backend gateway detail (already fetched)
                          const detail = gatewayDetails[tool.gatewayId!];
                          if (detail?.mcpTools && detail.mcpTools.length > 0) {
                            setMcpTools(detail.mcpTools);
                          } else {
                            setMcpError('No MCP tools discovered. Check gateway targets.');
                          }
                        }}
                      >
                        {mcpTestId === tool.id ? 'Close' : 'Test'}
                      </button>
                      <button className={styles.deleteBtn} onClick={() => handleDelete(tool.id)}>Delete</button>
                    </div>
                  </div>
                  {tool.description && <p className={styles.toolDesc}>{tool.description}</p>}
                  <div className={styles.toolMeta}>
                    {tool.gatewayId && <span className={styles.metaValue}>{tool.gatewayId}</span>}
                  </div>
                  {/* MCP Test Panel */}
                  {mcpTestId === tool.id && (
                    <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>MCP Test</div>
                      {mcpLoadingTools && <p style={{ fontSize: '12px', color: '#94a3b8' }}>Loading tools...</p>}
                      {mcpError && <p style={{ fontSize: '12px', color: '#dc2626' }}>{mcpError}</p>}
                      {mcpTools.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '3px' }}>Tool</label>
                            <select
                              value={mcpSelectedTool}
                              onChange={(e) => {
                                setMcpSelectedTool(e.target.value);
                                setMcpResult(null);
                                // Pre-populate args from schema
                                const t = mcpTools.find((mt) => mt.name === e.target.value);
                                if (t?.inputSchema?.properties) {
                                  const sample: Record<string, string> = {};
                                  Object.entries(t.inputSchema.properties).forEach(([k, v]: [string, any]) => {
                                    sample[k] = v.type === 'number' ? '0' : '';
                                  });
                                  setMcpArgs(JSON.stringify(sample, null, 2));
                                } else {
                                  setMcpArgs('{}');
                                }
                              }}
                              style={{ width: '100%', fontSize: '12px', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                            >
                              <option value="">Select a tool...</option>
                              {mcpTools.map((mt) => (
                                <option key={mt.name} value={mt.name}>{mt.name} — {mt.description?.slice(0, 60)}</option>
                              ))}
                            </select>
                          </div>
                          {mcpSelectedTool && (
                            <>
                              {(() => {
                                const t = mcpTools.find((mt) => mt.name === mcpSelectedTool);
                                if (t?.inputSchema) return (
                                  <div>
                                    <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Input Schema</label>
                                    <pre style={{ fontSize: '10px', color: '#475569', background: 'white', padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px', whiteSpace: 'pre-wrap', margin: 0, maxHeight: '80px', overflow: 'auto' }}>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                                  </div>
                                );
                                return null;
                              })()}
                              <div>
                                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '3px' }}>Arguments (JSON)</label>
                                <textarea
                                  value={mcpArgs}
                                  onChange={(e) => setMcpArgs(e.target.value)}
                                  rows={3}
                                  style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', resize: 'vertical' }}
                                />
                              </div>
                              <button
                                onClick={async () => {
                                  setMcpTesting(true);
                                  setMcpResult(null);
                                  setMcpError(null);
                                  try {
                                    const args = JSON.parse(mcpArgs);
                                    const result = await mcpCallToolViaBackend(tool.gatewayId!, mcpSelectedTool, args);
                                    setMcpResult(result);
                                  } catch (err: any) {
                                    setMcpError(err.message || 'Call failed');
                                  } finally {
                                    setMcpTesting(false);
                                  }
                                }}
                                disabled={mcpTesting}
                                style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#6366f1', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                              >
                                {mcpTesting ? 'Calling...' : 'Call Tool'}
                              </button>
                            </>
                          )}
                          {mcpResult && (
                            <div style={{ marginTop: '6px', padding: '8px', background: mcpResult.isError ? '#fef2f2' : '#eef2ff', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: mcpResult.isError ? '#dc2626' : '#6366f1', textTransform: 'uppercase', marginBottom: '4px' }}>
                                {mcpResult.isError ? 'Error' : 'Success'}
                              </div>
                              <pre style={{ fontSize: '11px', color: '#334155', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: '150px', overflow: 'auto' }}>
                                {JSON.stringify(mcpResult.content, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Inline schema from gateway */}
                  {tool.gatewayId && gatewayDetails[tool.gatewayId] && (
                    <div style={{ marginTop: '10px' }}>
                      <button
                        onClick={() => setExpandedCards((prev) => ({ ...prev, [tool.id]: !prev[tool.id] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: '12px', color: '#64748b', fontWeight: 500 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedCards[tool.id] ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6"/></svg>
                        Gateway Details & Tools ({gatewayDetails[tool.gatewayId].mcpTools?.length || 0})
                      </button>
                      {expandedCards[tool.id] && (
                    <div style={{ marginTop: '6px', padding: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                        <span><strong>Protocol:</strong> {gatewayDetails[tool.gatewayId].protocolType}</span>
                        <span><strong>Status:</strong> {gatewayDetails[tool.gatewayId].status}</span>
                        <span><strong>Auth:</strong> {gatewayDetails[tool.gatewayId].authorizerType || 'NONE'}</span>
                        {gatewayDetails[tool.gatewayId].searchType && <span><strong>Search:</strong> {gatewayDetails[tool.gatewayId].searchType}</span>}
                        {gatewayDetails[tool.gatewayId].supportedVersions?.length > 0 && <span><strong>MCP:</strong> {gatewayDetails[tool.gatewayId].supportedVersions.join(', ')}</span>}
                      </div>
                      {gatewayDetails[tool.gatewayId].gatewayUrl && (
                        <div style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: '4px' }}>{gatewayDetails[tool.gatewayId].gatewayUrl}</div>
                      )}
                      {gatewayDetails[tool.gatewayId].instructions && (
                        <div style={{ marginTop: '6px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Instructions</span>
                          <pre style={{ fontSize: '11px', color: '#334155', background: 'white', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: '150px', overflow: 'auto', marginTop: '3px' }}>{gatewayDetails[tool.gatewayId].instructions}</pre>
                        </div>
                      )}
                      {gatewayDetails[tool.gatewayId].targets && gatewayDetails[tool.gatewayId].targets!.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Targets ({gatewayDetails[tool.gatewayId].targets!.length})</span>
                          <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {gatewayDetails[tool.gatewayId].targets!.map((t) => (
                              <div key={t.targetId} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>{t.name}</span>
                                <span style={{ fontSize: '9px', padding: '1px 4px', background: '#f1f5f9', borderRadius: '3px', color: '#64748b' }}>{t.targetType}</span>
                                <span style={{ fontSize: '9px', color: t.status === 'READY' ? '#10b981' : '#f59e0b' }}>{t.status}</span>
                                {t.description && <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: 'auto' }}>{t.description}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {gatewayDetails[tool.gatewayId].mcpTools && gatewayDetails[tool.gatewayId].mcpTools!.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>MCP Tools ({gatewayDetails[tool.gatewayId].mcpTools!.length})</span>
                          <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {gatewayDetails[tool.gatewayId].mcpTools!.map((mcpTool) => (
                              <div key={mcpTool.name} style={{ padding: '6px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155', fontFamily: 'monospace' }}>{mcpTool.name}</span>
                                </div>
                                {mcpTool.description && <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>{mcpTool.description}</div>}
                                {mcpTool.inputSchema && Object.keys(mcpTool.inputSchema).length > 0 && (
                                  <pre style={{ fontSize: '10px', color: '#475569', background: '#f8fafc', padding: '6px', borderRadius: '3px', border: '1px solid #f1f5f9', whiteSpace: 'pre-wrap', margin: 0, maxHeight: '80px', overflow: 'auto' }}>{JSON.stringify(mcpTool.inputSchema, null, 2)}</pre>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {gatewayDetails[tool.gatewayId].mcpToolsNote && (
                        <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>
                          {gatewayDetails[tool.gatewayId].mcpToolsNote}
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
        </div>
      ) : filteredTools.length === 0 && !searchQuery ? (
        <div className={styles.emptyState}>
          <p>
            No {activeTab === 'webhook' ? 'webhook' : activeTab === 'lambda' ? 'Lambda' : 'MCP'} tools added yet.
          </p>
        </div>
      ) : (
        <div>
          {/* Search */}
          <div style={{ marginBottom: '12px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools by name or description..."
              style={{ width: '100%', maxWidth: '360px', padding: '8px 12px', fontSize: '13px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg)', color: 'var(--text-primary)' }}
            />
            {searchQuery && (
              <span style={{ marginLeft: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {filteredTools.length} result{filteredTools.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {filteredTools.length === 0 ? (
            <div className={styles.emptyState}><p>No tools match "{searchQuery}"</p></div>
          ) : (
          <div className={styles.toolList}>
            {paginatedTools.map((tool) => (
            <div key={tool.id} className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <h3 className={styles.toolName}>{tool.name}</h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className={styles.deleteBtn}
                    style={{ color: 'var(--text-secondary)', fontSize: '12px', width: 'auto', padding: '2px 8px' }}
                    onClick={() => handleEdit(tool)}
                  >
                    Edit
                  </button>
                  <button
                    className={styles.deleteBtn}
                    style={{ color: 'var(--text-secondary)', fontSize: '12px', width: 'auto', padding: '2px 8px' }}
                    onClick={() => {
                      if (testParamsId === tool.id) {
                        setTestParamsId(null);
                        setTestParamValues({});
                      } else {
                        setTestParamsId(tool.id);
                        setTestResult(null);
                        // Pre-populate empty values from parameter definitions
                        try {
                          const params = JSON.parse(tool.parameters || '[]');
                          const vals: Record<string, string> = {};
                          if (Array.isArray(params)) params.forEach((p: any) => { vals[p.name] = ''; });
                          setTestParamValues(vals);
                        } catch { setTestParamValues({}); }
                      }
                    }}
                    disabled={testingId === tool.id}
                  >
                    {testingId === tool.id ? '...' : testParamsId === tool.id ? 'Cancel' : 'Test'}
                  </button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(tool.id)}>Delete</button>
                </div>
              </div>
              {tool.description && <p className={styles.toolDesc}>{tool.description}</p>}
              <div className={styles.toolMeta}>
                {tool.endpoint && (
                  <span className={styles.metaValue}>
                    {tool.method || 'POST'} {tool.endpoint}
                    {tool.timeout && ` (${tool.timeout}s)`}
                  </span>
                )}
                {tool.functionArn && <span className={styles.metaValue}>λ {tool.functionArn}</span>}
                {tool.gatewayId && <span className={styles.metaValue}>{tool.gatewayId}</span>}
              </div>
              {/* Test Parameters Form */}
              {testParamsId === tool.id && (
                <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Test Parameters</div>
                  {(() => {
                    let params: any[] = [];
                    try { params = JSON.parse(tool.parameters || '[]'); } catch {}
                    if (!Array.isArray(params) || params.length === 0) {
                      return (
                        <div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>Enter JSON payload to send:</div>
                          <textarea
                            value={testParamValues['__raw'] || ''}
                            onChange={(e) => setTestParamValues({ __raw: e.target.value })}
                            rows={3}
                            placeholder={'{\n  "account_id": "12345",\n  "action": "check_balance"\n}'}
                            style={{ width: '100%', fontSize: '12px', fontFamily: 'monospace', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', resize: 'vertical' }}
                          />
                        </div>
                      );
                    }
                    // Build sample format hint
                    const sampleObj: Record<string, string> = {};
                    params.forEach((p: any) => {
                      sampleObj[p.name] = p.type === 'number' ? '123' : p.type === 'boolean' ? 'true' : `<${p.description || p.name}>`;
                    });
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
                          Sample: <code style={{ background: '#e2e8f0', padding: '1px 4px', borderRadius: '3px', fontSize: '10px' }}>{JSON.stringify(sampleObj)}</code>
                        </div>
                        {params.map((p: any) => (
                          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '11px', color: '#64748b', minWidth: '80px', fontFamily: 'monospace' }}>
                              {p.name}{p.required ? ' *' : ''}
                              {p.in && <span style={{ color: '#94a3b8', marginLeft: '4px' }}>({p.in})</span>}
                            </label>
                            <input
                              value={testParamValues[p.name] || ''}
                              onChange={(e) => setTestParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                              placeholder={p.description || p.type}
                              style={{ flex: 1, fontSize: '12px', padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', fontFamily: 'monospace' }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <button
                    onClick={async () => {
                      setTestingId(tool.id);
                      setTestResult(null);
                      try {
                        const payload = testParamValues['__raw'] || JSON.stringify(
                          Object.fromEntries(Object.entries(testParamValues).filter(([k, v]) => k !== '__raw' && v))
                        );
                        const result = await testTool(tool.id, payload);
                        setTestResult(result);
                      } catch (err) {
                        setTestResult({ result: err instanceof Error ? err.message : 'Failed', status: 'error' });
                      } finally {
                        setTestingId(null);
                      }
                    }}
                    disabled={testingId === tool.id}
                    style={{ marginTop: '8px', padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#6366f1', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                  >
                    {testingId === tool.id ? 'Testing...' : 'Run Test'}
                  </button>
                </div>
              )}
              {testResult && testingId === null && (
                <div style={{ marginTop: '10px', padding: '10px', background: testResult.status === 'success' ? '#eef2ff' : testResult.status === 'mocked' ? '#eff6ff' : '#fef2f2', borderRadius: '6px', fontSize: '12px' }}>
                  <strong style={{ color: testResult.status === 'success' ? '#6366f1' : testResult.status === 'mocked' ? '#2563eb' : '#dc2626' }}>
                    {testResult.status.toUpperCase()} {testResult.statusCode && `(${testResult.statusCode})`}
                  </strong>
                  {testResult.responseTimeMs != null && <span style={{ marginLeft: '8px', color: '#64748b', fontSize: '11px' }}>{testResult.responseTimeMs}ms</span>}
                  {testResult.note && <span style={{ marginLeft: '8px', color: '#666' }}>{testResult.note}</span>}
                  {/* Request details */}
                  {testResult.request && (
                    <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.03)', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Request</div>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#475569', wordBreak: 'break-all' }}>
                        <span style={{ fontWeight: 600 }}>{testResult.request.method}</span> {testResult.request.url}
                      </div>
                      {testResult.request.headers && Object.keys(testResult.request.headers).length > 0 && (
                        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#64748b', marginTop: '4px' }}>
                          {Object.entries(testResult.request.headers).map(([k, v]) => (
                            <div key={k}>{k}: {v}</div>
                          ))}
                        </div>
                      )}
                      {testResult.request.body && (
                        <pre style={{ fontSize: '11px', color: '#475569', marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{testResult.request.body}</pre>
                      )}
                    </div>
                  )}
                  {/* Response */}
                  <div style={{ marginTop: '6px', fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Response</div>
                  <pre style={{ marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333', maxHeight: '120px', overflow: 'auto', margin: 0 }}>{testResult.result}</pre>
                </div>
              )}
            </div>
          ))}
          </div>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '16px', paddingBottom: '8px' }}>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px', background: currentPage === 1 ? 'var(--bg)' : 'white', color: currentPage === 1 ? 'var(--text-secondary)' : 'var(--text-primary)', cursor: currentPage === 1 ? 'default' : 'pointer' }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Page {currentPage} of {totalPages} ({filteredTools.length} tools)
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px', background: currentPage === totalPages ? 'var(--bg)' : 'white', color: currentPage === totalPages ? 'var(--text-secondary)' : 'var(--text-primary)', cursor: currentPage === totalPages ? 'default' : 'pointer' }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Tools;
