/**
 * RAG Knowledge Base API Service
 */

import { apiRequest } from './apiClient';

export interface RAGSource {
  id: string;
  name: string;
  description: string;
  status: string;
  updatedAt: string;
  documentCount?: number;
  s3Prefix?: string;
  createdAt?: string;
  configuration?: Record<string, unknown>;
  userId?: string;
  userEmail?: string;
}

export interface CreateRAGSourceInput {
  name: string;
  description?: string;
}

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface RAGConfig {
  /** Bedrock Knowledge Base id, or "" when not configured yet. */
  kbId: string;
}

/** A Bedrock Knowledge Base that exists in the account (for selection). */
export interface AccountKnowledgeBase {
  id: string;
  name: string;
  status: string;
}

/** List Bedrock Knowledge Bases in the account so the user can pick one. */
export function listAccountKnowledgeBases(): Promise<AccountKnowledgeBase[]> {
  return apiRequest<AccountKnowledgeBase[]>('/rag/knowledge-bases');
}

/** Get the configured Knowledge Base id (empty string if not set). */
export function getRAGConfig(): Promise<RAGConfig> {
  return apiRequest<RAGConfig>('/rag/config');
}

/** Set (or clear, with "") the Knowledge Base id. */
export function setRAGConfig(kbId: string): Promise<RAGConfig> {
  return apiRequest<RAGConfig>('/rag/config', {
    method: 'PUT',
    body: JSON.stringify({ kbId }),
  });
}

export function listRAGSources(): Promise<RAGSource[]> {
  return apiRequest<RAGSource[]>('/rag');
}

export function getRAGSource(id: string): Promise<RAGSource> {
  return apiRequest<RAGSource>(`/rag/${id}`);
}

export function createRAGSource(data: CreateRAGSourceInput): Promise<RAGSource> {
  return apiRequest<RAGSource>('/rag', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteRAGSource(id: string): Promise<{ message: string; id: string }> {
  return apiRequest<{ message: string; id: string }>(`/rag/${id}`, {
    method: 'DELETE',
  });
}

export async function getUploadUrl(
  sourceId: string,
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; s3Key: string }> {
  return apiRequest<{ uploadUrl: string; s3Key: string }>(`/rag/${sourceId}/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  });
}

export interface RAGFile {
  filename: string;
  key: string;
  size: number;
  lastModified: string;
  downloadUrl: string;
}

export function listRAGFiles(sourceId: string): Promise<RAGFile[]> {
  return apiRequest<RAGFile[]>(`/rag/${sourceId}/files`);
}

export async function uploadDocument(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
}

export function syncRAGSource(id: string): Promise<{ message: string; jobId: string }> {
  return apiRequest<{ message: string; jobId: string }>(`/rag/${id}/sync`, {
    method: 'POST',
  });
}

export interface RAGCitation {
  text: string;
  /** Human-friendly source label (e.g. file name or URL). */
  source?: string;
  /** Backward-compatible alias for source. */
  location?: string;
  /** Relevance score, if provided. */
  score?: number | null;
}

export interface RAGQueryResult {
  answer: string;
  citations: RAGCitation[];
}

export function queryRAGSource(id: string, question: string): Promise<RAGQueryResult> {
  return apiRequest<RAGQueryResult>(`/rag/${id}/query`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}
