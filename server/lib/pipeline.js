import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, bucket } from './firebase.js';
import { HttpError } from './errors.js';
import * as veo from './veo.js';
import { synthesizeSpeech } from './gemini.js';
import { finalizeVideo } from './media.js';
import { estimateCost } from './pricing.js';
import { getKit, readLogo } from './brand.js';
import { guardGeneration } from './limits.js';
import { parseImage, validate } from './validation.js';

const LOCK_MS = 120_000;
// The final step (download, ffmpeg master, upload) is the slow one, so it gets its own long lease.
const FINALIZE_LOCK_MS = 15 * 60_000;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;
const jobs = () => db.collection('jobs');
const clips = (uid) => db.collection('users').doc(uid).collection('clips');

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
    const lease = job.stage === 'finalize' || job.stage === 'finalizing' ? FINALIZE_LOCK_MS : LOCK_MS;
    tx.update(ref, { lockUntil: Date.now() + lease });
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
      if (job.stage === 'finalize' || job.stage === 'finalizing') {
        // The master step already ran when the stage reached "finalize". If the clip record
        // exists the work is done; if it does not, the step was interrupted and is retried.
        const done = await clips(job.uid).doc(id).get();
        if (done.exists) {
          await jobs().doc(id).update({ status: 'done', stage: 'done', clipId: id, lockUntil: 0 });
        } else {
          await finalize(id, job);
        }
      } else {
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
          await jobs().doc(id).update({
            stage: 'finalizing',
            currentUri: op.uri,
            lockUntil: Date.now() + FINALIZE_LOCK_MS,
          });
          await finalize(id, { ...job, stage: 'finalizing', currentUri: op.uri });
        }
      }
    } catch (err) {
      console.error('advance error:', id, err);
      await fail(id, 'Something went wrong while producing your clip. Please try again.');
    }
  }

  const snap = await jobs().doc(id).get();
  const data = snap.data();
  if (!data) throw new HttpError(404, 'Job not found.');
  return view(id, data);
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
