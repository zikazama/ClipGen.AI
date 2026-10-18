import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { PROJECT_ID, BUCKET } from './config.js';
import { HttpError } from './errors.js';

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

export const db = getFirestore();
export const bucket = new Storage({ projectId: PROJECT_ID }).bucket(BUCKET);

/** Express middleware: verifies the Firebase ID token and attaches req.user. */
export async function requireUser(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) throw new HttpError(401, 'Please sign in or continue as a guest.');
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(match[1]);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please refresh the page.');
    }
    req.user = {
      uid: decoded.uid,
      guest: decoded.firebase?.sign_in_provider === 'anonymous',
      email: decoded.email || null,
    };
    next();
  } catch (err) {
    next(err);
  }
}
