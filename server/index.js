import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, publicError } from './lib/errors.js';
import { requireUser } from './lib/firebase.js';
import { guardAi } from './lib/limits.js';
import { enhancePrompt, synthesizeSpeech } from './lib/gemini.js';
import { createJob, advanceJob, listClips, getClip, deleteClip } from './lib/pipeline.js';
import { VOICES } from './lib/config.js';

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

api.post('/tts', wrap(async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 600).trim() : '';
  if (!text) throw new HttpError(400, 'Narration text required.');
  const voice = VOICES.has(req.body?.voice) ? req.body.voice : 'Kore';
  await guardAi(req);
  const pcm = await synthesizeSpeech(text, voice);
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
