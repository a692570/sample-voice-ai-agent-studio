import React, { createContext, useContext, useReducer, ReactNode } from 'react';

export type PipelineType = 'speech-to-speech' | 'cascaded' | null;
export type PathType = 'minimal' | 'some-technical' | 'significant-technical' | null;
export type HostType = 'agentcore' | 'eks' | 'ecs';
export type FrameworkType = 'strands-bidiagent' | 'pipecat' | 'livekit';

export interface VoiceConfig {
  language: string;
  gender: string;
  voiceId: string;
}

export interface CascadedConfig {
  sttProvider: string; // 'transcribe' | 'deepgram'
  llmProvider: string; // 'nova-lite' | 'gpt'
  ttsProvider: string; // 'polly' | 'eleven-labs'
  preset: 'aws-opinionated' | '3p-opinionated' | 'custom' | null;
}

export interface CustomToolDef {
  name: string;
  description: string;
  parameters: string; // JSON schema or comma-separated param names
  mockResponse: string;
}

export interface AgentConfig {
  selectedAgents: string[];
  tools: string[];
  customTools: CustomToolDef[];
}

export interface PromptConfig {
  greeting: string;
  instructions: string;
}

export interface WizardState {
  path: PathType;
  pipeline: PipelineType;
  host: HostType;
  framework: FrameworkType;
  model: string[];
  voice: VoiceConfig;
  cascaded: CascadedConfig;
  agents: AgentConfig;
  prompt: PromptConfig;
  telephonyEnabled: boolean;
  agentStartFirst: boolean;
  phoneNumber: string;
  sipPhoneNumber: string;
  apiKeys: {
    openai: string;
    gemini: string;
  };
  workflow: any | null;
  useMock: boolean; // When true, tools use mock responses
  callHistoryEnabled: boolean; // When true, agent captures conversation history (transcript + audio)
  callLogEnabled: boolean; // When true, agent captures raw event log (JSONL debug stream)
  inferenceConfig: {
    temperature: number;
    topP: number;
    maxTokens: number;
  };
  editingDemoId: string | null; // When editing an existing agent, stores its ID
  editingDemoName: string | null; // The agent's name (for display in save)
}

const initialState: WizardState = {
  path: null,
  pipeline: null,
  host: 'agentcore',
  framework: 'strands-bidiagent',
  model: ['nova-2-sonic'],
  voice: {
    language: 'en-US',
    gender: 'female',
    voiceId: '',
  },
  cascaded: {
    sttProvider: 'transcribe',
    llmProvider: 'nova-lite',
    ttsProvider: 'polly',
    preset: null,
  },
  agents: {
    selectedAgents: ['endCallTool', 'transferCall'],
    tools: [],
    customTools: [],
  },
  prompt: {
    greeting: '',
    instructions: '',
  },
  telephonyEnabled: true,
  agentStartFirst: true,
  phoneNumber: '',
  sipPhoneNumber: '',
  apiKeys: {
    openai: '',
    gemini: '',
  },
  workflow: null,
  useMock: true,
  callHistoryEnabled: true,
  callLogEnabled: false,
  inferenceConfig: {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 512,
  },
  editingDemoId: null,
  editingDemoName: null,
};

type Action =
  | { type: 'SET_PATH'; payload: PathType }
  | { type: 'SET_PIPELINE'; payload: PipelineType }
  | { type: 'SET_HOST'; payload: HostType }
  | { type: 'SET_FRAMEWORK'; payload: FrameworkType }
  | { type: 'SET_MODEL'; payload: string[] }
  | { type: 'SET_VOICE'; payload: Partial<VoiceConfig> }
  | { type: 'SET_CASCADED'; payload: Partial<CascadedConfig> }
  | { type: 'SET_AGENTS'; payload: Partial<AgentConfig> }
  | { type: 'SET_PROMPT'; payload: Partial<PromptConfig> }
  | { type: 'SET_TELEPHONY_ENABLED'; payload: boolean }
  | { type: 'SET_AGENT_START_FIRST'; payload: boolean }
  | { type: 'SET_PHONE'; payload: string }
  | { type: 'SET_SIP_PHONE'; payload: string }
  | { type: 'SET_API_KEYS'; payload: Partial<{ openai: string; gemini: string }> }
  | { type: 'SET_WORKFLOW'; payload: any }
  | { type: 'SET_USE_MOCK'; payload: boolean }
  | { type: 'SET_CALL_HISTORY_ENABLED'; payload: boolean }
  | { type: 'SET_CALL_LOG_ENABLED'; payload: boolean }
  | { type: 'SET_INFERENCE_CONFIG'; payload: Partial<{ temperature: number; topP: number; maxTokens: number }> }
  | { type: 'SET_EDITING_DEMO'; payload: { id: string; name: string } | null }
  | { type: 'RESET' };

function wizardReducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_PATH':
      return { ...state, path: action.payload };
    case 'SET_PIPELINE':
      return { ...state, pipeline: action.payload };
    case 'SET_HOST':
      return { ...state, host: action.payload };
    case 'SET_FRAMEWORK':
      return { ...state, framework: action.payload };
    case 'SET_MODEL':
      return { ...state, model: action.payload };
    case 'SET_VOICE':
      return { ...state, voice: { ...state.voice, ...action.payload } };
    case 'SET_CASCADED':
      return { ...state, cascaded: { ...state.cascaded, ...action.payload } };
    case 'SET_AGENTS':
      return { ...state, agents: { ...state.agents, ...action.payload } };
    case 'SET_PROMPT':
      return { ...state, prompt: { ...state.prompt, ...action.payload } };
    case 'SET_TELEPHONY_ENABLED':
      return { ...state, telephonyEnabled: action.payload };
    case 'SET_AGENT_START_FIRST':
      return { ...state, agentStartFirst: action.payload };
    case 'SET_PHONE':
      return { ...state, phoneNumber: action.payload };
    case 'SET_SIP_PHONE':
      return { ...state, sipPhoneNumber: action.payload };
    case 'SET_API_KEYS':
      return { ...state, apiKeys: { ...state.apiKeys, ...action.payload } };
    case 'SET_WORKFLOW':
      return { ...state, workflow: action.payload };
    case 'SET_USE_MOCK':
      return { ...state, useMock: action.payload };
    case 'SET_CALL_HISTORY_ENABLED':
      return { ...state, callHistoryEnabled: action.payload };
    case 'SET_CALL_LOG_ENABLED':
      return { ...state, callLogEnabled: action.payload };
    case 'SET_INFERENCE_CONFIG':
      return { ...state, inferenceConfig: { ...state.inferenceConfig, ...action.payload } };
    case 'SET_EDITING_DEMO':
      return { ...state, editingDemoId: action.payload?.id || null, editingDemoName: action.payload?.name || null };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

interface WizardContextType {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
}

export const WizardContext = createContext<WizardContextType | undefined>(undefined);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return context;
}
