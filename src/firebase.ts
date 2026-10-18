import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  linkWithPopup, linkWithCredential, EmailAuthProvider, type User,
} from 'firebase/auth';

// Public Firebase web config (identifiers, not secrets). Access is enforced by the backend.
const app = initializeApp({
  projectId: 'project-5869a4b9-e007-42d4-b48',
  appId: '1:173461988236:web:771ec432471ba76b2caca9',
  apiKey: 'AIzaSyAGNQM034T2MdLXM4CM6eqBaSbTMfjYPGA',
  authDomain: 'project-5869a4b9-e007-42d4-b48.firebaseapp.com',
  messagingSenderId: '173461988236',
});

export const auth = getAuth(app);
export type { User };

export const onUser = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb);

export const continueAsGuest = () => signInAnonymously(auth);

/** Signs in with Google. A guest is upgraded in place so their clips are kept. */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      return await linkWithPopup(current, provider);
    } catch (err) {
      if ((err as { code?: string })?.code !== 'auth/credential-already-in-use') throw err;
    }
  }
  return signInWithPopup(auth, provider);
}

export async function signUpWithEmail(email: string, password: string) {
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    return linkWithCredential(current, EmailAuthProvider.credential(email, password));
  }
  return createUserWithEmailAndPassword(auth, email, password);
}

export const signInWithEmail = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signOut = () => fbSignOut(auth);

/** Maps Firebase auth error codes to short, human messages. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/email-already-in-use': 'That email already has an account. Try signing in.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled yet.',
    'auth/configuration-not-found': 'This sign-in method is not enabled yet.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'Sign-in failed. Please try again.';
}
