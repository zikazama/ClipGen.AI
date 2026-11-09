/**
 * The pure rules behind the rate limits and the daily budget.
 *
 * This file has no imports on purpose: the rules can be unit tested without
 * Firestore, the Firebase Admin SDK or a network connection.
 */

/** The counter window a timestamp belongs to. */
export function windowBucket(now, windowMs) {
  return Math.floor(now / windowMs);
}

/** Whether adding `amount` to `used` would go over `limit`. */
export function wouldExceed(used, amount, limit) {
  return used + amount > limit;
}

/** The daily video seconds a user may spend. Guests get the trial limit. */
export function secondsPerDayFor(user, limits) {
  return user?.guest ? limits.guestSecondsPerDay : limits.userSecondsPerDay;
}

/** Converts a USD amount to integer micro dollars, so the counter stays an integer. */
export function toMicroUsd(usd) {
  return Math.ceil(usd * 1e6);
}
