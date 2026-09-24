/**
 * CallHistoryTab — Displays captured call sessions for an agent.
 * Fetches from the call-history API and shows session list + detail with transcript/audio.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listCallSessions, getCallSessionDetail, deleteCallSession, analyzeCallHistory } from '../services/callHistoryApi';
import type { CallSession, CallSessionDetail } from '../services/callHistoryApi';

interface Props {
  agentId: string;
}

function CallHistoryTab({ agentId }: Props) {
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CallSessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [selectedTurnIdx, setSelectedTurnIdx] = useState<number | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const playAllIndexRef = useRef<number>(0);
  const audioContainerRef = useRef<HTMLDivElement>(null);

  // Stop all audio when navigating away or selecting a different session
  const stopAllAudio = useCallback(() => {
    setPlayingAll(false);
    if (audioContainerRef.current) {
      audioContainerRef.current.querySelectorAll('audio').forEach((el) => {
        el.pause();
        el.currentTime = 0;
      });
    }
  }, []);

  // Play all turns sequentially — just activates turns and lets the existing audio player handle it
  const playAllTurns = useCallback(() => {
    if (!selectedSession || !transcript.length) return;
    const turnAudio = (selectedSession.urls as any).turnAudio || {};
    // Build list of turn indices that have audio
    const turnsWithAudio = transcript
      .map((turn: any, i: number) => ({ idx: i, url: turn.audioFile ? turnAudio[turn.audioFile.split('/').pop()] : null }))
      .filter((t) => t.url);

    if (turnsWithAudio.length === 0) return;

    stopAllAudio();
    setPlayingAll(true);
    playAllIndexRef.current = 0;
    // Select the first turn with audio — the autoPlay <audio> will start it
    setSelectedTurnIdx(turnsWithAudio[0].idx);
  }, [selectedSession, transcript, stopAllAudio]);

  useEffect(() => {
    return () => stopAllAudio();
  }, [stopAllAudio]);

  const fetchSessions = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await listCallSessions(agentId);
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleDelete = async (e: React.MouseEvent, session: CallSession) => {
    e.stopPropagation();
    if (!confirm(`Delete session ${session.sessionId.substring(0, 8)}...?`)) return;
    try {
      await deleteCallSession(session.sessionId, agentId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId));
    } catch {
      alert('Failed to delete session');
    }
  };

  const handleSelectSession = async (session: CallSession) => {
    setLoadingDetail(true);
    setTranscript([]);
    try {
      const detail = await getCallSessionDetail(session.sessionId, agentId);
      setSelectedSession(detail);
      // Fetch transcript from presigned URL
      if (detail.urls.transcript) {
        try {
          const resp = await fetch(detail.urls.transcript);
          if (resp.ok) {
            const data = await resp.json();
            setTranscript(data.turns || []);
          }
        } catch (fetchErr) {
          console.warn('Failed to fetch transcript from S3:', fetchErr);
        }
      }
    } catch (err) {
      console.error('Failed to load session detail:', err);
      setSelectedSession(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  if (loading) return <div style={{ padding: '32px', color: '#94a3b8' }}>Loading call history...</div>;

  // Detail view
  if (selectedSession) {
    const session = selectedSession.session;
    return (
      <div ref={audioContainerRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <button onClick={() => { stopAllAudio(); setSelectedTurnIdx(null); setSelectedSession(null); setTranscript([]); }} style={{ fontSize: '13px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to list
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedSession.urls.transcript && (
              <a href={selectedSession.urls.transcript} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#6366f1', textDecoration: 'none', padding: '4px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Transcript
              </a>
            )}
          </div>
        </div>

        {/* Session header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Conversation
          </h3>
          {session.callerId && (
            <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', background: '#f0f9ff', color: '#0369a1', fontWeight: 500 }}>
              {session.callerId}
            </span>
          )}
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {formatDate(session.startedAt)} — {session.endedAt ? new Date(session.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{formatDuration(session.durationSeconds)} · {session.turnCount} turns</span>
          <button
            onClick={() => setAnalyticsOpen(true)}
            disabled={!transcript.length}
            style={{ marginLeft: 'auto', fontSize: '13px', padding: '8px 14px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: transcript.length ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Analyze Conversation
          </button>
        </div>

        {/* Analytics modal */}
        {analyticsOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
            <div onClick={() => setAnalyticsOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(2px)' }} />
            <div style={{ position: 'relative', background: '#fff', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: '70%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>Post-Call Analytics</h3>
                <button onClick={() => setAnalyticsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '18px', lineHeight: 1, padding: '4px' }}>×</button>
              </div>
              {/* Body */}
              <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <select
                    value={analysisPrompt}
                    onChange={(e) => setAnalysisPrompt(e.target.value)}
                    style={{ flex: 1, fontSize: '13px', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fff', color: '#334155', cursor: 'pointer' }}
                  >
                    <option value="">Select analysis type...</option>
                    <option value="Analyze the sentiment of this conversation. For each turn, classify as positive, negative, or neutral. Provide an overall sentiment score and summary.">Sentiment Analysis</option>
                    <option value="Extract all named entities from this conversation (people, organizations, dates, locations, products, account numbers). List each entity with its type and context.">Entity Extraction</option>
                    <option value="Identify all personally identifiable information (PII) in this conversation including names, phone numbers, addresses, account numbers, dates of birth, and any other sensitive data. Flag each instance with its type and location in the transcript.">PII Detection</option>
                    <option value={'Provide a concise summary of this conversation including: the caller\'s intent, key actions taken, outcome, and any follow-up items.'}>Summary</option>
                    <option value="custom">Custom prompt...</option>
                  </select>
                  <button
                    onClick={async () => {
                      if (!analysisPrompt || analysisPrompt === 'custom' || !transcript.length) return;
                      setAnalyzing(true);
                      setAnalysisResult('');
                      try {
                        const transcriptText = transcript.map((t: any) => `${t.role === 'assistant' ? 'Agent' : 'User'}: ${t.text}`).join('\n');
                        const result = await analyzeCallHistory(transcriptText, analysisPrompt);
                        setAnalysisResult(result.analysis);
                      } catch (err: any) {
                        setAnalysisResult(`Error: ${err.message}`);
                      } finally {
                        setAnalyzing(false);
                      }
                    }}
                    disabled={analyzing || !analysisPrompt || analysisPrompt === 'custom' || !transcript.length}
                    style={{ fontSize: '13px', padding: '9px 18px', borderRadius: '6px', border: 'none', background: analyzing ? '#94a3b8' : '#6366f1', color: '#fff', cursor: analyzing ? 'wait' : 'pointer', whiteSpace: 'nowrap', fontWeight: 500 }}
                  >
                    {analyzing ? 'Analyzing...' : 'Run'}
                  </button>
                </div>
                {analysisPrompt && analysisPrompt !== 'custom' && (
                  <textarea
                    value={analysisPrompt}
                    onChange={(e) => setAnalysisPrompt(e.target.value)}
                    style={{ width: '100%', minHeight: '60px', padding: '10px 12px', fontSize: '12px', color: '#475569', lineHeight: 1.5, border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc', resize: 'vertical', fontFamily: 'inherit', marginBottom: '14px', boxSizing: 'border-box' }}
                  />
                )}
                {analysisPrompt === 'custom' && (
                  <textarea
                    onChange={(e) => setAnalysisPrompt(e.target.value)}
                    placeholder="Describe what you'd like to analyze..."
                    style={{ width: '100%', minHeight: '80px', padding: '10px 12px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px', resize: 'vertical', fontFamily: 'inherit', marginBottom: '14px', boxSizing: 'border-box' }}
                  />
                )}
                {analysisResult && (
                  <div style={{ marginTop: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', fontSize: '13px', color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {analysisResult}
                  </div>
                )}
                {analyzing && !analysisResult && (
                  <div style={{ marginTop: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Running analysis...</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Transcript */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Transcript</div>
            {transcript.length > 0 && (
              <button
                onClick={playingAll ? stopAllAudio : playAllTurns}
                style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '5px', border: '1px solid #e2e8f0', background: playingAll ? '#fef2f2' : '#fff', color: playingAll ? '#dc2626' : '#475569', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}
              >
                {playingAll ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    Stop
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Play All
                  </>
                )}
              </button>
            )}
          </div>
          {loadingDetail ? (
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>Loading transcript...</div>
          ) : transcript.length > 0 ? (
            <div style={{ display: 'flex', gap: '16px' }}>
              {/* Left: Transcript turns */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {transcript.map((turn: any, i: number) => (
                  <div
                    key={i}
                    onClick={() => { stopAllAudio(); setSelectedTurnIdx(i); }}
                    style={{
                      display: 'flex', gap: '10px', padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                      background: selectedTurnIdx === i ? '#eef2ff' : 'transparent',
                      border: selectedTurnIdx === i ? '1px solid #c7d2fe' : '1px solid transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#94a3b8', minWidth: '50px', paddingTop: '2px' }}>
                      {turn.timestamp ? new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600, color: turn.role === 'assistant' ? '#6366f1' : '#2563eb', marginRight: '6px' }}>
                          {turn.role === 'assistant' ? 'Agent:' : 'User:'}
                        </span>
                        {turn.text}
                      </span>
                      {turn.toolCalls && turn.toolCalls.length > 0 && (
                        <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {turn.toolCalls.map((tc: any, j: number) => (
                            <span key={j} style={{ fontSize: '10px', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '3px', color: '#64748b' }}>
                              🔧 {tc.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {turn.audioFile && (selectedSession.urls as any).turnAudio?.[turn.audioFile.split('/').pop()] && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    )}
                  </div>
                ))}
              </div>
              {/* Right: Audio + metadata for selected turn */}
              {selectedTurnIdx !== null && transcript[selectedTurnIdx] && (
                <div style={{ width: '260px', flexShrink: 0, padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', alignSelf: 'flex-start', position: 'sticky', top: '0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Audio player */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
                      {transcript[selectedTurnIdx].role === 'assistant' ? 'Agent' : 'User'} Audio
                    </div>
                    {transcript[selectedTurnIdx].audioFile && (selectedSession.urls as any).turnAudio?.[transcript[selectedTurnIdx].audioFile.split('/').pop()] ? (
                      <audio
                        controls
                        autoPlay
                        src={(selectedSession.urls as any).turnAudio[transcript[selectedTurnIdx].audioFile.split('/').pop()]}
                        style={{ width: '100%', height: '32px' }}
                        onEnded={() => {
                          if (!playingAll) return;
                          const turnAudio = (selectedSession.urls as any).turnAudio || {};
                          const turnsWithAudio = transcript
                            .map((turn: any, i: number) => ({ idx: i, url: turn.audioFile ? turnAudio[turn.audioFile.split('/').pop()] : null }))
                            .filter((t) => t.url);
                          const currentListIdx = turnsWithAudio.findIndex((t) => t.idx === selectedTurnIdx);
                          const nextListIdx = currentListIdx + 1;
                          if (nextListIdx < turnsWithAudio.length) {
                            playAllIndexRef.current = nextListIdx;
                            setSelectedTurnIdx(turnsWithAudio[nextListIdx].idx);
                          } else {
                            setPlayingAll(false);
                          }
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>No audio for this turn</div>
                    )}
                  </div>
                  {/* Metadata */}
                  <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                    <div><span style={{ color: '#94a3b8' }}>Turn:</span> {selectedTurnIdx + 1} of {transcript.length}</div>
                    <div><span style={{ color: '#94a3b8' }}>Role:</span> {transcript[selectedTurnIdx].role}</div>
                    {transcript[selectedTurnIdx].timestamp && (
                      <div><span style={{ color: '#94a3b8' }}>Time:</span> {new Date(transcript[selectedTurnIdx].timestamp).toLocaleTimeString()}</div>
                    )}
                    {transcript[selectedTurnIdx].toolCalls?.length > 0 && (
                      <div>
                        <span style={{ color: '#94a3b8' }}>Tools:</span>{' '}
                        {transcript[selectedTurnIdx].toolCalls.map((tc: any) => tc.name).join(', ')}
                      </div>
                    )}
                  </div>
                  {/* Session info */}
                  <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                    <div><span style={{ color: '#94a3b8' }}>Duration:</span> {formatDuration(session.durationSeconds)}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>No transcript available.</div>
          )}
        </div>

      </div>
    );
  }

  // List view
  if (sessions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
        <p style={{ fontSize: '14px' }}>No call history yet.</p>
        <p style={{ fontSize: '13px', marginTop: '4px', color: '#cbd5e1' }}>
          Enable "Chat History" on the POC page and start a conversation to begin recording.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: 0 }}>Call History</h2>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
      </div>
      {sessions.map((session) => (
        <div
          key={session.sessionId}
          onClick={() => handleSelectSession(session)}
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)')}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{formatDate(session.startedAt)}</span>
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#64748b', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {session.source === 'telephony' ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                )}
                {session.source === 'telephony' ? 'telephony' : 'webchat'}
              </span>
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: session.endReason === 'session_ended' ? '#f0fdf4' : '#fef2f2', color: session.endReason === 'session_ended' ? '#16a34a' : '#dc2626' }}>
                {session.endReason}
              </span>
            </div>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              {session.callerId && <span style={{ fontWeight: 500, color: '#334155' }}>{session.callerId} · </span>}
              {session.turnCount} turns
            </span>
          </div>
          <span style={{ fontSize: '14px', color: '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>{formatDuration(session.durationSeconds)}</span>
          <button
            onClick={(e) => handleDelete(e, session)}
            title="Delete session"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', color: '#94a3b8', transition: 'color 0.15s' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export default CallHistoryTab;
