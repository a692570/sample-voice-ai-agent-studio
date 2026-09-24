/**
 * Tools API — list Lambda functions and AgentCore gateways
 */

import { apiRequest } from './apiClient';

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface LambdaFunction {
  name: string;
  arn: string;
  runtime: string;
  description: string;
  lastModified: string;
}

export interface Gateway {
  id: string;
  name: string;
  status: string;
  description: string;
}

export interface AgentRuntime {
  id: string;
  name: string;
  status: string;
  description: string;
}

export async function listLambdaFunctions(): Promise<LambdaFunction[]> {
  return apiRequest<LambdaFunction[]>('/tools/lambdas');
}

export async function listGateways(): Promise<Gateway[]> {
  return apiRequest<Gateway[]>('/tools/gateways');
}

export interface GatewayDetail {
  id: string;
  name: string;
  status: string;
  description: string;
  protocolType: string;
  gatewayUrl: string;
  authorizerType: string;
  instructions: string;
  supportedVersions: string[];
  searchType: string;
  targets?: {
    targetId: string;
    name: string;
    description: string;
    targetType: string;
    status: string;
    listingMode: string;
  }[];
  mcpTools?: {
    name: string;
    description: string;
    inputSchema: any;
  }[];
  mcpToolsNote?: string;
}

export async function getGatewayDetail(gatewayId: string): Promise<GatewayDetail> {
  return apiRequest<GatewayDetail>(`/tools/gateways/${gatewayId}`);
}

export async function listRuntimes(): Promise<AgentRuntime[]> {
  return apiRequest<AgentRuntime[]>('/tools/runtimes');
}

export interface SavedTool {
  id: string;
  name: string;
  type: string;
  description?: string;
  endpoint?: string;
  method?: string;
  timeout?: string;
  headers?: string;
  mockResponse?: string;
  functionArn?: string;
  gatewayId?: string;
  parameters?: string;
  createdAt?: string;
  userId?: string;
  userEmail?: string;
}

export async function listTools(): Promise<SavedTool[]> {
  return apiRequest<SavedTool[]>('/tools');
}

export async function createTool(tool: Omit<SavedTool, 'id' | 'createdAt'>): Promise<SavedTool> {
  return apiRequest<SavedTool>('/tools', {
    method: 'POST',
    body: JSON.stringify(tool),
  });
}

export async function deleteTool(id: string): Promise<void> {
  return apiRequest<void>(`/tools/${id}`, { method: 'DELETE' });
}

export async function updateTool(id: string, data: Partial<SavedTool>): Promise<SavedTool> {
  return apiRequest<SavedTool>(`/tools/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export interface TestResult {
  result: string;
  status: string;
  statusCode?: number;
  note?: string;
  functionError?: string;
  responseTimeMs?: number;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export async function testTool(id: string, payload?: string): Promise<TestResult> {
  return apiRequest<TestResult>(`/tools/${id}/test`, {
    method: 'POST',
    body: JSON.stringify({ payload: payload || '{}' }),
  });
}

export async function mcpCallToolViaBackend(gatewayId: string, toolName: string, args: Record<string, any>): Promise<any> {
  return apiRequest<any>(`/tools/gateways/${gatewayId}/call`, {
    method: 'POST',
    body: JSON.stringify({ toolName, arguments: args }),
  });
}
