import { HttpError } from './errors.js';
import {
  MODELS, LENGTHS, GUEST_MODEL, GUEST_MAX_LENGTH, VOICES, IMAGE_MIMES, MAX_IMAGE_BYTES,
  LANGUAGES, PLATFORMS, PERSON_GENERATION, SPEECH_STYLES,
} from './config.js';

/**
 * Validates an uploaded image. Pure: no Firestore, no network.
 */
export function parseImage(img, label) {
  if (!img) return null;
  if (typeof img.imageBytes !== 'string' || !img.imageBytes.length) throw new HttpError(400, `Invalid ${label}.`);
  if (!IMAGE_MIMES.has(img.mimeType)) throw new HttpError(400, `${label} must be PNG, JPEG or WebP.`);
  if (img.imageBytes.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(413, `${label} is too large (max 8 MB).`);
  return { imageBytes: img.imageBytes, mimeType: img.mimeType };
}

/**
 * Turns a request body into the parameters the pipeline uses.
 *
 * Pure on purpose: every rule below is a security or cost rule, so it can be unit tested
 * without Firestore or Vertex AI.
 */
export function validate(body, user) {
  const model = MODELS[body.model] ? body.model : null;
  if (!model) throw new HttpError(400, 'Model not allowed.');

  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 1800).trim() : '';
  const image = parseImage(body.image, 'Start frame');
  const lastFrame = parseImage(body.lastFrame, 'End frame');
  if (!prompt && !image) throw new HttpError(400, 'Prompt or start frame required.');
  if (lastFrame && !image) throw new HttpError(400, 'End frame requires a start frame.');

  const length = Number(body.length);
  const plan = LENGTHS[length];
  if (!plan) throw new HttpError(400, 'Unsupported length.');
  if (user?.guest && (model !== GUEST_MODEL || length > GUEST_MAX_LENGTH)) {
    throw new HttpError(403, 'Guests can make one Fast draft up to 8 seconds a day. Sign in to unlock HQ and longer clips.');
  }
  if (lastFrame && plan.base !== 8) throw new HttpError(400, 'An end frame needs a clip length of 8s or more.');

  // Veo 3.1: 1080p and first/last-frame interpolation only support 8s base clips.
  const resolution = body.resolution === '1080p' && plan.base === 8 ? '1080p' : '720p';

  let narration = null;
  if (body.narration && typeof body.narration.text === 'string' && body.narration.text.trim()) {
    narration = {
      text: body.narration.text.slice(0, 600).trim(),
      voice: VOICES.has(body.narration.voice) ? body.narration.voice : 'Kore',
      style: SPEECH_STYLES[body.narration.style] !== undefined ? body.narration.style : 'neutral',
    };
  }

  // Optional product-ad metadata produced by the creative director (stored with the clip).
  let ad = null;
  if (body.ad && typeof body.ad === 'object') {
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    ad = {
      brief: str(body.ad.brief, 400),
      caption: str(body.ad.caption, 300),
      hashtags: (Array.isArray(body.ad.hashtags) ? body.ad.hashtags : []).map((h) => str(h, 30)).filter(Boolean).slice(0, 8),
      language: LANGUAGES[body.ad.language] ? body.ad.language : null,
      platform: PLATFORMS.has(body.ad.platform) ? body.ad.platform : null,
      directed: body.ad.directed === true,
    };
  }

  return {
    model,
    prompt: prompt || 'A high quality cinematic video',
    image, lastFrame, length, plan, resolution, narration, ad, sound: body.sound !== false,
    brandKitId: typeof body.brandKitId === 'string' ? body.brandKitId.slice(0, 64) : null,
    useLogo: body.useLogo === true,
    aspectRatio: body.aspectRatio === '9:16' ? '9:16' : '16:9',
    preset: typeof body.preset === 'string' ? body.preset.slice(0, 60) : null,
    personGeneration: PERSON_GENERATION.has(body.personGeneration) ? body.personGeneration : 'dont_allow',
  };
}
