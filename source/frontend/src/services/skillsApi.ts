/**
 * Skills API Service
 * CRUD for skills (SKILL.md files) stored in DynamoDB with optional S3 upload.
 */

import { apiRequest } from './apiClient';

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'git' | 's3';
  url?: string;       // git repo URL
  path?: string;      // subdirectory in repo or S3 key
  s3Uri?: string;
  createdAt?: string;
  userId?: string;
  userEmail?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return apiRequest<T>(path, options);
}

export function listSkills(): Promise<Skill[]> {
  return request<Skill[]>('/skills');
}

export function createSkill(skill: Partial<Skill>): Promise<Skill> {
  return request<Skill>('/skills', {
    method: 'POST',
    body: JSON.stringify(skill),
  });
}

export function deleteSkill(id: string): Promise<void> {
  return request<void>(`/skills/${id}`, { method: 'DELETE' });
}

export async function uploadSkillFile(file: File): Promise<{ s3Uri: string; key: string }> {
  // Step 1: Get presigned URL from backend
  const { uploadUrl, key, s3Uri } = await request<{ uploadUrl: string; key: string; s3Uri: string }>('/skills/upload', {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type || 'text/markdown' }),
  });

  // Step 2: Upload file directly to S3 using presigned URL
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'text/markdown' },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error('Failed to upload file to S3');
  }

  return { s3Uri, key };
}
