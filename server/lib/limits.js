import crypto from 'node:crypto';
import { db } from './firebase.js';
import { HttpError } from './errors.js';
import { LIMITS } from './config.js';

const HOUR = 3600_000;
const DAY = 86_400_000;

/**
 * Atomically adds `amount` to a windowed counter. Returns false (and changes nothing)
 * if it would exceed `limit`. Counters live in Firestore so they hold across instances;
 * `expireAt` lets a Firestore TTL policy clean them up.
 */
async function consume(key, limit, windowMs, amount = 1) {
  const bucketId = Math.floor(Date.now() / windowMs);
  const ref = db.collection('ratelimits').doc(`${key}_${bucketId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? snap.data().count : 0;
    if (used + amount > limit) return false;
    tx.set(ref, { count: used + amount, expireAt: new Date((bucketId + 2) * windowMs) });
    return true;
  });
}

function ipKey(req, scope) {
  const hash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex').slice(0, 16);
  return `${scope}_${hash}`;
}

/** Guards a new video job: per-IP rate, per-user daily seconds, and a global daily USD budget. */
export async function guardGeneration(req, { seconds, costUsd }) {
  if (!(await consume(ipKey(req, 'gen'), LIMITS.genPerIpHour, HOUR))) {
    throw new HttpError(429, 'Too many video requests from your network. Try again later.');
  }
  const perUser = req.user.guest ? LIMITS.guestSecondsPerDay : LIMITS.userSecondsPerDay;
  if (!(await consume(`sec_${req.user.uid}`, perUser, DAY, seconds))) {
    throw new HttpError(
      429,
      req.user.guest
        ? 'Guest daily limit reached. Sign in with Google or email for a higher limit.'
        : 'Daily generation limit reached. Please try again tomorrow.'
    );
  }
  // Budget is tracked in micro-dollars to keep the counter an integer.
  const micro = Math.ceil(costUsd * 1e6);
  if (!(await consume('budget_global', Math.round(LIMITS.dailyBudgetUsd * 1e6), DAY, micro))) {
    throw new HttpError(429, 'The studio has reached its daily capacity. Please try again tomorrow.');
  }
}

/** Guards lightweight Gemini calls (prompt enhance, narration preview). */
export async function guardAi(req) {
  if (!(await consume(`ai_${req.user.uid}`, LIMITS.aiCallsPerHour, HOUR))) {
    throw new HttpError(429, 'Too many requests. Try again later.');
  }
}
