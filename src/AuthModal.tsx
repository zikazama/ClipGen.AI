import React, { useState } from 'react';
import {
  authErrorMessage, continueAsGuest, signInWithEmail, signInWithGoogle, signUpWithEmail,
} from './firebase';

interface AuthModalProps {
  /** When true the modal offers the "continue as guest" shortcut (landing page). */
  allowGuest?: boolean;
  onClose: () => void;
  onDone: () => void;
}

export const AuthModal = ({ allowGuest = false, onClose, onDone }: AuthModalProps) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => (mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(email, password)));
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: 400 }} role="dialog" aria-modal="true" aria-label="Sign in">
        <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        <h2 style={{ marginBottom: 8 }}>{mode === 'signin' ? 'Welcome back' : 'Create an account'}</h2>
        <p style={{ color: '#a1a1aa', fontSize: 14, marginBottom: 20 }}>
          {mode === 'signin' ? 'Sign in to keep your clips across devices.' : 'Free to start. Higher daily limits than guests.'}
        </p>

        <div className="auth-form">
          <button className="google-btn" onClick={() => run(signInWithGoogle)} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="or-divider"><span>or</span></div>

          <form onSubmit={submit} className="auth-form" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="auth-email">Email</label>
              <input id="auth-email" type="email" className="form-input" placeholder="name@example.com" autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" className="form-input" placeholder="••••••••" minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          </form>

          {allowGuest && (
            <button className="btn-text" style={{ width: '100%' }} disabled={busy} onClick={() => run(continueAsGuest)}>
              Skip — continue as guest
            </button>
          )}
        </div>

        <div className="auth-footer">
          {mode === 'signin'
            ? <>Don't have an account? <span onClick={() => setMode('signup')}>Sign up</span></>
            : <>Already have an account? <span onClick={() => setMode('signin')}>Sign in</span></>}
        </div>
      </div>
    </div>
  );
};
