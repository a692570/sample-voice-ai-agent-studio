/**
 * Call History API service.
 */

import { apiRequest } from './apiClient';

export interface CallSession {
  sessionId: string;
  agentId: string;
  userId?: string;
  callerId?: string;
  source?: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  turnCount: number;
  endReason: string;
  s3Prefix?: string;
}

export interface CallSessionDetail {
  session: CallSession;
  urls: {
    transcript?: string;
    audio?: string;
    events?: string;
  };
}

export interface CallSessionList {
  sessions: CallSession[];
  nextKey: string | null;
}

export function listCallSessions(agentId: string, limit = 20, startKey?: string): Promise<CallSessionList> {
  let url = `/call-history/sessions?agentId=${encodeURIComponent(agentId)}&limit=${limit}`;
  if (startKey) url += `&startKey=${encodeURIComponent(startKey)}`;
  return apiRequest<CallSessionList>(url);
}

export function getCallSessionDetail(sessionId: string, agentId: string): Promise<CallSessionDetail> {
  return apiRequest<CallSessionDetail>(`/call-history/sessions/${sessionId}?agentId=${encodeURIComponent(agentId)}`);
}

export function deleteCallSession(sessionId: string, agentId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/call-history/sessions/${sessionId}?agentId=${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
}

export function analyzeCallHistory(transcript: string, prompt: string): Promise<{ analysis: string }> {
  return apiRequest<{ analysis: string }>('/call-history/analyze', {
    method: 'POST',
    body: JSON.stringify({ transcript, prompt }),
  });
}
