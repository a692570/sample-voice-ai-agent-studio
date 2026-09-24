/**
 * Service to call the Generate Prompt API.
 *
 * Sends workflow canvas data (nodes, edges, tools) to a backend Lambda
 * that uses Amazon Bedrock (Claude) to produce a polished, structured
 * system prompt with example interaction flows.
 */

import { apiRequest } from './apiClient';

export interface GeneratePromptRequest {
  workflow: {
    nodes: any[];
    edges: any[];
  };
  tools: string[];
  /** Optional context to help the LLM personalize the prompt */
  context?: Record<string, string>;
}

export interface GeneratePromptResponse {
  systemPrompt: string;
  tools: string[];
}

/**
 * Sends workflow data to the backend which calls Amazon Bedrock (Claude)
 * to generate a well-structured, production-ready system prompt.
 */
export async function generatePromptFromApi(request: GeneratePromptRequest): Promise<GeneratePromptResponse> {
  return apiRequest<GeneratePromptResponse>('/generate-prompt', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
