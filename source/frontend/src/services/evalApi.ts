/**
 * Eval Harness API service.
 * Follows the same pattern as demosApi.ts / ragApi.ts.
 */

import { apiRequest } from './apiClient';

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

// --- Types ---

export interface EvalJobConfig {
  testName: string;
  scenarioDescription?: string;
  maxTurns: number;
  userModelId: string;
  judgeModelId?: string;
  userSystemPrompt?: string;
  inputMode: 'text' | 'polly';
  evaluationAspects: string[];
  rubrics?: Record<string, string[]>;
  useMock?: boolean;
  allowHangup?: boolean;
}

export interface RubricVerdictDetail {
  question: string;
  verdict: string;
  reasoning: string;
}

export interface MetricDetail {
  reasoning: string;
  rubricVerdicts?: RubricVerdictDetail[];
}

export interface EvalResultSummary {
  overallRating: 'PASS' | 'FAIL';
  passRate: number;
  totalTurns: number;
  totalToolCalls: number;
  toolMode?: 'mock' | 'live';
  metricVerdicts: Record<string, string>;
  metricDetails?: Record<string, MetricDetail>;
  strengths?: string[];
  weaknesses?: string[];
  durationSeconds: number;
  latency?: {
    ttft?: { min: number; max: number; avg: number; p50: number; p95: number; count: number };
    ttfb?: { min: number; max: number; avg: number; p50: number; p95: number; count: number };
    toolExecution?: { min: number; max: number; avg: number; p50: number; p95: number; count: number };
  };
}

export interface EvalJob {
  id: string;
  agentId: string;
  suiteId?: string;
  batchId?: string;
  status: 'PENDING' | 'RUNNING' | 'EVALUATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  config: EvalJobConfig;
  resultsKey?: string;
  summary?: EvalResultSummary;
  error?: string;
  agentSnapshot?: {
    systemPrompt: string;
    tools: string[];
    customTools: Array<{ name: string; description?: string; mockResponse?: string }>;
    voice?: { voiceId?: string };
    inferenceConfig?: Record<string, any>;
  };
}

export interface EvalBatch {
  id: string;
  agentId: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  jobIds: string[];
  jobs?: EvalJob[];
}

export interface EvalResults {
  jobId: string;
  evaluation: any;
  transcript: string | null;
  interactionLog: any;
  audioUrls?: {
    agentOutput?: string;
    turns?: Record<string, { agent?: string; user?: string }>;
  };
}

// --- API Functions ---

export function startEvalJob(agentId: string, config: EvalJobConfig): Promise<EvalJob> {
  return apiRequest<EvalJob>('/eval/jobs', {
    method: 'POST',
    body: JSON.stringify({ agentId, config }),
  });
}

/** Start an eval job with direct config override (for eval suites — no agent lookup needed) */
export function startEvalJobWithOverride(config: EvalJobConfig, agentConfigOverride: Record<string, any>, suiteId: string, testCaseId: string, agentId?: string): Promise<EvalJob> {
  return apiRequest<EvalJob>('/eval/jobs', {
    method: 'POST',
    body: JSON.stringify({ agentId: agentId || '', agentConfigOverride, config, suiteId, testCaseId }),
  });
}

export function startEvalBatch(agentId: string, scenarios: EvalJobConfig[]): Promise<EvalBatch> {
  return apiRequest<EvalBatch>('/eval/batches', {
    method: 'POST',
    body: JSON.stringify({ agentId, scenarios }),
  });
}

export function listEvalJobs(agentId: string): Promise<EvalJob[]> {
  return apiRequest<EvalJob[]>(`/eval/jobs?agentId=${encodeURIComponent(agentId)}`);
}

export function listEvalJobsBySuite(suiteId: string): Promise<EvalJob[]> {
  return apiRequest<EvalJob[]>(`/eval/jobs?suiteId=${encodeURIComponent(suiteId)}`);
}

export function listAllEvalJobs(): Promise<EvalJob[]> {
  return apiRequest<EvalJob[]>('/eval/jobs');
}

export function getEvalJob(jobId: string): Promise<EvalJob> {
  return apiRequest<EvalJob>(`/eval/jobs/${jobId}`);
}

export function getEvalResults(jobId: string): Promise<EvalResults> {
  return apiRequest<EvalResults>(`/eval/jobs/${jobId}/results`);
}

export function getEvalBatch(batchId: string): Promise<EvalBatch> {
  return apiRequest<EvalBatch>(`/eval/batches/${batchId}`);
}

export function cancelEvalJob(jobId: string): Promise<{ message: string; id: string }> {
  return apiRequest<{ message: string; id: string }>(`/eval/jobs/${jobId}`, {
    method: 'DELETE',
  });
}

export function deleteEvalJob(jobId: string): Promise<{ message: string; id: string }> {
  return apiRequest<{ message: string; id: string }>(`/eval/jobs/${jobId}/delete`, {
    method: 'DELETE',
  });
}

export function updateEvalJobName(jobId: string, testName: string): Promise<EvalJob> {
  return apiRequest<EvalJob>(`/eval/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ testName }),
  });
}


export async function suggestImprovedPrompt(data: {
  currentPrompt: string;
  evaluation: any;
  interactionLog: any;
  agentId?: string;
}): Promise<{ suggestedPrompt: string; changelog?: string[] }> {
  return apiRequest<{ suggestedPrompt: string; changelog?: string[] }>('/eval/suggest-prompt', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
