import { apiRequest } from './apiClient';

export interface EvalScenarioTurn {
  role: 'user' | 'expected';
  text: string;
  expectedTools?: string[];
}

export interface EvalScenario {
  name: string;
  turns: EvalScenarioTurn[];
}

export interface TestCase {
  id: string;
  name: string;
  model: string;
  promptOverride: string | null;
  scenarios: EvalScenario[] | null;
  createdAt: string;
}

export interface EvalSuite {
  id: string;
  userId?: string;
  userEmail?: string;
  name: string;
  description: string;
  basePrompt: string;
  tools: string[];
  defaultScenarios: EvalScenario[];
  sourceAgentId?: string;
  testCases: TestCase[];
  evalSettings?: EvalSettings;
  createdAt: string;
  updatedAt: string;
}

export interface EvalSettings {
  userSystemPrompt: string;
  userModelId: string;
  inputMode: 'text' | 'polly';
  maxTurns: number;
  useMock: boolean;
  allowHangup: boolean;
  evaluationAspects: string[];
}

export interface EvalRun {
  id: string;
  suiteId: string;
  testCaseId: string;
  status: 'running' | 'completed' | 'failed';
  config: Record<string, any>;
  results?: Record<string, any>;
  createdAt: string;
}

// --- Eval Suite CRUD ---

export function listEvalSuites(): Promise<EvalSuite[]> {
  return apiRequest<EvalSuite[]>('/eval-suites');
}

export function getEvalSuite(id: string): Promise<EvalSuite> {
  return apiRequest<EvalSuite>(`/eval-suites/${id}`);
}

export function createEvalSuite(data: Partial<EvalSuite>): Promise<EvalSuite> {
  return apiRequest<EvalSuite>('/eval-suites', { method: 'POST', body: JSON.stringify(data) });
}

export function updateEvalSuite(id: string, data: Partial<EvalSuite>): Promise<EvalSuite> {
  return apiRequest<EvalSuite>(`/eval-suites/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteEvalSuite(id: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/eval-suites/${id}`, { method: 'DELETE' });
}

// --- Test Case CRUD ---

export function createTestCase(suiteId: string, data: Partial<TestCase>): Promise<TestCase> {
  return apiRequest<TestCase>(`/eval-suites/${suiteId}/test-cases`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateTestCase(suiteId: string, tcId: string, data: Partial<TestCase>): Promise<TestCase> {
  return apiRequest<TestCase>(`/eval-suites/${suiteId}/test-cases/${tcId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteTestCase(suiteId: string, tcId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/eval-suites/${suiteId}/test-cases/${tcId}`, { method: 'DELETE' });
}

// --- Eval Runs ---

export function listSuiteRuns(suiteId: string): Promise<EvalRun[]> {
  return apiRequest<EvalRun[]>(`/eval-suites/${suiteId}/runs`);
}

export function listTestCaseRuns(suiteId: string, tcId: string): Promise<EvalRun[]> {
  return apiRequest<EvalRun[]>(`/eval-suites/${suiteId}/test-cases/${tcId}/runs`);
}
