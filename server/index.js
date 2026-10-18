import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'project-5869a4b9-e007-42d4-b48';
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

// Cost guards (override via env vars).
const GEN_PER_IP_HOUR = Number(process.env.GEN_PER_IP_HOUR || 5);
const TTS_PER_IP_HOUR = Number(process.env.TTS_PER_IP_HOUR || 30);
const GEN_GLOBAL_PER_DAY = Number(process.env.GEN_GLOBAL_PER_DAY || 20);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_MODELS = new Set(['veo-3.1-fast-generate-001', 'veo-3.1-generate-001']);
const ALLOWED_DURATIONS = new Set([4, 6, 8]);
const TTS_MODELS = ['gemini-2.5-flash-tts', 'gemini-2.5-flash-preview-tts'];
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const db = new Firestore({ projectId: PROJECT_ID });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Persistent rate limiting (Firestore, shared across instances) ---

async function consume(key, limit, windowMs) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const ref = db.collection('ratelimits').doc(`${key}_${bucket}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data().count : 0;
    if (count >= limit) return false;
    tx.set(ref, { count: count + 1, expireAt: new Date((bucket + 2) * windowMs) });
    return true;
  });
}

function clientIp(req) {
  return req.ip || 'unknown';
}

function ipKey(req, scope) {
  const hash = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
  return `${scope}_${hash}`;
}

async function limitGenerate(req) {
  if (!(await consume(ipKey(req, 'gen'), GEN_PER_IP_HOUR, 3600_000))) {
    throw new HttpError(429, 'Too many video requests from your network. Try again later.');
  }
  if (!(await consume('gen_global', GEN_GLOBAL_PER_DAY, 86_400_000))) {
    throw new HttpError(429, 'Daily generation limit reached. Please try again tomorrow.');
  }
}

async function limitTts(req) {
  if (!(await consume(ipKey(req, 'tts'), TTS_PER_IP_HOUR, 3600_000))) {
    throw new HttpError(429, 'Too many requests. Try again later.');
  }
}

// --- Validation ---

const OPERATION_RE = new RegExp(
  `^projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/` +
    `(${[...ALLOWED_MODELS].join('|')})/operations/[0-9a-fA-F-]{8,64}$`
);

function requireOperation(name) {
  if (typeof name !== 'string' || !OPERATION_RE.test(name)) {
    throw new HttpError(400, 'Invalid operation.');
  }
  return name;
}

function parseImage(img, label) {
  if (!img) return null;
  if (typeof img.imageBytes !== 'string' || !img.imageBytes.length) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  if (!IMAGE_MIMES.has(img.mimeType)) {
    throw new HttpError(400, `${label} must be PNG, JPEG or WebP.`);
  }
  if (img.imageBytes.length * 0.75 > MAX_IMAGE_BYTES) {
    throw new HttpError(413, `${label} is too large (max 8 MB).`);
  }
  return { imageBytes: img.imageBytes, mimeType: img.mimeType };
}

// Convert upstream errors into messages that are safe to show to users.
function publicError(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  const code = Number(err?.status || err?.code || err?.error?.code);
  if (code === 429) return { status: 429, message: 'The model is busy or quota is exhausted. Try again shortly.' };
  if (code === 400) return { status: 400, message: 'The request was rejected (invalid input or blocked by safety filters).' };
  if (code === 403 || code === 404) return { status: 502, message: 'The video service is not available right now.' };
  return { status: 500, message: 'Internal server error.' };
}

// --- Handlers ---

async function handleGenerate(req, res) {
  const body = req.body || {};
  if (!ALLOWED_MODELS.has(body.model)) throw new HttpError(400, 'Model not allowed.');

  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000).trim() : '';
  const sourceImage = parseImage(body.image, 'Start frame');
  const lastFrame = parseImage(body.config?.lastFrame, 'End frame');
  if (!prompt && !sourceImage) throw new HttpError(400, 'Prompt or start frame required.');
  if (lastFrame && !sourceImage) throw new HttpError(400, 'End frame requires a start frame.');

  const resolution = body.config?.resolution === '1080p' ? '1080p' : '720p';
  const requested = Number(body.config?.durationSeconds);
  let durationSeconds = ALLOWED_DURATIONS.has(requested) ? requested : 8;
  // Veo 3.1: 1080p and first/last-frame interpolation only support 8 seconds.
  if (resolution === '1080p' || lastFrame) durationSeconds = 8;

  const config = {
    numberOfVideos: 1,
    resolution,
    aspectRatio: body.config?.aspectRatio === '9:16' ? '9:16' : '16:9',
    durationSeconds,
  };
  if (lastFrame) config.lastFrame = lastFrame;

  const payload = { model: body.model, prompt: prompt || 'A high quality video', config };
  if (sourceImage) payload.image = sourceImage;

  await limitGenerate(req);
  const operation = await ai.models.generateVideos(payload);
  return res.json({ name: operation.name, durationSeconds });
}

async function fetchOperation(name) {
  return ai.operations.getVideosOperation({ operation: { name } });
}

async function handleStatus(req, res) {
  const operation = await fetchOperation(requireOperation(req.body?.name));
  if (operation.error) {
    console.error('operation error:', JSON.stringify(operation.error));
    return res.json({ done: true, error: 'Generation failed (the content may have been blocked by safety filters).' });
  }
  return res.json({ done: !!operation.done });
}

async function fetchMediaBytes(uri) {
  const gs = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!gs) throw new Error('Unsupported video location.');
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${gs[1]}/o/${encodeURIComponent(gs[2])}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function handleVideo(req, res) {
  const operation = await fetchOperation(requireOperation(req.body?.name));
  if (!operation.done) throw new HttpError(409, 'Video is not ready yet.');
  if (operation.error) {
    console.error('operation error:', JSON.stringify(operation.error));
    throw new HttpError(422, 'Generation failed.');
  }
  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new HttpError(404, 'No video found in the result (it may have been filtered).');

  let bytes = null;
  if (typeof video.videoBytes === 'string' && video.videoBytes.length) {
    bytes = Buffer.from(video.videoBytes, 'base64');
  } else if (typeof video.uri === 'string' && video.uri.length) {
    bytes = await fetchMediaBytes(video.uri);
  }
  if (!bytes) throw new HttpError(404, 'Video data unavailable.');

  res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'no-store');
  return res.send(bytes);
}

async function handleTts(req, res) {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.slice(0, 1000).trim() : '';
  if (!prompt) throw new HttpError(400, 'Prompt required.');
  await limitTts(req);

  let lastError = null;
  for (const model of TTS_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audio) return res.json({ audio });
      lastError = new Error('TTS produced no audio.');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('TTS failed.');
}

const routes = { '/generate': handleGenerate, '/status': handleStatus, '/video': handleVideo, '/tts': handleTts };

async function apiHandler(req, res) {
  const p = (req.path || '').replace(/\/+$/, '');
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const handler = routes[p];
    if (!handler) throw new HttpError(404, 'Not found.');
    return await handler(req, res);
  } catch (err) {
    console.error('api error:', p, err);
    const { status, message } = publicError(err);
    if (!res.headersSent) return res.status(status).json({ error: message });
    return undefined;
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(
  '/api',
  express.json({ limit: '24mb' }),
  (err, _req, res, next) => {
    if (!err) return next();
    const status = err.type === 'entity.too.large' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Request too large.' : 'Invalid request.' });
  },
  apiHandler
);

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(process.env.PORT || 8080);
