export const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'project-5869a4b9-e007-42d4-b48';
export const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
export const BUCKET = process.env.MEDIA_BUCKET || `clipgen-${PROJECT_ID}-media`;

export const MODELS = {
  'veo-3.1-fast-generate-001': { label: 'Veo 3.1 Fast', usdPerSec: { '720p': 0.1, '1080p': 0.12 } },
  'veo-3.1-generate-001': { label: 'Veo 3.1 HQ', usdPerSec: { '720p': 0.4, '1080p': 0.4 } },
};

// Selectable output lengths (seconds). Veo generates 4/6/8s clips and extends by 7s per call.
export const LENGTHS = {
  4: { base: 4, extensions: 0 },
  6: { base: 6, extensions: 0 },
  8: { base: 8, extensions: 0 },
  15: { base: 8, extensions: 1 },
  20: { base: 8, extensions: 2 }, // 8 + 7 + 7 = 22s, trimmed to 20s
};
export const EXTENSION_SECONDS = 7;

export const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda']);
export const TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'];
export const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-2.5-flash';
export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Cost guards (override via env vars).
export const LIMITS = {
  genPerIpHour: Number(process.env.GEN_PER_IP_HOUR || 10),
  guestSecondsPerDay: Number(process.env.GUEST_SECONDS_PER_DAY || 30),
  userSecondsPerDay: Number(process.env.USER_SECONDS_PER_DAY || 120),
  aiCallsPerHour: Number(process.env.AI_CALLS_PER_HOUR || 30),
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD || 15),
};
