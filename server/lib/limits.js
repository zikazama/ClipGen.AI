import crypto from 'node:crypto';
import { db } from './firebase.js';
import { HttpError } from './errors.js';
import { LIMITS } from './config.js';

const HOUR = 3600_000;
const DAY = 86_400_000;

/** The counter window a timestamp belongs to. Pure. */
export function windowBucket(now, windowMs) {
  return Math.floor(now / windowMs);
}

/** Whether adding `amount` to `used` would go over `limit`. Pure. */
export function wouldExceed(used, amount, limit) {
  return used + amount > limit;
}

/** The daily video seconds a user may spend. Guests get the trial limit. Pure. */
export function secondsPerDayFor(user, limits) {
  return user?.guest ? limits.guestSecondsPerDay : limits.userSecondsPerDay;
}

/** Converts a USD amount to integer micro dollars, so the counter stays an integer. Pure. */
export function toMicroUsd(usd) {
  return Math.ceil(usd * 1e6);
}

/**
 * Atomically adds `amount` to a windowed counter. Returns false (and changes nothing)
 * if it would exceed `limit`. Counters live in Firestore so they hold across instances;
 * `expireAt` lets a Firestore TTL policy clean them up.
 */
async function consume(key, limit, windowMs, amount = 1) {
  const bucketId = windowBucket(Date.now(), windowMs);
  const ref = db.collection('ratelimits').doc(`${key}_${bucketId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? snap.data().count : 0;
    if (wouldExceed(used, amount, limit)) return false;
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
  const perUser = secondsPerDayFor(req.user, LIMITS);
  if (!(await consume(`sec_${req.user.uid}`, perUser, DAY, seconds))) {
    throw new HttpError(
      429,
      req.user.guest
        ? 'Guest daily limit reached. Sign in with Google or email for a higher limit.'
        : 'Daily generation limit reached. Please try again tomorrow.'
    );
  }
  // Budget is tracked in micro-dollars to keep the counter an integer.
  const micro = toMicroUsd(costUsd);
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
