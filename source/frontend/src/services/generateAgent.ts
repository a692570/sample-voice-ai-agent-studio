/**
 * Service to call Bedrock LLM via backend API for auto-generating
 * agent configuration from a use case description.
 */

import { apiRequest } from './apiClient';

export interface GeneratedAgentConfig {
  host: 'agentcore' | 'eks' | 'ecs';
  framework: 'strands-bidiagent' | 'pipecat' | 'livekit';
  model: string[];
  pipeline: 'speech-to-speech' | 'cascaded';
  tools: string[];
  voice: {
    voiceId: string;
    language: string;
    gender: string;
  };
  prompt: {
    greeting: string;
    instructions: string;
  };
}

/**
 * Sends the user's use case description to the backend which calls
 * Amazon Bedrock (Claude) to generate a complete agent configuration.
 */
export async function generateAgentConfig(description: string): Promise<GeneratedAgentConfig> {
  return apiRequest<GeneratedAgentConfig>('/generate-agent', {
    method: 'POST',
    body: JSON.stringify({ description }),
  });
}
