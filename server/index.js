import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, publicError } from './lib/errors.js';
import { requireUser } from './lib/firebase.js';
import { guardAi } from './lib/limits.js';
import { enhancePrompt, synthesizeSpeech, directBrief } from './lib/gemini.js';
import { createJob, advanceJob, listClips, getClip, deleteClip, parseImage } from './lib/pipeline.js';
import { listKits, getKit, createKit, updateKit, setLogo, deleteKit } from './lib/brand.js';
import { VOICES, LANGUAGES, LENGTHS, PLATFORMS, SPEECH_STYLES } from './lib/config.js';

const PLATFORM_LABELS = {
  tiktok: 'TikTok', reels: 'Instagram Reels', shopee: 'Shopee Video', shorts: 'YouTube Shorts', feed: 'Facebook and website feeds',
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const api = express.Router();

api.use(express.json({ limit: '24mb' }));
api.get('/health', (_req, res) => res.json({ ok: true }));
api.use(requireUser);

// --- Video jobs: Veo base clip -> extensions -> ffmpeg master (+ Gemini narration) ---
api.post('/jobs', wrap(async (req, res) => res.json({ id: await createJob(req) })));
api.get('/jobs/:id', wrap(async (req, res) => res.json(await advanceJob(req.params.id, req.user.uid))));

// --- Library (Firestore metadata + Cloud Storage media) ---
api.get('/clips', wrap(async (req, res) => res.json({ clips: await listClips(req.user.uid) })));
api.get('/clips/:id', wrap(async (req, res) => res.json(await getClip(req.user.uid, req.params.id))));
api.delete('/clips/:id', wrap(async (req, res) => {
  await deleteClip(req.user.uid, req.params.id);
  res.json({ ok: true });
}));

// --- Gemini helpers ---
api.post('/enhance', wrap(async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.slice(0, 800).trim() : '';
  if (!prompt) throw new HttpError(400, 'Write a prompt first.');
  const style = typeof req.body?.style === 'string' ? req.body.style.slice(0, 300) : '';
  await guardAi(req);
  res.json({ prompt: await enhancePrompt(prompt, style) });
}));

// Creative director: brief + product photo + brand kit -> Veo prompt, voice-over, caption, hashtags.
api.post('/director', wrap(async (req, res) => {
  const body = req.body || {};
  const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, 400) : '';
  if (!brief) throw new HttpError(400, 'Write a short brief first, for example: kopi susu gula aren, vibe pagi hari.');
  if (!LANGUAGES[body.language]) throw new HttpError(400, 'Unsupported language.');
  const length = Number(body.length);
  if (!LENGTHS[length]) throw new HttpError(400, 'Unsupported length.');
  const image = parseImage(body.image, 'Product photo');
  const platform = PLATFORMS.has(body.platform) ? body.platform : 'tiktok';
  const brand = body.brandKitId ? await getKit(req.user.uid, String(body.brandKitId).slice(0, 64)) : null;
  await guardAi(req);
  const plan = await directBrief({
    brief, languageId: body.language, image, brand, length,
    aspectRatio: body.aspectRatio === '16:9' ? '16:9' : '9:16',
    platformLabel: PLATFORM_LABELS[platform],
  });
  res.json(plan);
}));

// --- Brand kits (Firestore) ---
api.get('/brandkits', wrap(async (req, res) => res.json({ kits: await listKits(req.user.uid) })));
api.post('/brandkits', wrap(async (req, res) => res.json(await createKit(req.user.uid, req.body))));
api.put('/brandkits/:id', wrap(async (req, res) => res.json(await updateKit(req.user.uid, req.params.id, req.body))));
api.put('/brandkits/:id/logo', wrap(async (req, res) => res.json(await setLogo(req.user.uid, req.params.id, req.body || {}))));
api.delete('/brandkits/:id', wrap(async (req, res) => {
  await deleteKit(req.user.uid, req.params.id);
  res.json({ ok: true });
}));

api.post('/tts', wrap(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 600).trim() : '';
  if (!text) throw new HttpError(400, 'Narration text required.');
  const voice = VOICES.has(req.body?.voice) ? req.body.voice : 'Kore';
  const style = SPEECH_STYLES[req.body?.style] !== undefined ? req.body.style : 'neutral';
  await guardAi(req);
  const pcm = await synthesizeSpeech(text, voice, style);
  res.json({ audio: pcm.toString('base64') });
}));

api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
api.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error('api error:', req.method, req.path, err);
  const { status, message } = publicError(err);
  return res.status(status).json({ error: message });
});
app.use('/api', api);

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(process.env.PORT || 8080);
