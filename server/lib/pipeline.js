import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, bucket } from './firebase.js';
import { HttpError } from './errors.js';
import * as veo from './veo.js';
import { synthesizeSpeech } from './gemini.js';
import { finalizeVideo } from './media.js';
import {
  MODELS, LENGTHS, GUEST_MODEL, GUEST_MAX_LENGTH, VOICES, IMAGE_MIMES, MAX_IMAGE_BYTES, LANGUAGES, PLATFORMS, SPEECH_STYLES,
} from './config.js';
import { estimateCost } from './pricing.js';
import { getKit, readLogo } from './brand.js';
import { guardGeneration } from './limits.js';

const LOCK_MS = 120_000;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;
const jobs = () => db.collection('jobs');
const clips = (uid) => db.collection('users').doc(uid).collection('clips');

export function parseImage(img, label) {
  if (!img) return null;
  if (typeof img.imageBytes !== 'string' || !img.imageBytes.length) throw new HttpError(400, `Invalid ${label}.`);
  if (!IMAGE_MIMES.has(img.mimeType)) throw new HttpError(400, `${label} must be PNG, JPEG or WebP.`);
  if (img.imageBytes.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(413, `${label} is too large (max 8 MB).`);
  return { imageBytes: img.imageBytes, mimeType: img.mimeType };
}

function validate(body, user) {
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
  };
}

export async function createJob(req) {
  const v = validate(req.body || {}, req.user);
  const cost = estimateCost({ model: v.model, resolution: v.resolution, plan: v.plan, narration: !!v.narration, director: !!v.ad?.directed, sound: v.sound });
  await guardGeneration(req, { seconds: cost.veoSeconds, costUsd: cost.totalUsd });

  let kit = null;
  if (v.brandKitId) kit = await getKit(req.user.uid, v.brandKitId);

  const id = crypto.randomUUID();
  const operation = await veo.startVideo({
    model: v.model, prompt: v.prompt, image: v.image, lastFrame: v.lastFrame,
    aspectRatio: v.aspectRatio, resolution: v.resolution, durationSeconds: v.plan.base, sound: v.sound,
    outputPrefix: `jobs/${id}/s0/`,
  });

  await jobs().doc(id).set({
    uid: req.user.uid,
    status: 'running',
    stage: 'base',
    extIndex: 0,
    operation,
    currentUri: null,
    lockUntil: 0,
    createdAt: FieldValue.serverTimestamp(),
    params: {
      model: v.model, prompt: v.prompt, aspectRatio: v.aspectRatio, resolution: v.resolution,
      length: v.length, extensions: v.plan.extensions, narration: v.narration, sound: v.sound, preset: v.preset,
      hasImage: !!v.image, hasLastFrame: !!v.lastFrame, estimatedUsd: Number(cost.totalUsd.toFixed(2)),
      cost, ad: v.ad,
      brandKitId: kit ? kit.id : null,
      logoPath: kit && v.useLogo && kit.logoPath ? kit.logoPath : null,
    },
  });
  return id;
}

function view(id, job) {
  const totalStages = job.params.extensions + 2; // base + extensions + finalize
  let stageNumber = totalStages;
  if (job.status === 'running') {
    stageNumber = job.stage === 'base' ? 1 : job.stage === 'extend' ? 1 + job.extIndex : totalStages;
  }
  return {
    id,
    status: job.status,
    stage: job.stage,
    stageNumber,
    totalStages,
    extIndex: job.extIndex,
    extensions: job.params.extensions,
    narration: !!job.params.narration,
    error: job.error || null,
    clipId: job.clipId || null,
  };
}

async function acquire(id) {
  return db.runTransaction(async (tx) => {
    const ref = jobs().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const job = snap.data();
    if (job.status !== 'running' || job.lockUntil > Date.now()) return { job, locked: true };
    tx.update(ref, { lockUntil: Date.now() + LOCK_MS });
    return { job, locked: false };
  });
}

async function fail(id, message) {
  await jobs().doc(id).update({ status: 'error', error: message, lockUntil: 0 });
}

async function readObject(uri) {
  const m = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m || m[1] !== bucket.name) throw new Error('Unexpected video location.');
  const [buf] = await bucket.file(m[2]).download();
  return buf;
}

