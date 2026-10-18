export const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'project-5869a4b9-e007-42d4-b48';
export const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
export const BUCKET = process.env.MEDIA_BUCKET || `clipgen-${PROJECT_ID}-media`;

export const MODELS = {
  'veo-3.1-fast-generate-001': { label: 'Veo 3.1 Fast' },
  'veo-3.1-generate-001': { label: 'Veo 3.1 HQ' },
};

// Guests get one free Fast draft (8 s); HQ and longer clips need an account.
export const GUEST_MODEL = 'veo-3.1-fast-generate-001';
export const GUEST_MAX_LENGTH = 8;

// Selectable output lengths (seconds). Veo generates 4/6/8s clips and extends by 7s per call.
export const LENGTHS = {
  4: { base: 4, extensions: 0 },
  6: { base: 6, extensions: 0 },
  8: { base: 8, extensions: 0 },
  15: { base: 8, extensions: 1 },
  20: { base: 8, extensions: 2 }, // 8 + 7 + 7 = 22s, trimmed to 20s
};

export const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda']);
export const TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'];
export const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-2.5-flash';
export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_LOGO_BYTES = 1024 * 1024;

// Narration languages. Gemini TTS detects the language from the text; Javanese and Sundanese are
// not on Google's official TTS language list, so they are exposed as beta.
export const LANGUAGES = {
  id: { label: 'Bahasa Indonesia', gemini: 'Indonesian', beta: false, note: 'Casual, friendly Bahasa Indonesia as used on TikTok.' },
  en: { label: 'English', gemini: 'English', beta: false, note: '' },
  jv: {
    label: 'Basa Jawa', gemini: 'Javanese (Latin script)', beta: true,
    note: 'Write real Javanese (ngoko, Latin script), NOT Indonesian. Use Javanese words such as: seger, saben esuk, ayo, pesen, saiki, kowe, iki, enak, tenan, murah, wareg, mbois. Never use Indonesian forms like "segerin", "harimu", "cobain" or "sekarang".',
  },
  su: {
    label: 'Basa Sunda', gemini: 'Sundanese (Latin script)', beta: true,
    note: 'Write real Sundanese (loma, Latin script), NOT Indonesian. Use Sundanese words such as: seger, unggal isuk, hayu, pesen, ayeuna, anjeun, ieu, raos, pisan, mirah, wareg. Never use Indonesian forms like "segerin", "harimu", "cobain" or "sekarang".',
  },
};

// Spoken style hints (the TTS model follows "Say ...:" instructions without reading them aloud).
export const SPEECH_STYLES = {
  neutral: '',
  upbeat: 'Say in a warm, upbeat, friendly voice: ',
  calm: 'Say in a calm, reassuring voice: ',
  dramatic: 'Say in a dramatic, cinematic trailer voice: ',
};

export const PLATFORMS = new Set(['tiktok', 'reels', 'shopee', 'shorts', 'feed']);

// Average speaking rate measured on Gemini TTS output (~1.8 words/s); used to cap script length.
export const WORDS_PER_SECOND = 1.7;
export const maxScriptWords = (lengthSeconds) => Math.max(6, Math.floor((lengthSeconds - 1) * WORDS_PER_SECOND));

// Cost guards (override via env vars).
export const LIMITS = {
  genPerIpHour: Number(process.env.GEN_PER_IP_HOUR || 10),
  guestSecondsPerDay: Number(process.env.GUEST_SECONDS_PER_DAY || 8),
  userSecondsPerDay: Number(process.env.USER_SECONDS_PER_DAY || 120),
  aiCallsPerHour: Number(process.env.AI_CALLS_PER_HOUR || 30),
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD || 15),
  maxBrandKits: 5,
};
