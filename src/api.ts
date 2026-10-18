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
  narration?: { text: string; voice: string; style?: string } | null;
  sound?: boolean;
  brandKitId?: string | null;
  useLogo?: boolean;
  ad?: {
    brief: string; caption: string; hashtags: string[];
    language: string | null; platform: string | null; directed: boolean;
  } | null;
}

export interface DirectorPlan {
  title: string;
  veoPrompt: string;
  voiceover: string;
  caption: string;
  hashtags: string[];
  maxWords: number;
}

export interface BrandKit {
  id: string;
  name: string;
  tone: string;
  audience: string;
  colors: string[];
  language: string;
  hasLogo: boolean;
  logoUrl: string | null;
}
export type BrandKitInput = Pick<BrandKit, 'name' | 'tone' | 'audience' | 'colors' | 'language'>;

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
  logo?: boolean;
  costUsd?: number | null;
  ad?: {
    brief: string; caption: string; hashtags: string[];
    language: string | null; platform: string | null; directed: boolean;
  } | null;
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
export const speak = (text: string, voice: string, style = 'neutral') =>
  request<{ audio: string }>('/tts', { method: 'POST', body: JSON.stringify({ text, voice, style }) });

export const direct = (payload: {
  brief: string; language: string; platform: string; length: number; aspectRatio: string;
  brandKitId?: string | null; image?: ImageInput;
}) => request<DirectorPlan>('/director', { method: 'POST', body: JSON.stringify(payload) });

export const listBrandKits = () => request<{ kits: BrandKit[] }>('/brandkits');
export const createBrandKit = (kit: BrandKitInput) =>
  request<BrandKit>('/brandkits', { method: 'POST', body: JSON.stringify(kit) });
export const updateBrandKit = (id: string, kit: BrandKitInput) =>
  request<BrandKit>(`/brandkits/${id}`, { method: 'PUT', body: JSON.stringify(kit) });
export const uploadBrandLogo = (id: string, imageBytes: string) =>
  request<BrandKit>(`/brandkits/${id}/logo`, { method: 'PUT', body: JSON.stringify({ imageBytes, mimeType: 'image/png' }) });
export const deleteBrandKit = (id: string) => request<{ ok: true }>(`/brandkits/${id}`, { method: 'DELETE' });
