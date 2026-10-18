import { auth } from './firebase';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Please sign in or continue as a guest.', 401);
  const token = await user.getIdToken(retried);
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && !retried) return request<T>(path, init, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status);
  return data as T;
}

export interface ImageInput { imageBytes: string; mimeType: string }

export interface CreateJobPayload {
  model: string;
  prompt: string;
  preset: string | null;
  length: number;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  image?: ImageInput;
  lastFrame?: ImageInput;
  narration?: { text: string; voice: string } | null;
}

export interface JobView {
  id: string;
  status: 'running' | 'done' | 'error';
  stage: string;
  stageNumber: number;
  totalStages: number;
  extIndex: number;
  extensions: number;
  narration: boolean;
  error: string | null;
  clipId: string | null;
}

export interface Clip {
  id: string;
  url: string;
  downloadUrl: string;
  prompt: string;
  preset: string | null;
  model: string;
  resolution: string;
  aspectRatio: string;
  length: number;
  narration: boolean;
  createdAt: number;
}

export const createJob = (payload: CreateJobPayload) =>
  request<{ id: string }>('/jobs', { method: 'POST', body: JSON.stringify(payload) });
export const getJob = (id: string) => request<JobView>(`/jobs/${id}`);
export const getClip = (id: string) => request<Clip>(`/clips/${id}`);
export const listClips = () => request<{ clips: Clip[] }>('/clips');
export const deleteClip = (id: string) => request<{ ok: true }>(`/clips/${id}`, { method: 'DELETE' });
export const enhancePrompt = (prompt: string, style: string) =>
  request<{ prompt: string }>('/enhance', { method: 'POST', body: JSON.stringify({ prompt, style }) });
export const speak = (text: string, voice: string) =>
  request<{ audio: string }>('/tts', { method: 'POST', body: JSON.stringify({ text, voice }) });
