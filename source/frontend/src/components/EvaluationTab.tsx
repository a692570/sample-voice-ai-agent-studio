/**
 * EvaluationTab — Run eval harness scenarios against an agent and view results.
 * Rendered inside AgentDetail when activeTab === 'evaluation'.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  startEvalJob,
  listEvalJobs,
  getEvalJob,
  getEvalResults,
  cancelEvalJob,
  deleteEvalJob,
  suggestImprovedPrompt,
  updateEvalJobName,
} from '../services/evalApi';
import type { EvalJob, EvalJobConfig, EvalResults } from '../services/evalApi';
import { updateDemo, getDemo } from '../services/demosApi';
import { listTools as fetchAllTools } from '../services/toolsApi';
import type { SavedTool } from '../services/toolsApi';
import { listRAGSources } from '../services/ragApi';
import type { RAGSource } from '../services/ragApi';

/** Styled tooltip popup that appears on hover over an info icon */
function InfoTooltip({ text }: { text: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
      onMouseEnter={(e) => { const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement; if (tip) tip.style.display = 'block'; }}
      onMouseLeave={(e) => { const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement; if (tip) tip.style.display = 'none'; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span data-tooltip="" style={{ display: 'none', position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '6px', background: '#1e293b', color: 'white', fontSize: '11px', lineHeight: 1.4, padding: '8px 10px', borderRadius: '6px', width: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, textTransform: 'none', fontWeight: 400, letterSpacing: 'normal', whiteSpace: 'normal' }}>
        {text}
      </span>
    </span>
  );
}

interface EvaluationTabProps {
  agentId: string;
  agentName: string;
  systemPrompt?: string;
  initialJobId?: string;
}

const DEFAULT_ASPECTS = [
  'Goal Achievement',
  'Response Quality',
  'Conversation Flow',
  'Tool Usage',
  'Tone & Professionalism',
];

const USER_SIM_MODELS = [
  { id: 'claude-haiku', label: 'Claude Haiku (fast, cheap)' },
  { id: 'claude-sonnet', label: 'Claude Sonnet (balanced)' },
  { id: 'claude-opus', label: 'Claude Opus (best quality)' },
  { id: 'nova-lite', label: 'Nova Lite' },
  { id: 'nova-pro', label: 'Nova Pro' },
];

const JUDGE_MODELS = [
  { id: 'claude-sonnet', label: 'Claude Sonnet (recommended)' },
  { id: 'claude-opus', label: 'Claude Opus (most accurate)' },
  { id: 'claude-haiku', label: 'Claude Haiku (fast, less accurate)' },
  { id: 'nova-pro', label: 'Nova Pro' },
];

function EvaluationTab({ agentId, agentName, systemPrompt, initialJobId }: EvaluationTabProps) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedJob, setSelectedJob] = useState<EvalJob | null>(null);
  const [results, setResults] = useState<EvalResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popoverReasoning, setPopoverReasoning] = useState<{ question: string; reasoning: string; verdict: string } | null>(null);
  const [suggestedPrompt, setSuggestedPrompt] = useState<string | null>(null);
  const [promptChangelog, setPromptChangelog] = useState<string[]>([]);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [applyingPrompt, setApplyingPrompt] = useState(false);
  const [promptApplied, setPromptApplied] = useState(false);
  const [toolsMap, setToolsMap] = useState<Record<string, SavedTool>>({});
  const [ragSourcesMap, setRagSourcesMap] = useState<Record<string, RAGSource>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [playingTurnIndex, setPlayingTurnIndex] = useState<number>(-1);
  const [playingRole, setPlayingRole] = useState<'user' | 'agent' | ''>('');
  const playAllAudioRef = useRef<HTMLAudioElement | null>(null);
  const playAllAbortRef = useRef(false);

  // Inline job name editing
  const [editingJobName, setEditingJobName] = useState(false);
  const [editedJobName, setEditedJobName] = useState('');

  // Form state
  const [testName, setTestName] = useState(`eval-${agentName.toLowerCase().replace(/\s+/g, '-')}`);
  const [maxTurns, setMaxTurns] = useState(5);
  const [inputMode, setInputMode] = useState<'text' | 'polly'>('text');
  const [evalUseMock, setEvalUseMock] = useState(false);
  const [allowHangup, setAllowHangup] = useState(true);
  const [customMetricInput, setCustomMetricInput] = useState('');
  const [metricPopupOpen, setMetricPopupOpen] = useState(false);
  const [metricPopupName, setMetricPopupName] = useState('');
  const [metricPopupDesc, setMetricPopupDesc] = useState('');
  const [metricPopupEditing, setMetricPopupEditing] = useState<string | null>(null);
  const [rubrics, setRubrics] = useState<Record<string, string[]>>({});
  const [userModelId, setUserModelId] = useState('claude-haiku');
  const [judgeModelId, setJudgeModelId] = useState('claude-sonnet');
  const [userPrompt, setUserPrompt] = useState('You are a customer calling to test the agent. Be natural and conversational.');
  const [selectedAspects, setSelectedAspects] = useState<string[]>(['Goal Achievement', 'Response Quality', 'Conversation Flow']);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listEvalJobs(agentId);
      setJobs(data);
    } catch {
      // silently fail on list
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadJobs();
    fetchAllTools().then((tools) => {
      const map: Record<string, SavedTool> = {};
      tools.forEach((t) => { map[t.id] = t; });
      setToolsMap(map);
    }).catch(() => {});
    listRAGSources().then((sources) => {
      const map: Record<string, RAGSource> = {};
      sources.forEach((s) => { map[s.id] = s; });
      setRagSourcesMap(map);
    }).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadJobs]);

  // Auto-open a specific job from URL (e.g., /agents/:id/evaluation/:jobId)
  useEffect(() => {
    if (!initialJobId || loading) return;
    const job = jobs.find((j) => j.id === initialJobId);
    if (job && job.status === 'COMPLETED') {
      setSelectedJob(job);
      getEvalResults(job.id).then(setResults).catch(() => {});
    } else if (job) {
      setSelectedJob(job);
    } else if (!loading && initialJobId) {
      // Job not in list — try fetching directly
      getEvalJob(initialJobId).then((j) => {
        setSelectedJob(j);
        if (j.status === 'COMPLETED') {
          getEvalResults(j.id).then(setResults).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [initialJobId, jobs, loading]);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await getEvalJob(jobId);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
        if (selectedJob?.id === jobId) setSelectedJob(job);
        if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (job.status === 'COMPLETED') {
            const r = await getEvalResults(jobId);
            setResults(r);
          }
        }
      } catch {
        // Retry next interval
      }
    }, 5000);
  }, [selectedJob]);

  // Play all audio clips in sequence (user → agent for each turn)
  const playAllAudio = useCallback(() => {
    if (!results?.audioUrls?.turns) return;
    playAllAbortRef.current = false;
    setPlayingAll(true);

    const turns = results.interactionLog?.turns || [];
    // Build ordered playlist: [{ turnIndex, role, url }]
    const playlist: Array<{ turnIndex: number; role: 'user' | 'agent'; url: string }> = [];
    for (let i = 0; i < turns.length; i++) {
      const turnAudio = results.audioUrls.turns[String(i + 1)];
      if (turnAudio?.user) playlist.push({ turnIndex: i, role: 'user', url: turnAudio.user });
      if (turnAudio?.agent) playlist.push({ turnIndex: i, role: 'agent', url: turnAudio.agent });
    }

    if (playlist.length === 0) { setPlayingAll(false); return; }

    let idx = 0;
    const playNext = () => {
      if (playAllAbortRef.current || idx >= playlist.length) {
        setPlayingAll(false);
        setPlayingTurnIndex(-1);
        setPlayingRole('');
        playAllAudioRef.current = null;
        return;
      }
      const item = playlist[idx];
      setPlayingTurnIndex(item.turnIndex);
      setPlayingRole(item.role);
      const audio = new Audio(item.url);
      playAllAudioRef.current = audio;
      audio.onended = () => { idx++; playNext(); };
      audio.onerror = () => { idx++; playNext(); };
      audio.play().catch(() => { idx++; playNext(); });
    };
    playNext();
  }, [results]);

  const stopPlayAll = useCallback(() => {
    playAllAbortRef.current = true;
    if (playAllAudioRef.current) {
      playAllAudioRef.current.pause();
      playAllAudioRef.current = null;
    }
    setPlayingAll(false);
    setPlayingTurnIndex(-1);
    setPlayingRole('');
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const config: EvalJobConfig = {
      testName,
      maxTurns,
      inputMode,
      userModelId,
      judgeModelId,
      userSystemPrompt: userPrompt,
      evaluationAspects: selectedAspects,
      rubrics: Object.keys(rubrics).length > 0 ? rubrics : undefined,
      useMock: evalUseMock,
      allowHangup,
    };

    try {
      const job = await startEvalJob(agentId, config);
      setJobs((prev) => [job, ...prev]);
      setShowForm(false);
      startPolling(job.id);
    } catch (e: any) {
      setError(e.message || 'Failed to start evaluation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await cancelEvalJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'CANCELLED' as const } : j)));
      if (selectedJob?.id === jobId) setSelectedJob({ ...selectedJob, status: 'CANCELLED' });
    } catch {
      // ignore
    }
  };

  const handleRenameJob = async () => {
    if (!selectedJob || !editedJobName.trim()) { setEditingJobName(false); return; }
    if (editedJobName.trim() === selectedJob.config.testName) { setEditingJobName(false); return; }
    try {
      await updateEvalJobName(selectedJob.id, editedJobName.trim());
      const updatedConfig = { ...selectedJob.config, testName: editedJobName.trim() };
      setSelectedJob({ ...selectedJob, config: updatedConfig });
      setJobs((prev) => prev.map((j) => j.id === selectedJob.id ? { ...j, config: updatedConfig } : j));
      setEditingJobName(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to rename');
    }
  };

  const handleViewResults = async (job: EvalJob) => {
    setSelectedJob(job);
    setResults(null);
    setSuggestedPrompt(null);
    // Update URL to include job ID for shareability
    navigate(`/agents/${agentId}/evaluation/${job.id}`, { replace: true });
    setPromptChangelog([]);
    setPromptApplied(false);
    if (job.status === 'COMPLETED') {
      try {
        const r = await getEvalResults(job.id);
        setResults(r);
      } catch {
        // no results available
      }
    } else if (job.status === 'RUNNING' || job.status === 'PENDING') {
      startPolling(job.id);
    }
  };

  const handleDelete = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this evaluation? This cannot be undone.')) return;
    try {
      await deleteEvalJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
        setResults(null);
      }
    } catch {
      // ignore
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return '#10b981';
      case 'FAILED': return '#ef4444';
      case 'RUNNING': case 'PENDING': case 'EVALUATING': return '#f59e0b';
      case 'CANCELLED': return '#94a3b8';
      default: return '#94a3b8';
    }
  };

  // --- Render ---

  if (loading) return <div style={{ padding: '32px', color: '#94a3b8' }}>Loading evaluation history...</div>;

  // Detail view for a selected job
  if (selectedJob) {
    return (
      <div>
        <style>{`
          .rubric-hover-trigger:hover { background: #f1f5f9; }
        `}</style>
        {/* Back button */}
        <button
          onClick={() => { 
            const suiteId = (selectedJob as any)?.suiteId;
            setSelectedJob(null); setResults(null); 
            navigate(suiteId ? `/eval-suites/${suiteId}` : '/eval-suites', { replace: true }); 
          }}
          style={{ fontSize: '13px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to list
        </button>

        {/* Job header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {editingJobName ? (
            <input
              autoFocus
              value={editedJobName}
              onChange={(e) => setEditedJobName(e.target.value)}
              onBlur={handleRenameJob}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameJob(); if (e.key === 'Escape') setEditingJobName(false); }}
              style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', border: '1px solid #6366f1', borderRadius: '6px', padding: '2px 8px', outline: 'none', margin: 0, maxWidth: '400px' }}
            />
          ) : (
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: 0, cursor: 'pointer' }}
              onDoubleClick={() => { setEditedJobName(selectedJob.config.testName || ''); setEditingJobName(true); }}
              title="Double-click to rename"
            >
              {selectedJob.config.testName}
              <button
                onClick={() => { setEditedJobName(selectedJob.config.testName || ''); setEditingJobName(true); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: '6px', padding: '2px', verticalAlign: 'middle' }}
                title="Rename"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </h3>
          )}
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px',
            background: `${statusColor(selectedJob.status)}15`, color: statusColor(selectedJob.status),
          }}>
            {selectedJob.status}
          </span>
          {selectedJob.createdAt && (
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {new Date(selectedJob.createdAt).toLocaleDateString()} {new Date(selectedJob.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            {(selectedJob.status === 'RUNNING' || selectedJob.status === 'PENDING') && (
              <button
                onClick={() => handleCancel(selectedJob.id)}
                style={{ fontSize: '12px', padding: '6px 12px', background: 'white', border: '1px solid #dc2626', borderRadius: '6px', color: '#dc2626', cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
            {selectedJob.status === 'COMPLETED' && results && (
              <button
                onClick={() => {
                  const exportData = {
                    job: { id: selectedJob.id, config: selectedJob.config, summary: selectedJob.summary, createdAt: selectedJob.createdAt, completedAt: selectedJob.completedAt },
                    evaluation: results.evaluation,
                    interactionLog: results.interactionLog,
                    transcript: results.transcript,
                  };
                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${selectedJob.config.testName}-report.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ fontSize: '12px', padding: '6px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export
              </button>
            )}
          </div>
        </div>

        {/* Running state */}
        {(selectedJob.status === 'RUNNING' || selectedJob.status === 'PENDING') && (
          <div style={{ background: 'transparent', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p style={{ fontSize: '14px', color: '#4338ca' }}>Evaluation in progress...</p>
            <p style={{ fontSize: '12px', color: '#6366f1', marginTop: '4px' }}>
              Running {selectedJob.config.maxTurns}-turn conversation with LLM judge evaluation. This typically takes 2-5 minutes.
            </p>
          </div>
        )}

        {/* Failed state */}
        {selectedJob.status === 'FAILED' && (
          <div style={{ background: 'white', border: '1px solid #fecaca', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#dc2626', marginBottom: '8px' }}>Evaluation Failed</div>
            <p style={{ fontSize: '13px', color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>{selectedJob.error || 'Unknown error'}</p>
          </div>
        )}

        {/* Results */}
        {selectedJob.status === 'COMPLETED' && selectedJob.summary && (
          <div>
            {/* Overall result */}
            <div style={{
              background: 'white',
              border: `1px solid ${selectedJob.summary.overallRating === 'PASS' ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: '10px', padding: '20px', marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {selectedJob.summary.overallRating === 'PASS' ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: selectedJob.summary.overallRating === 'PASS' ? '#166534' : '#991b1b' }}>
                    {selectedJob.summary.overallRating === 'PASS' ? 'All Metrics Passed' : 'Evaluation Failed'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                    {Object.values(selectedJob.summary.metricVerdicts).filter(v => v === 'PASS').length} of {Object.keys(selectedJob.summary.metricVerdicts).length} metrics passed · {selectedJob.summary.totalTurns} turns · {selectedJob.summary.durationSeconds}s · Tools: {selectedJob.summary.toolMode === 'live' ? 'Live' : 'Mock'}
                    {selectedJob.summary.latency?.ttfb && ` · TTFB: ${selectedJob.summary.latency.ttfb.avg}ms`}
                  </div>
                  {/* Progress bar */}
                  <div style={{ marginTop: '10px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '3px',
                      width: `${(selectedJob.summary.passRate * 100).toFixed(0)}%`,
                      background: selectedJob.summary.passRate === 1 ? '#10b981' : selectedJob.summary.passRate >= 0.5 ? '#f59e0b' : '#ef4444',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Suggest improved prompt */}
            {results?.evaluation && selectedJob.summary?.overallRating !== 'PASS' && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: suggestedPrompt ? '12px' : 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Prompt Improvement</div>
                  <button
                    onClick={async () => {
                      setGeneratingPrompt(true);
                      setSuggestedPrompt(null);
                      setPromptChangelog([]);
                      try {
                        const res = await suggestImprovedPrompt({
                          currentPrompt: systemPrompt || selectedJob?.agentSnapshot?.systemPrompt || '',
                          evaluation: results.evaluation,
                          interactionLog: results.interactionLog,
                          agentId,
                        });
                        let prompt = res.suggestedPrompt || '';
                        let changes: string[] = res.changelog || [];

                        // If backend already parsed (changelog present), use directly
                        if (changes.length === 0 && prompt.includes('"suggestedPrompt"')) {
                          // Backend returned raw JSON — extract fields manually
                          const originalText = prompt;
                          // Extract suggestedPrompt value
                          const spMatch = originalText.match(/"suggestedPrompt"\s*:\s*"([\s\S]*?)"\s*,\s*\n?\s*"changelog"/);
                          if (spMatch) {
                            prompt = spMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                          }
                          // Extract changelog array items from original text
                          const clMatch = originalText.match(/"changelog"\s*:\s*\[([\s\S]*?)\]/);
                          if (clMatch) {
                            const items = clMatch[1].match(/"((?:[^"\\]|\\.)*)"/g);
                            if (items) {
                              changes = items.map(s => s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n'));
                            }
                          }
                        }

                        setSuggestedPrompt(prompt);
                        setPromptChangelog(changes);
                      } catch (e: any) {
                        setSuggestedPrompt(`Error: ${e.message || 'Failed to generate suggestion.'}`);
                      } finally {
                        setGeneratingPrompt(false);
                      }
                    }}
                    disabled={generatingPrompt}
                    style={{ fontSize: '12px', padding: '6px 12px', background: generatingPrompt ? '#94a3b8' : '#6366f1', border: 'none', borderRadius: '6px', color: 'white', cursor: generatingPrompt ? 'not-allowed' : 'pointer' }}
                  >
                    {generatingPrompt ? 'Generating...' : 'Suggest Improved Prompt'}
                  </button>
                </div>
                {suggestedPrompt && !suggestedPrompt.startsWith('Error:') && (
                  <div style={{ marginTop: '12px' }}>
                    {/* Changelog */}
                    {promptChangelog.length > 0 && (
                      <div style={{ marginBottom: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#1e40af', marginBottom: '6px' }}>WHAT CHANGED</div>
                        <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {promptChangelog.map((item, i) => (
                            <li key={i} style={{ fontSize: '12px', color: '#1e3a5f', lineHeight: 1.5 }}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Side-by-side comparison */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>CURRENT PROMPT</div>
                      <pre style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', maxHeight: '300px', overflow: 'auto' }}>
                        {systemPrompt || selectedJob?.agentSnapshot?.systemPrompt || '(no prompt configured)'}
                      </pre>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#6366f1', marginBottom: '6px' }}>SUGGESTED PROMPT</div>
                      <textarea
                        value={suggestedPrompt || ''}
                        onChange={(e) => setSuggestedPrompt(e.target.value)}
                        style={{ fontSize: '11px', color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0, background: 'white', border: '1px solid #c7d2fe', borderRadius: '6px', padding: '10px', maxHeight: '300px', minHeight: '200px', overflow: 'auto', width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                      />
                      <button
                        onClick={() => { navigator.clipboard.writeText(suggestedPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        style={{ marginTop: '8px', fontSize: '12px', padding: '5px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', color: copied ? '#10b981' : '#64748b', cursor: 'pointer' }}
                      >
                        {copied ? '✓ Copied to clipboard' : 'Copy suggested prompt'}
                      </button>
                    </div>
                  </div>
                  </div>
                )}
                {suggestedPrompt && suggestedPrompt.startsWith('Error:') && (
                  <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px' }}>{suggestedPrompt}</p>
                )}
              </div>
            )}

            {/* Eval config (collapsed) */}
            <details style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
              <summary style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Evaluation Config</summary>
              <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  ['Test Name', selectedJob.config.testName],
                  ['Max Turns', String(selectedJob.config.maxTurns)],
                  ['Input Mode', selectedJob.config.inputMode],
                  ['Tool Mode', selectedJob.config.useMock ? '🟡 Mock' : '🟢 Live'],
                  ['User Model', selectedJob.config.userModelId],
                  ['Judge Model', (selectedJob.config as any).judgeModelId || 'claude-sonnet'],
                  ['Aspects', selectedJob.config.evaluationAspects?.join(', ') || '—'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{label}</span>
                    <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500, textAlign: 'right' }}>{value}</span>
                  </div>
                ))}
                {selectedJob.config.userSystemPrompt && (
                  <div style={{ gridColumn: '1 / -1', marginTop: '4px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>User Persona:</span>
                    <p style={{ fontSize: '12px', color: '#334155', margin: '4px 0 0', lineHeight: 1.4 }}>{selectedJob.config.userSystemPrompt}</p>
                  </div>
                )}
              </div>
            </details>

            {/* Agent Config Snapshot */}
            {(() => {
              const snapshot = selectedJob.agentSnapshot || (selectedJob as any).agentSnapshot;
              if (!snapshot) return (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Agent Configuration</span>
                  <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>No agent configuration snapshot available for this job.</p>
                </div>
              );
              const modelId = (snapshot as any).modelId || '';
              const voiceId = snapshot.voice?.voiceId || '';
              const rawTools = snapshot.tools || [];
              const customTools = snapshot.customTools || [];

              // Filter out entries that look like model IDs (contain dots/colons but no tool-like name)
              const isModelIdLike = (t: any): boolean => {
                if (typeof t === 'string') return /^[a-z].*\.[a-z].*[:.-]/.test(t) && !t.startsWith('int:');
                if (typeof t === 'object' && t.name) return /^[a-z].*\.[a-z].*[:.-]/.test(t.name) && t.type === 'builtin';
                return false;
              };
              const detectedModelId = !modelId ? rawTools.find((t: any) => isModelIdLike(t)) : null;
              const effectiveModelId = modelId || (typeof detectedModelId === 'string' ? detectedModelId : detectedModelId?.name || '');
              const tools = rawTools.filter((t: any) => !isModelIdLike(t));

              // Fallback: extract tool names from interaction log if snapshot tools are empty
              const interactionLog = (results as any)?.interactionLog;
              let inferredTools: string[] = [];
              if (tools.length === 0 && customTools.length === 0 && interactionLog?.turns) {
                const seen = new Set<string>();
                for (const turn of interactionLog.turns) {
                  const toolUses = turn.tool_uses || turn.toolUses || [];
                  for (const tu of toolUses) {
                    const name = tu.tool_name || tu.toolName || tu.name || '';
                    if (name && !seen.has(name)) { seen.add(name); }
                  }
                  // Also check tool_calls
                  const toolCalls = turn.tool_calls || [];
                  for (const tc of toolCalls) {
                    const name = tc.tool_name || tc.toolName || tc.name || '';
                    if (name && !seen.has(name)) { seen.add(name); }
                  }
                }
                inferredTools = Array.from(seen);
              }

              // Fall back to interactionLog for system prompt if snapshot is empty
              const interactionConfig = (results as any)?.interactionLog?.configuration;
              const sysPrompt = snapshot.systemPrompt || interactionConfig?.sonic_system_prompt || '';

              return (
                <details style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
                  <summary style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Agent Configuration (Snapshot)</summary>
                  <div style={{ marginTop: '10px' }}>
                    {/* Key settings grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                      {effectiveModelId && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>Sonic Model</span>
                          <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500, textAlign: 'right' }}>{effectiveModelId}</span>
                        </div>
                      )}
                      {voiceId && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>Voice</span>
                          <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500, textAlign: 'right' }}>{voiceId}</span>
                        </div>
                      )}
                    </div>

                  {/* Tools */}
                  <div style={{ marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Tools</span>
                    <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {tools.map((t: any, i: number) => {
                        let label: string;
                        if (typeof t === 'object' && t.name) {
                          label = `${t.type || 'tool'}: ${t.name}`;
                        } else if (typeof t === 'string') {
                          if (t.startsWith('rag:')) {
                            const ragId = t.slice(4);
                            const ragKb = ragSourcesMap[ragId];
                            label = ragKb ? `RAG: ${ragKb.name}` : t;
                          } else {
                            const toolId = t.startsWith('int:') ? t.slice(4) : t;
                            const resolved = toolsMap[toolId];
                            label = resolved ? `${resolved.type || 'tool'}: ${resolved.name}` : t;
                          }
                        } else {
                          label = String(t);
                        }
                        return (
                          <span key={i} style={{ fontSize: '11px', padding: '3px 8px', background: typeof t === 'string' && t.startsWith('rag:') ? '#ecfdf5' : '#eef2ff', border: `1px solid ${typeof t === 'string' && t.startsWith('rag:') ? '#a7f3d0' : '#c7d2fe'}`, borderRadius: '4px', color: typeof t === 'string' && t.startsWith('rag:') ? '#065f46' : '#4338ca' }}>
                            {label}
                          </span>
                        );
                      })}
                      {customTools.map((t: any, i: number) => (
                        <span key={`ct-${i}`} style={{ fontSize: '11px', padding: '3px 8px', background: 'white', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981' }}>
                          {t.name || 'unnamed'}
                        </span>
                      ))}
                      {tools.length === 0 && customTools.length === 0 && inferredTools.length === 0 && (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>No tools configured</span>
                      )}
                      {tools.length === 0 && customTools.length === 0 && inferredTools.length > 0 && inferredTools.map((name, i) => (
                        <span key={`inferred-${i}`} style={{ fontSize: '11px', padding: '3px 8px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '4px', color: '#854d0e' }}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div style={{ marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>System Prompt</span>
                    <pre style={{ fontSize: '11px', color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: '6px 0 0', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', maxHeight: '300px', overflow: 'auto' }}>{sysPrompt || '(no prompt)'}</pre>
                  </div>
                </div>
              </details>
              );
            })()}

            {/* Metric verdicts */}
            {selectedJob.summary.metricVerdicts && Object.keys(selectedJob.summary.metricVerdicts).length > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '12px' }}>Metric Verdicts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {Object.entries(selectedJob.summary.metricVerdicts).map(([metric, verdict]) => {
                    const detail = results?.evaluation?.weaknesses?.find((w: string) => w.startsWith(`${metric}:`))
                      || results?.evaluation?.strengths?.find((s: string) => s.startsWith(`${metric}:`));
                    const detailText = detail ? detail.replace(`${metric}: `, '').replace(`${metric}:`, '') : '';
                    const metricData = results?.evaluation?.results?.metric_verdicts?.[metric];
                    const rubricVerdicts = metricData?.rubric_verdicts || [];
                    const summaryDetail = selectedJob.summary?.metricDetails?.[metric];
                    const reasoning = metricData?.reasoning || summaryDetail?.reasoning || detailText;
                    const displayRubrics = rubricVerdicts.length > 0 ? rubricVerdicts : (summaryDetail?.rubricVerdicts || []);
                    return (
                      <div key={metric}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: displayRubrics.length ? '6px' : 0 }}>
                          <span style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}>{metric}</span>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: verdict === 'PASS' ? '#10b981' : '#ef4444' }}>
                            {verdict}
                          </span>
                        </div>
                        {/* Metric-level reasoning inline if no rubrics */}
                        {reasoning && displayRubrics.length === 0 && (
                          <p style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5, margin: '0 0 0 0', paddingLeft: '2px' }}>
                            {reasoning}
                          </p>
                        )}
                        {/* Rubric questions inline, click info icon for reasoning popup */}
                        {displayRubrics.length > 0 && (
                          <div style={{ paddingLeft: '10px', borderLeft: '2px solid #e2e8f0', marginTop: '4px' }}>
                            {displayRubrics.map((rv: any, i: number) => (
                              <div key={i} style={{ marginBottom: '3px' }}>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '3px 4px', borderRadius: '4px' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: (rv.verdict === 'YES' || rv.verdict === true) ? '#10b981' : '#ef4444', minWidth: '24px', flexShrink: 0 }}>
                                    {rv.verdict === true ? 'YES' : rv.verdict === false ? 'NO' : rv.verdict}
                                  </span>
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                                    {rv.question}
                                    {rv.reasoning && (
                                      <button
                                        onClick={() => setPopoverReasoning({ question: rv.question, reasoning: rv.reasoning, verdict: rv.verdict === true ? 'YES' : rv.verdict === false ? 'NO' : rv.verdict })}
                                        style={{ background: 'none', border: 'none', padding: '0 0 0 4px', cursor: 'pointer', verticalAlign: 'middle', display: 'inline-flex', alignItems: 'center' }}
                                        title="View explanation"
                                      >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                                        </svg>
                                      </button>
                                    )}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Transcript */}
            {results?.transcript && (
              <details style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
                <summary style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Conversation Transcript</summary>
                <pre style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '12px 0 0', maxHeight: '400px', overflow: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px' }}>
                  {results.transcript}
                </pre>
              </details>
            )}

            {/* Strengths & Weaknesses from evaluation */}
            {results?.evaluation && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '0' }}>
                {results.evaluation.strengths && results.evaluation.strengths.length > 0 && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Strengths</div>
                    <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {results.evaluation.strengths.map((s: string, i: number) => (
                        <li key={i} style={{ fontSize: '12px', color: '#334155', lineHeight: 1.5 }}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {results.evaluation.weaknesses && results.evaluation.weaknesses.length > 0 && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', gridColumn: results.evaluation.strengths?.length ? undefined : '1 / -1' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>Weaknesses</div>
                    <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {results.evaluation.weaknesses.map((w: string, i: number) => (
                        <li key={i} style={{ fontSize: '12px', color: '#334155', lineHeight: 1.5 }}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Latency Metrics */}
            {results?.interactionLog?.latencyMetrics && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '12px' }}>Latency Metrics</div>
                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                  {results.interactionLog.latencyMetrics.summary?.ttfb && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Time to First Byte
                        <InfoTooltip text="Start: user_input_end (last audio chunk sent to agent). End: bidi_audio_stream (first audio byte received from agent). Measures overall voice responsiveness." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.ttfb.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.ttfb.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.ttfb.p95}ms
                      </div>
                    </div>
                  )}
                  {results.interactionLog.latencyMetrics.summary?.ttft && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Time to First Token
                        <InfoTooltip text="Start: user_input_end (last audio chunk sent). End: bidi_transcript_stream (first assistant text received). Measures model thinking/processing time." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.ttft.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.ttft.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.ttft.p95}ms
                      </div>
                    </div>
                  )}
                  {results.interactionLog.latencyMetrics.summary?.toolExecution && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Tool Execution
                        <InfoTooltip text="Start: tool_call event (agent requests tool invocation). End: tool_result event (tool returns data). Measures individual tool/API call duration. Shows 0ms in mock mode since mock tools return instantly." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.toolExecution.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.toolExecution.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.toolExecution.p95}ms · {results.interactionLog.latencyMetrics.summary.toolExecution.count} calls
                      </div>
                    </div>
                  )}
                  {results.interactionLog.latencyMetrics.summary?.toolToSpeech && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Tool → Speech
                        <InfoTooltip text="Start: tool_result (last tool result received in turn). End: bidi_audio_stream (first audio byte after tool). Measures how fast the agent synthesizes speech after getting tool data." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.toolToSpeech.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.toolToSpeech.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.toolToSpeech.p95}ms
                      </div>
                    </div>
                  )}
                  {results.interactionLog.latencyMetrics.summary?.totalTurnDuration && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Total Turn Duration
                        <InfoTooltip text="Start: user_input_end (last user audio sent). End: agent_speaking_end (last bidi_audio_stream byte in turn). Full user-perceived wait from speaking to agent finishing response." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.totalTurnDuration.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.totalTurnDuration.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.totalTurnDuration.p95}ms
                      </div>
                    </div>
                  )}
                  {results.interactionLog.latencyMetrics.summary?.turnTaking && (
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Turn-Taking
                        <InfoTooltip text="Start: previous agent_speaking_end (last audio byte from prior turn). End: current first bidi_audio_stream (first audio byte of new response). Measures full conversational gap the caller experiences between turns, including user speech time." />
                      </div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{results.interactionLog.latencyMetrics.summary.turnTaking.avg}ms</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        p50: {results.interactionLog.latencyMetrics.summary.turnTaking.p50}ms · p95: {results.interactionLog.latencyMetrics.summary.turnTaking.p95}ms
                      </div>
                    </div>
                  )}
                  {/* Cold start & interruptions */}
                  <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Cold Start Penalty
                      <InfoTooltip text="Turn 1 TTFB minus average TTFB of subsequent turns. Shows extra latency on first interaction due to model/runtime cold start (bidi_audio_stream[turn=1] vs avg[turn>1])." />
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
                      {results.interactionLog.latencyMetrics.coldStartDeltaMs != null ? `+${results.interactionLog.latencyMetrics.coldStartDeltaMs}ms` : '—'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Turn 1 vs. avg subsequent</div>
                  </div>

                </div>
                {/* Per-turn latency is now shown inline with transcripts below */}
                {/* Tool latency detail */}
                {results.interactionLog.latencyMetrics.toolLatencies && results.interactionLog.latencyMetrics.toolLatencies.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>Tool Execution Detail</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {results.interactionLog.latencyMetrics.toolLatencies.map((t: any, i: number) => (
                        <span key={i} style={{ fontSize: '11px', padding: '3px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', color: '#475569' }}>
                          {t.tool_name}: <strong>{t.latency_ms}ms</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Interaction Log (conversation turns) */}
            {results?.interactionLog?.turns && results.interactionLog.turns.length > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Conversation Turns</div>
                    {results.interactionLog.conversationEndReason && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: results.interactionLog.conversationEndReason === 'user_closed' ? '#ecfdf5' : results.interactionLog.conversationEndReason === 'max_turns_reached' ? '#fef3c7' : '#f0f4ff',
                        color: results.interactionLog.conversationEndReason === 'user_closed' ? '#059669' : results.interactionLog.conversationEndReason === 'max_turns_reached' ? '#d97706' : '#6366f1',
                        border: `1px solid ${results.interactionLog.conversationEndReason === 'user_closed' ? '#a7f3d0' : results.interactionLog.conversationEndReason === 'max_turns_reached' ? '#fde68a' : '#c7d2fe'}`,
                      }}>
                        {results.interactionLog.conversationEndReason === 'user_closed' ? '✓ User closed conversation' : results.interactionLog.conversationEndReason === 'max_turns_reached' ? '⏱ Max turns reached' : '● Completed'}
                      </span>
                    )}
                  </div>
                  {results.audioUrls?.turns && Object.keys(results.audioUrls.turns).length > 0 && (
                    <button
                      onClick={playingAll ? stopPlayAll : playAllAudio}
                      style={{ fontSize: '12px', padding: '5px 12px', background: playingAll ? '#fef2f2' : '#eef2ff', border: `1px solid ${playingAll ? '#fecaca' : '#c7d2fe'}`, borderRadius: '6px', color: playingAll ? '#dc2626' : '#4338ca', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}
                    >
                      {playingAll ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                          Stop
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          Play All
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {results.interactionLog.turns.map((turn: any, i: number) => {
                    const turnAudio = results.audioUrls?.turns?.[String(i + 1)];
                    const isActiveTurn = playingAll && playingTurnIndex === i;
                    return (
                      <div key={i} style={{ borderBottom: i < results.interactionLog.turns.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: '10px', background: isActiveTurn ? '#eef2ff' : 'transparent', borderRadius: isActiveTurn ? '6px' : '0', padding: isActiveTurn ? '8px 10px 10px' : undefined, transition: 'background 0.2s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Turn {i + 1}</span>
                          {/* Inline latency metrics for this turn */}
                          {(() => {
                            const turnLatency = results.interactionLog.latencyMetrics?.turnLatencies?.[i];
                            if (!turnLatency) return null;
                            return (
                              <span style={{ fontSize: '10px', color: '#64748b', display: 'inline-flex', gap: '6px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
                                {turnLatency.ttfb_ms != null && <span>TTFB: <strong>{turnLatency.ttfb_ms}ms</strong></span>}
                                {turnLatency.ttft_ms != null && <span>TTFT: <strong>{turnLatency.ttft_ms}ms</strong></span>}
                                {turnLatency.turn_taking_ms != null && <span>TT: <strong>{turnLatency.turn_taking_ms}ms</strong></span>}
                                {turnLatency.tool_to_speech_ms != null && <span>T→S: <strong>{turnLatency.tool_to_speech_ms}ms</strong></span>}
                                {turnLatency.tool_latencies && turnLatency.tool_latencies.length > 0 && (
                                  <span>🔧 {turnLatency.tool_latencies.map((t: any) => `${t.tool_name}: ${t.latency_ms}ms`).join(', ')}</span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                        {(turn.user_text || turn.user_message) && (
                          <div style={{ marginBottom: '6px' }}>
                            <div>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb' }}>User: </span>
                              <span style={{ fontSize: '12px', color: '#334155' }}>{typeof (turn.user_text || turn.user_message) === 'string' ? (turn.user_text || turn.user_message) : JSON.stringify(turn.user_text || turn.user_message)}</span>
                              {isActiveTurn && playingRole === 'user' && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6366f1', fontWeight: 600 }}>▶ playing</span>}
                            </div>
                            {turnAudio?.user && (
                              <div style={{ marginTop: '4px' }}><audio controls style={{ width: '240px', height: '28px' }} src={turnAudio.user} /></div>
                            )}
                          </div>
                        )}
                        {/* Tool events */}
                        {turn.tool_uses && turn.tool_uses.length > 0 && (
                          <div style={{ marginBottom: '6px', paddingLeft: '12px', borderLeft: '2px solid #e2e8f0' }}>
                            {turn.tool_uses.map((tool: any, ti: number) => {
                              const name = tool.tool_name || tool.name;
                              
                              // Non-string tool_name: show as collapsible raw data
                              if (typeof name !== 'string' || !name) {
                                const fullJson = JSON.stringify(tool, null, 2);
                                return (
                                  <div key={ti} style={{ marginBottom: '4px' }}>
                                    <span
                                      style={{ fontSize: '10px', color: '#94a3b8', cursor: 'pointer', userSelect: 'none', fontFamily: 'monospace' }}
                                      onClick={(e) => {
                                        const el = (e.currentTarget.nextElementSibling as HTMLElement);
                                        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                                        e.currentTarget.textContent = el?.style.display === 'none' ? '▶ raw response' : '▼ raw response';
                                      }}
                                    >▶ raw response</span>
                                    <pre style={{ display: 'none', fontSize: '10px', color: '#64748b', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', maxHeight: '200px', overflow: 'auto' }}>{fullJson}</pre>
                                  </div>
                                );
                              }
                              // Extract tool_name and tool_args for the label
                              const args = tool.tool_args || tool.args || tool.input || {};
                              const result = tool.tool_result || tool.result;

                              // Build label: tool_name + args values
                              const nameStr = typeof name === 'object' ? JSON.stringify(name) : String(name);
                              const argsStr = args ? (typeof args === 'string' ? args : JSON.stringify(args)) : '';
                              const label = nameStr ? `🔧 ${nameStr}${argsStr ? ` ${argsStr.substring(0, 120)}` : ''}` : `🔧 ${JSON.stringify(tool).substring(0, 120)}`;

                              // Build result string
                              const resultStr = result ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : '';

                              return (
                                <div key={ti} style={{ marginBottom: '4px' }}>
                                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{label}</div>
                                  {resultStr && (
                                    <div style={{ marginTop: '2px', marginLeft: '16px' }}>
                                      <span
                                        style={{ fontSize: '10px', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}
                                        onClick={(e) => {
                                          const el = (e.currentTarget.nextElementSibling as HTMLElement);
                                          if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                                          e.currentTarget.textContent = el?.style.display === 'none' ? '▶ result' : '▼ result';
                                        }}
                                      >▶ result</span>
                                      <pre style={{ display: 'none', fontSize: '10px', color: '#64748b', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', maxHeight: '200px', overflow: 'auto' }}>{resultStr}</pre>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {(turn.assistant_text || turn.assistant_response || turn.sonic_response) && (
                          <div>
                            <div>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#6366f1' }}>Agent: </span>
                              <span style={{ fontSize: '12px', color: '#334155' }}>{typeof (turn.assistant_text || turn.assistant_response || turn.sonic_response) === 'string' ? (turn.assistant_text || turn.assistant_response || turn.sonic_response) : JSON.stringify(turn.assistant_text || turn.assistant_response || turn.sonic_response)}</span>
                              {isActiveTurn && playingRole === 'agent' && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#6366f1', fontWeight: 600 }}>▶ playing</span>}
                            </div>
                            {turnAudio?.agent && (
                              <div style={{ marginTop: '4px' }}><audio controls style={{ width: '240px', height: '28px' }} src={turnAudio.agent} /></div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reasoning popup modal */}
        {popoverReasoning && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPopoverReasoning(null)}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
            <div style={{ position: 'relative', background: 'white', borderRadius: '12px', padding: '20px', maxWidth: '480px', width: '90%', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: popoverReasoning.verdict === 'YES' ? '#10b981' : '#ef4444', background: 'transparent', padding: '2px 8px', borderRadius: '4px', flexShrink: 0 }}>
                    {popoverReasoning.verdict === 'YES' ? 'PASS' : 'FAIL'}
                  </span>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: 0, lineHeight: 1.4 }}>{popoverReasoning.question}</h4>
                </div>
                <button onClick={() => setPopoverReasoning(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#94a3b8', fontSize: '18px', lineHeight: 1, flexShrink: 0, marginLeft: '8px' }}>✕</button>
              </div>
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>Explanation</div>
                <p style={{ fontSize: '13px', color: '#334155', lineHeight: 1.7, margin: 0 }}>{popoverReasoning.reasoning}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- List view ---
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Evaluation History</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
            Run simulated conversations with LLM-as-judge scoring
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={async () => {
              setRefreshing(true);
              await loadJobs();
              setTimeout(() => setRefreshing(false), 600);
            }}
            title="Refresh"
            style={{ padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 0.6s ease', transform: refreshing ? 'rotate(360deg)' : 'rotate(0deg)' }}
            >
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: 'white', cursor: 'pointer' }}
          >
            {showForm ? 'Cancel' : '+ Run Evaluation'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* New eval form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>Configure Evaluation</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>Test Name</label>
              <input
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>User Simulator LLM</label>
              <select
                value={userModelId}
                onChange={(e) => setUserModelId(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
              >
                {USER_SIM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>Judge LLM</label>
              <select
                value={judgeModelId}
                onChange={(e) => setJudgeModelId(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
              >
                {JUDGE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>Input Mode</label>
              <select
                value={inputMode}
                onChange={(e) => setInputMode(e.target.value as 'text' | 'polly')}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
              >
                <option value="text">Text (faster)</option>
                <option value="polly">Polly TTS (realistic)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <div
                onClick={() => setEvalUseMock(!evalUseMock)}
                style={{ width: '32px', height: '18px', borderRadius: '9px', background: evalUseMock ? '#f59e0b' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: evalUseMock ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155' }}>Mock tools</span>
            </label>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{evalUseMock ? 'Tools return predefined mock responses' : 'Tools call real endpoints'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <div
                onClick={() => setAllowHangup(!allowHangup)}
                style={{ width: '32px', height: '18px', borderRadius: '9px', background: allowHangup ? '#10b981' : '#d1d5db', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: 'white', position: 'absolute', top: '2px', left: allowHangup ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155' }}>Allow simulator hangup</span>
            </label>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{allowHangup ? 'Simulator can end call when conversation is complete' : 'Conversation runs until max turns'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>Max Turns</label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
              />
            </div>
            <div />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '4px' }}>User Simulator Persona</label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={10}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', display: 'block', marginBottom: '8px' }}>Evaluation Aspects</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {DEFAULT_ASPECTS.map((aspect) => (
                <button
                  key={aspect}
                  onClick={() => setSelectedAspects((prev) => prev.includes(aspect) ? prev.filter((a) => a !== aspect) : [...prev, aspect])}
                  style={{
                    padding: '5px 12px', fontSize: '12px', borderRadius: '16px', cursor: 'pointer',
                    border: selectedAspects.includes(aspect) ? '1px solid #6366f1' : '1px solid #e2e8f0',
                    background: selectedAspects.includes(aspect) ? '#eef2ff' : 'white',
                    color: selectedAspects.includes(aspect) ? '#6366f1' : '#64748b',
                  }}
                >
                  {aspect}
                </button>
              ))}
            </div>
            {/* Add custom metric */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <button
                onClick={() => { setMetricPopupOpen(true); setMetricPopupName(''); setMetricPopupDesc(''); setMetricPopupEditing(null); }}
                style={{ padding: '6px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' }}
              >
                + Add Custom Metric
              </button>
            </div>

            {/* Custom metrics shown as clickable chips (click to edit) */}
            {selectedAspects.filter((a) => !DEFAULT_ASPECTS.includes(a)).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {selectedAspects.filter((a) => !DEFAULT_ASPECTS.includes(a)).map((aspect) => (
                  <span
                    key={aspect}
                    onClick={() => {
                      setMetricPopupOpen(true);
                      setMetricPopupName(aspect);
                      setMetricPopupDesc((rubrics[aspect] || []).join('; '));
                      setMetricPopupEditing(aspect);
                    }}
                    style={{ fontSize: '11px', padding: '3px 8px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', color: '#92400e', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    title="Click to edit"
                  >
                    {aspect}
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedAspects((prev) => prev.filter((a) => a !== aspect)); setRubrics((prev) => { const r = { ...prev }; delete r[aspect]; return r; }); }}
                      style={{ background: 'none', border: 'none', color: '#d97706', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Metric popup modal */}
            {metricPopupOpen && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setMetricPopupOpen(false)}>
                <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>{metricPopupEditing ? 'Edit Metric' : 'Add Custom Metric'}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '4px' }}>Metric Name</label>
                      <input
                        value={metricPopupName}
                        onChange={(e) => setMetricPopupName(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="e.g., Authentication Flow"
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '4px' }}>Description / Rubric Questions</label>
                      <textarea
                        value={metricPopupDesc}
                        onChange={(e) => setMetricPopupDesc(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Describe what success looks like, or add rubric questions separated by semicolons (;)"
                        rows={3}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', resize: 'vertical' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                    <button onClick={() => setMetricPopupOpen(false)} style={{ padding: '7px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' }}>Cancel</button>
                    {metricPopupEditing && (
                      <button onClick={() => {
                        setSelectedAspects((prev) => prev.filter((a) => a !== metricPopupEditing));
                        setRubrics((prev) => { const r = { ...prev }; delete r[metricPopupEditing!]; return r; });
                        setMetricPopupOpen(false);
                      }} style={{ padding: '7px 14px', background: 'white', border: '1px solid #dc2626', borderRadius: '6px', fontSize: '12px', color: '#dc2626', cursor: 'pointer' }}>Delete</button>
                    )}
                    <button
                      onClick={() => {
                        if (!metricPopupName.trim()) return;
                        const name = metricPopupName.trim();
                        const questions = metricPopupDesc.split(';').map((q) => q.trim()).filter(Boolean);
                        if (metricPopupEditing) {
                          // Edit existing
                          setSelectedAspects((prev) => prev.map((a) => a === metricPopupEditing ? name : a));
                          setRubrics((prev) => { const r = { ...prev }; delete r[metricPopupEditing!]; if (questions.length > 0) r[name] = questions; return r; });
                        } else {
                          // Add new
                          if (!selectedAspects.includes(name)) {
                            setSelectedAspects((prev) => [...prev, name]);
                          }
                          if (questions.length > 0) {
                            setRubrics((prev) => ({ ...prev, [name]: questions }));
                          }
                        }
                        setMetricPopupOpen(false);
                      }}
                      disabled={!metricPopupName.trim()}
                      style={{ padding: '7px 14px', background: metricPopupName.trim() ? '#6366f1' : '#e2e8f0', border: 'none', borderRadius: '6px', fontSize: '12px', color: 'white', cursor: metricPopupName.trim() ? 'pointer' : 'not-allowed', fontWeight: 600 }}
                    >{metricPopupEditing ? 'Save' : 'Add'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || selectedAspects.length === 0}
              style={{
                padding: '10px 20px', background: submitting ? '#94a3b8' : '#6366f1', border: 'none',
                borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: 'white', cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Starting...' : 'Start Evaluation'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{ padding: '10px 20px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 500, color: '#64748b', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 && !showForm ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <p style={{ fontSize: '14px' }}>No evaluations yet</p>
          <p style={{ fontSize: '13px', marginTop: '4px', color: '#cbd5e1' }}>
            Click "Run Evaluation" to test your agent with simulated conversations
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => handleViewResults(job)}
              style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px',
                padding: '14px 18px', cursor: 'pointer', transition: 'box-shadow 0.15s',
                display: 'flex', alignItems: 'center', gap: '14px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              {/* Status badge */}
              <span style={{
                fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px', minWidth: '70px', textAlign: 'center',
                background: `${statusColor(job.status)}15`, color: statusColor(job.status),
              }}>
                {job.status}
              </span>

              {/* Details */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#0f172a' }}>{job.config.testName}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {new Date(job.createdAt).toLocaleString()} · {job.config.maxTurns} turns · {job.config.inputMode}
                </div>
              </div>

              {/* Summary if available */}
              {job.summary && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '10px',
                    background: job.summary.overallRating === 'PASS' ? '#ecfdf5' : '#fef2f2',
                    color: job.summary.overallRating === 'PASS' ? '#166534' : '#991b1b',
                    border: `1px solid ${job.summary.overallRating === 'PASS' ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                    {job.summary.overallRating === 'PASS' ? `✓ Passed` : `✗ ${(job.summary.passRate * 100).toFixed(0)}% passed`}
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{job.summary.durationSeconds}s · {job.summary.toolMode === 'live' ? 'Live' : 'Mock'}</span>
                </div>
              )}

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(e, job.id)}
                title="Delete"
                style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>

              {/* Arrow */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EvaluationTab;
