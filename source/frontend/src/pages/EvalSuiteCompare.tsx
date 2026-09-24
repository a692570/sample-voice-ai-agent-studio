import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getEvalSuite } from '../services/evalSuitesApi';
import type { EvalSuite } from '../services/evalSuitesApi';
import { listEvalJobsBySuite } from '../services/evalApi';
import type { EvalJob } from '../services/evalApi';
import styles from './EvalSuiteCompare.module.css';

const COLORS = ['color0', 'color1', 'color2', 'color3', 'color4', 'color5'];
const COLOR_HEX = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];

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

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  count: number;
}

function EvalSuiteCompare() {
  const { id: suiteId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [suite, setSuite] = useState<EvalSuite | null>(null);
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!suiteId) return;
    setLoading(true);
    try {
      const [suiteData, jobsData] = await Promise.all([
        getEvalSuite(suiteId),
        listEvalJobsBySuite(suiteId),
      ]);
      setSuite(suiteData);
      const completed = jobsData
        .filter((j) => j.status === 'COMPLETED')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setJobs(completed);

      // Pre-select from query params
      const preselect = searchParams.get('jobs');
      if (preselect) {
        const ids = preselect.split(',').filter((id) => completed.some((j) => j.id === id));
        setSelectedIds(new Set(ids));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [suiteId, searchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSelection = (jobId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const selectedJobs = useMemo(
    () => jobs.filter((j) => selectedIds.has(j.id)),
    [jobs, selectedIds]
  );

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  const getLatency = (job: EvalJob, key: string): LatencyStats | null => {
    const latency = (job.summary as any)?.latency;
    if (!latency) return null;
    return latency[key] || null;
  };

  const latencyKeys = [
    { key: 'ttft', label: 'Time to First Token (TTFT)', tooltip: 'Start: user_input_end (last audio chunk sent). End: bidi_transcript_stream (first assistant text received). Measures model thinking/processing time.' },
    { key: 'ttfb', label: 'Time to First Byte (TTFB)', tooltip: 'Start: user_input_end (last audio chunk sent to agent). End: bidi_audio_stream (first audio byte received from agent). Measures overall voice responsiveness.' },
    { key: 'turnTaking', label: 'Turn-Taking', tooltip: 'Start: previous agent_speaking_end (last audio byte from prior turn). End: current first bidi_audio_stream. Full conversational gap the caller experiences between turns.' },
    { key: 'totalTurnDuration', label: 'Total Turn Duration', tooltip: 'Start: user_input_end. End: last audio byte received from agent for that turn. Measures the full response cycle.' },
    { key: 'toolExecution', label: 'Tool Execution', tooltip: 'Start: tool_call event (agent requests tool invocation). End: tool_result event (tool returns data). Measures individual tool/API call duration.' },
    { key: 'toolToSpeech', label: 'Tool → Speech', tooltip: 'Start: last tool_result event in a turn. End: first audio byte after tool result. Measures how quickly the agent speaks after receiving tool data.' },
  ];

  // Compute max values for each latency metric across selected jobs for bar scaling
  const latencyMaxes = useMemo(() => {
    const maxes: Record<string, number> = {};
    for (const { key } of latencyKeys) {
      let max = 0;
      for (const job of selectedJobs) {
        const stats = getLatency(job, key);
        if (stats && stats.p95 > max) max = stats.p95;
        if (stats && stats.max > max) max = stats.max;
      }
      maxes[key] = max || 1;
    }
    return maxes;
  }, [selectedJobs]);

  // Collect all unique metric names across selected jobs
  const allMetrics = useMemo(() => {
    const set = new Set<string>();
    for (const job of selectedJobs) {
      const verdicts = job.summary?.metricVerdicts;
      if (verdicts) {
        Object.keys(verdicts).forEach((k) => set.add(k));
      }
    }
    return Array.from(set);
  }, [selectedJobs]);

  if (loading) return <div style={{ padding: '32px', color: '#94a3b8' }}>Loading...</div>;
  if (!suite) return <div style={{ padding: '32px', color: '#dc2626' }}>Suite not found.</div>;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Compare Evaluations</h1>
          <p className={styles.subtitle}>{suite.name} — select tasks to compare metrics & latency</p>
        </div>
        <button className={styles.backBtn} onClick={() => navigate(`/eval-suites/${suiteId}`)}>
          ← Back to Suite
        </button>
      </div>

      {/* Task Selection */}
      <div className={styles.selectionPanel}>
        <div className={styles.selectionHeader}>
          <span className={styles.selectionTitle}>Completed Tasks</span>
          <span className={styles.selectedCount}>
            {selectedIds.size} selected
          </span>
        </div>
        <div className={styles.taskList}>
          {jobs.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
              No completed eval tasks to compare.
            </div>
          ) : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', cursor: 'pointer', padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={jobs.length > 0 && selectedIds.size === jobs.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(jobs.map((j) => j.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  style={{ accentColor: '#6366f1' }}
                />
                Select all
              </label>
              {jobs.map((job) => {
              const isSelected = selectedIds.has(job.id);
              const result = job.summary?.overallRating;
              return (
                <div
                  key={job.id}
                  className={`${styles.taskRow} ${isSelected ? styles.taskRowSelected : ''}`}
                  onClick={() => toggleSelection(job.id)}
                >
                  <div className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`}>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className={styles.taskInfo}>
                    <div className={styles.taskName} title={job.config.testName || 'Unnamed eval'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{job.config.testName || 'Unnamed eval'}</div>
                    <div className={styles.taskMeta}>
                      {formatDate(job.createdAt)} · {job.summary?.totalTurns || '?'} turns · {job.summary?.durationSeconds || '?'}s
                    </div>
                  </div>
                  {result && (
                    <span
                      className={styles.taskStatus}
                      style={{
                        background: result === 'PASS' ? '#f0fdf4' : '#fef2f2',
                        color: result === 'PASS' ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {result}
                    </span>
                  )}
                </div>
              );
            })}
            </>
          )}
        </div>
      </div>

      {/* Comparison Results */}
      <div className={styles.comparePanel}>
        {selectedJobs.length < 2 ? (
          <div className={styles.comparePanelEmpty}>
            Select at least 2 completed tasks above to compare metrics and latency side by side.
          </div>
        ) : (
          <div className={styles.compareGrid}>
            {/* Legend */}
            <div className={styles.legend}>
              {selectedJobs.map((job, i) => (
                <div key={job.id} className={styles.legendItem}>
                  <div className={styles.legendDot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                  <span title={job.config.testName || `Task ${i + 1}`}>{job.config.testName || `Task ${i + 1}`}</span>
                </div>
              ))}
            </div>

            {/* Summary cards */}
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <div className={styles.summaryCardLabel}>Overall Rating</div>
                <div className={styles.summaryCardValues}>
                  {selectedJobs.map((job, i) => (
                    <div key={job.id} className={styles.summaryCardValue}>
                      <div className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                      <span className={job.summary?.overallRating === 'PASS' ? styles.pass : styles.fail}>
                        {job.summary?.overallRating || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryCardLabel}>Pass Rate</div>
                <div className={styles.summaryCardValues}>
                  {selectedJobs.map((job, i) => (
                    <div key={job.id} className={styles.summaryCardValue}>
                      <div className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                      {job.summary?.passRate != null ? `${Math.round(job.summary.passRate * 100)}%` : '—'}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryCardLabel}>Total Turns</div>
                <div className={styles.summaryCardValues}>
                  {selectedJobs.map((job, i) => (
                    <div key={job.id} className={styles.summaryCardValue}>
                      <div className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                      {job.summary?.totalTurns ?? '—'}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryCardLabel}>Duration</div>
                <div className={styles.summaryCardValues}>
                  {selectedJobs.map((job, i) => (
                    <div key={job.id} className={styles.summaryCardValue}>
                      <div className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                      {job.summary?.durationSeconds != null ? `${job.summary.durationSeconds}s` : '—'}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryCardLabel}>Tool Calls</div>
                <div className={styles.summaryCardValues}>
                  {selectedJobs.map((job, i) => (
                    <div key={job.id} className={styles.summaryCardValue}>
                      <div className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                      {job.summary?.totalToolCalls ?? '—'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Metric Verdicts Table */}
            {allMetrics.length > 0 && (
              <div>
                <h3 className={styles.sectionTitle}>Metric Verdicts</h3>
                <table className={styles.metricsTable}>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      {selectedJobs.map((job, i) => (
                        <th key={job.id} title={job.config.testName || `Task ${i + 1}`}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span className={styles.dot} style={{ background: COLOR_HEX[i % COLOR_HEX.length] }} />
                            {job.config.testName || `Task ${i + 1}`}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allMetrics.map((metric) => (
                      <tr key={metric}>
                        <td className={styles.metricLabel}>{metric}</td>
                        {selectedJobs.map((job) => {
                          const verdict = job.summary?.metricVerdicts?.[metric];
                          return (
                            <td key={job.id}>
                              {verdict ? (
                                <span className={verdict === 'PASS' ? styles.pass : styles.fail}>
                                  {verdict}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Latency Comparison */}
            <div>
              <h3 className={styles.sectionTitle}>Latency Comparison (ms)</h3>
              <div className={styles.latencySection}>
                {latencyKeys.map(({ key, label, tooltip }) => {
                  // Only show if at least one selected job has this metric
                  const hasData = selectedJobs.some((j) => getLatency(j, key) !== null);
                  if (!hasData) return null;
                  const maxVal = latencyMaxes[key];

                  return (
                    <div key={key} className={styles.latencyMetric}>
                      <div className={styles.latencyLabel}>{label} <InfoTooltip text={tooltip} /></div>

                      {/* P95 bars */}
                      <div style={{ marginBottom: '6px', fontSize: '11px', color: '#64748b', fontWeight: 500 }}>p95</div>
                      <div className={styles.latencyBars}>
                        {selectedJobs.map((job, i) => {
                          const stats = getLatency(job, key);
                          const value = stats?.p95 ?? 0;
                          const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, 2) : 0;
                          return (
                            <div key={job.id} className={styles.latencyBar}>
                              <div className={styles.barLabel} title={job.config.testName || `Task ${i + 1}`}>{job.config.testName || `Task ${i + 1}`}</div>
                              <div className={styles.barTrack}>
                                <div
                                  className={`${styles.barFill} ${styles[COLORS[i % COLORS.length]]}`}
                                  style={{ width: `${pct}%` }}
                                >
                                  {pct > 15 && <span className={styles.barValue}>{value}ms</span>}
                                </div>
                              </div>
                              {pct <= 15 && <span className={styles.barValueOutside}>{value}ms</span>}
                            </div>
                          );
                        })}
                      </div>

                      {/* Avg bars */}
                      <div style={{ marginTop: '8px', marginBottom: '6px', fontSize: '11px', color: '#64748b', fontWeight: 500 }}>avg</div>
                      <div className={styles.latencyBars}>
                        {selectedJobs.map((job, i) => {
                          const stats = getLatency(job, key);
                          const value = stats?.avg ?? 0;
                          const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, 2) : 0;
                          return (
                            <div key={job.id} className={styles.latencyBar}>
                              <div className={styles.barLabel} title={job.config.testName || `Task ${i + 1}`}>{job.config.testName || `Task ${i + 1}`}</div>
                              <div className={styles.barTrack}>
                                <div
                                  className={`${styles.barFill} ${styles[COLORS[i % COLORS.length]]}`}
                                  style={{ width: `${pct}%`, opacity: 0.7 }}
                                >
                                  {pct > 15 && <span className={styles.barValue}>{Math.round(value)}ms</span>}
                                </div>
                              </div>
                              {pct <= 15 && <span className={styles.barValueOutside}>{Math.round(value)}ms</span>}
                            </div>
                          );
                        })}
                      </div>

                      {/* P50 bars */}
                      <div style={{ marginTop: '8px', marginBottom: '6px', fontSize: '11px', color: '#64748b', fontWeight: 500 }}>p50</div>
                      <div className={styles.latencyBars} style={{ marginBottom: '20px' }}>
                        {selectedJobs.map((job, i) => {
                          const stats = getLatency(job, key);
                          const value = stats?.p50 ?? 0;
                          const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, 2) : 0;
                          return (
                            <div key={job.id} className={styles.latencyBar}>
                              <div className={styles.barLabel} title={job.config.testName || `Task ${i + 1}`}>{job.config.testName || `Task ${i + 1}`}</div>
                              <div className={styles.barTrack}>
                                <div
                                  className={`${styles.barFill} ${styles[COLORS[i % COLORS.length]]}`}
                                  style={{ width: `${pct}%`, opacity: 0.5 }}
                                >
                                  {pct > 15 && <span className={styles.barValue}>{value}ms</span>}
                                </div>
                              </div>
                              {pct <= 15 && <span className={styles.barValueOutside}>{value}ms</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EvalSuiteCompare;