async function finalize(id, job) {
  const { params } = job;
  const narrationPcm = params.narration
    ? await synthesizeSpeech(params.narration.text, params.narration.voice, params.narration.style)
    : null;
  const logoPng = params.logoPath ? await readLogo({ logoPath: params.logoPath }) : null;
  const source = await readObject(job.currentUri);
  const mp4 = await finalizeVideo({ videoBuffer: source, seconds: params.length, narrationPcm, logoPng });

  const path = `final/${job.uid}/${id}.mp4`;
  await bucket.file(path).save(mp4, { contentType: 'video/mp4', resumable: false });
  await clips(job.uid).doc(id).set({
    path,
    prompt: params.prompt,
    preset: params.preset,
    model: params.model,
    resolution: params.resolution,
    aspectRatio: params.aspectRatio,
    length: params.length,
    narration: !!params.narration,
    logo: !!params.logoPath,
    costUsd: params.estimatedUsd,
    cost: params.cost,
    ad: params.ad || null,
    brandKitId: params.brandKitId || null,
    bytes: mp4.length,
    createdAt: FieldValue.serverTimestamp(),
  });
  await jobs().doc(id).update({ status: 'done', stage: 'done', clipId: id, lockUntil: 0 });
}

/**
 * Moves a job forward by at most one step. Safe to call from many pollers at once:
 * a Firestore lease makes sure only one caller advances a job at a time.
 */
export async function advanceJob(id, uid) {
  const first = await jobs().doc(id).get();
  if (!first.exists || first.data().uid !== uid) throw new HttpError(404, 'Job not found.');

  const held = await acquire(id);
  if (held && !held.locked) {
    const { job } = held;
    try {
      const op = await veo.getOperation(job.operation);
      if (!op.done) {
        await jobs().doc(id).update({ lockUntil: 0 });
      } else if (op.error) {
        await fail(id, op.error);
      } else if (job.extIndex < job.params.extensions) {
        const next = job.extIndex + 1;
        const operation = await veo.startVideo({
          model: job.params.model,
          prompt: `${job.params.prompt} Continue the scene naturally and seamlessly.`.slice(0, 2000),
          video: op.uri,
          resolution: job.params.resolution,
          sound: job.params.sound !== false,
          outputPrefix: `jobs/${id}/s${next}/`,
        });
        await jobs().doc(id).update({ stage: 'extend', extIndex: next, operation, currentUri: op.uri, lockUntil: 0 });
      } else {
        await jobs().doc(id).update({ stage: 'finalize', currentUri: op.uri });
        await finalize(id, { ...job, stage: 'finalize', currentUri: op.uri });
      }
    } catch (err) {
      console.error('advance error:', id, err);
      await fail(id, 'Something went wrong while producing your clip. Please try again.');
    }
  }

  const snap = await jobs().doc(id).get();
  return view(id, snap.data());
}

async function clipView(id, c) {
  const file = bucket.file(c.path);
  const expires = Date.now() + SIGNED_URL_TTL_MS;
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires });
  const [downloadUrl] = await file.getSignedUrl({
    version: 'v4', action: 'read', expires,
    responseDisposition: `attachment; filename="clipgen-${id.slice(0, 8)}.mp4"`,
  });
  return {
    id, url, downloadUrl,
    prompt: c.prompt, preset: c.preset, model: c.model, resolution: c.resolution,
    aspectRatio: c.aspectRatio, length: c.length, narration: c.narration, logo: !!c.logo,
    costUsd: c.costUsd ?? null, ad: c.ad || null,
    createdAt: c.createdAt?.toMillis?.() || 0,
  };
}

export async function listClips(uid) {
  const snap = await clips(uid).orderBy('createdAt', 'desc').limit(30).get();
  const out = await Promise.all(
    snap.docs.map((d) => clipView(d.id, d.data()).catch((err) => {
      console.error('sign error:', err);
      return null;
    }))
  );
  return out.filter(Boolean);
}

export async function getClip(uid, id) {
  const doc = await clips(uid).doc(id).get();
  if (!doc.exists) throw new HttpError(404, 'Clip not found.');
  return clipView(id, doc.data());
}

export async function deleteClip(uid, id) {
  const ref = clips(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpError(404, 'Clip not found.');
  await bucket.file(doc.data().path).delete({ ignoreNotFound: true });
  await ref.delete();
}
