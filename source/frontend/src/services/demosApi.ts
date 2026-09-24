import type { WizardState } from '../context/WizardContext';
import { apiRequest } from './apiClient';

export interface DemoConfig {
  host: string;
  framework: string;
  model: string[];
  pipeline: string | null;
  systemPrompt: string;
  tools: string[];
  customTools: Array<{
    name: string;
    description: string;
    parameters: string;
    mockResponse: string;
  }>;
  voice: {
    voiceId: string;
    language: string;
    gender: string;
  };
  greeting: string;
  agentStartFirst: boolean;
  telephonyEnabled: boolean;
  telephony?: {
    provider: string;
    phoneNumber: string;
  };
  prompt?: {
    greeting: string;
    instructions: string;
  };
  workflow?: {
    nodes: any[];
    edges: any[];
  } | string;
  useMock?: boolean; // When true, all tools return mock responses instead of calling real endpoints
  callHistoryEnabled?: boolean;
  callLogEnabled?: boolean;
  sipEnabled?: boolean;
  sipPhoneNumber?: string;
}

export interface Demo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: DemoConfig;
  userId?: string;
  userEmail?: string;
}

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export function listDemos(): Promise<Demo[]> {
  return apiRequest<Demo[]>('/demos');
}

export function getDemo(id: string): Promise<Demo> {
  return apiRequest<Demo>(`/demos/${id}`);
}

export function createDemo(data: { name: string; config: DemoConfig }): Promise<Demo> {
  return apiRequest<Demo>('/demos', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateDemo(id: string, data: { name?: string; config?: DemoConfig }): Promise<Demo> {
  return apiRequest<Demo>(`/demos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteDemo(id: string): Promise<{ message: string; id: string }> {
  return apiRequest<{ message: string; id: string }>(`/demos/${id}`, {
    method: 'DELETE',
  });
}

/** Convert WizardState to the DemoConfig shape for saving */
export function wizardStateToConfig(state: WizardState): DemoConfig {
  return {
    host: state.host,
    framework: state.framework,
    model: state.model,
    pipeline: state.pipeline,
    systemPrompt: state.prompt.instructions,
    tools: state.agents.selectedAgents,
    customTools: state.agents.customTools,
    voice: {
      voiceId: state.voice.voiceId,
      language: state.voice.language,
      gender: state.voice.gender,
    },
    greeting: state.prompt.greeting,
    agentStartFirst: state.agentStartFirst,
    telephonyEnabled: state.telephonyEnabled,
    telephony: state.telephonyEnabled && state.phoneNumber
      ? { provider: 'twilio', phoneNumber: state.phoneNumber }
      : undefined,
    sipPhoneNumber: state.sipPhoneNumber || undefined,
    // Store individual prompt fields for restoration
    prompt: {
      greeting: state.prompt.greeting,
      instructions: state.prompt.instructions,
    },
    useMock: state.useMock ?? true,
    callHistoryEnabled: state.callHistoryEnabled ?? true,
    callLogEnabled: state.callLogEnabled ?? false,
  };
}
