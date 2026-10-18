import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, bucket } from './firebase.js';
import { HttpError } from './errors.js';
import { LANGUAGES, LIMITS, MAX_LOGO_BYTES } from './config.js';

const kits = (uid) => db.collection('users').doc(uid).collection('brandKits');
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[0-9a-f-]{36}$/;

function ref(uid, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(404, 'Brand kit not found.');
  return kits(uid).doc(id);
}

function clean(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) throw new HttpError(400, 'Give your brand kit a name.');
  const colors = Array.isArray(body.colors) ? body.colors.filter((c) => HEX.test(c)).slice(0, 5) : [];
  return {
    name,
    tone: typeof body.tone === 'string' ? body.tone.trim().slice(0, 120) : '',
    audience: typeof body.audience === 'string' ? body.audience.trim().slice(0, 100) : '',
    colors,
    language: LANGUAGES[body.language] ? body.language : 'id',
  };
}

async function view(id, data) {
  let logoUrl = null;
  if (data.logoPath) {
    try {
      [logoUrl] = await bucket.file(data.logoPath).getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000,
      });
    } catch (err) {
      console.error('logo sign error:', err);
    }
  }
  return {
    id, name: data.name, tone: data.tone, audience: data.audience, colors: data.colors,
    language: data.language, hasLogo: !!data.logoPath, logoUrl,
  };
}

export async function listKits(uid) {
  const snap = await kits(uid).orderBy('createdAt', 'desc').limit(LIMITS.maxBrandKits).get();
  return Promise.all(snap.docs.map((d) => view(d.id, d.data())));
}

export async function getKit(uid, id) {
  const doc = await ref(uid, id).get();
  if (!doc.exists) throw new HttpError(404, 'Brand kit not found.');
  return { id: doc.id, ...doc.data() };
}

export async function createKit(uid, body) {
  const existing = await kits(uid).count().get();
  if (existing.data().count >= LIMITS.maxBrandKits) {
    throw new HttpError(400, `You can keep up to ${LIMITS.maxBrandKits} brand kits.`);
  }
  const id = crypto.randomUUID();
  const data = { ...clean(body), logoPath: null, createdAt: FieldValue.serverTimestamp() };
  await kits(uid).doc(id).set(data);
  return view(id, data);
}

export async function updateKit(uid, id, body) {
  const r = ref(uid, id);
  const doc = await r.get();
  if (!doc.exists) throw new HttpError(404, 'Brand kit not found.');
  await r.update(clean(body));
  return view(id, (await r.get()).data());
}

export async function setLogo(uid, id, { imageBytes, mimeType }) {
  const r = ref(uid, id);
  const doc = await r.get();
  if (!doc.exists) throw new HttpError(404, 'Brand kit not found.');
  if (mimeType !== 'image/png' || typeof imageBytes !== 'string') throw new HttpError(400, 'Logo must be a PNG image.');
  const buf = Buffer.from(imageBytes, 'base64');
  if (!buf.length || buf.length > MAX_LOGO_BYTES) throw new HttpError(413, 'Logo is too large (max 1 MB).');
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new HttpError(400, 'Logo must be a PNG image.');
  const logoPath = `brand/${uid}/${id}.png`;
  await bucket.file(logoPath).save(buf, { contentType: 'image/png', resumable: false });
  await r.update({ logoPath });
  return view(id, (await r.get()).data());
}

export async function deleteKit(uid, id) {
  const r = ref(uid, id);
  const doc = await r.get();
  if (!doc.exists) throw new HttpError(404, 'Brand kit not found.');
  if (doc.data().logoPath) await bucket.file(doc.data().logoPath).delete({ ignoreNotFound: true });
  await r.delete();
}

/** Raw logo bytes for the ffmpeg overlay, or null. */
export async function readLogo(kit) {
  if (!kit?.logoPath) return null;
  const [buf] = await bucket.file(kit.logoPath).download();
  return buf;
}
