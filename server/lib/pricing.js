// Single source of truth for cost estimates on the server. src/pricing.ts mirrors these numbers
// (a unit test keeps the two in sync). Figures are USD list-price estimates: verify before budgeting.
// "audio" = Veo generates native sound (default); "silent" = video only, which Google bills lower.

export const VEO_USD_PER_SEC = {
  'veo-3.1-fast-generate-001': {
    audio: { '720p': 0.1, '1080p': 0.12 },
    silent: { '720p': 0.1, '1080p': 0.1 },
  },
  'veo-3.1-generate-001': {
    audio: { '720p': 0.4, '1080p': 0.4 },
    silent: { '720p': 0.2, '1080p': 0.2 },
  },
};

// Gemini 2.5 Flash director (~1k tokens in, ~600 out) and Gemini 2.5 Flash TTS (20 s voice-over).
export const GEMINI_USD_PER_CLIP = { director: 0.002, tts: 0.005 };

export const EXTENSION_SECONDS = 7;

export function veoSeconds(plan) {
  return plan.base + plan.extensions * EXTENSION_SECONDS;
}

/** Cost estimate for one finished clip. */
export function estimateCost({ model, resolution, plan, narration, director, sound = true }) {
  const seconds = veoSeconds(plan);
  const veoUsd = seconds * VEO_USD_PER_SEC[model][sound ? 'audio' : 'silent'][resolution];
  const geminiUsd = (narration ? GEMINI_USD_PER_CLIP.tts : 0) + (director ? GEMINI_USD_PER_CLIP.director : 0);
  return { veoSeconds: seconds, veoUsd, geminiUsd, totalUsd: veoUsd + geminiUsd };
}
