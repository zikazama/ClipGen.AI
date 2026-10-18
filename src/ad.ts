export interface AdLanguage { id: 'id' | 'en' | 'jv' | 'su'; label: string; beta: boolean }

/** Narration languages. Javanese and Sundanese are beta: they are not on Google's official TTS language list. */
export const AD_LANGUAGES: AdLanguage[] = [
  { id: 'id', label: 'Bahasa Indonesia', beta: false },
  { id: 'en', label: 'English', beta: false },
  { id: 'jv', label: 'Basa Jawa', beta: true },
  { id: 'su', label: 'Basa Sunda', beta: true },
];

export interface AdPlatform {
  id: 'tiktok' | 'reels' | 'shopee' | 'shorts' | 'feed';
  label: string;
  aspectRatio: '16:9' | '9:16';
  /** Suggested clip length in seconds. */
  length: number;
}

export const AD_PLATFORMS: AdPlatform[] = [
  { id: 'tiktok', label: 'TikTok', aspectRatio: '9:16', length: 15 },
  { id: 'reels', label: 'Instagram Reels', aspectRatio: '9:16', length: 20 },
  { id: 'shopee', label: 'Shopee Video', aspectRatio: '9:16', length: 15 },
  { id: 'shorts', label: 'YouTube Shorts', aspectRatio: '9:16', length: 20 },
  { id: 'feed', label: 'Facebook / website', aspectRatio: '16:9', length: 15 },
];

export const findPlatform = (id: string) => AD_PLATFORMS.find(p => p.id === id) ?? AD_PLATFORMS[0];

export const SPEECH_STYLES = [
  { id: 'upbeat', label: 'Upbeat' },
  { id: 'calm', label: 'Calm' },
  { id: 'dramatic', label: 'Dramatic' },
  { id: 'neutral', label: 'Neutral' },
] as const;

export const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'];

/** Words a script may contain for a clip of the given length (about 1.7 spoken words per second). */
export const maxScriptWords = (length: number) => Math.max(6, Math.floor((length - 1) * 1.7));
export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
