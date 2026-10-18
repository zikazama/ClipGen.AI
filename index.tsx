import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { continueAsGuest, onUser, signOut, type User } from './src/firebase';
import { errorMessage } from './utils';
import { Landing } from './src/Landing';
import { Studio } from './src/Studio';
import { AuthModal } from './src/AuthModal';

type View = 'landing' | 'studio';
const viewFromHash = (): View => (window.location.hash === '#studio' ? 'studio' : 'landing');

const App = () => {
  // undefined = Firebase still restoring the session; null = signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>(viewFromHash());
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onUser(setUser), []);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: View) => {
    window.location.hash = next === 'studio' ? '#studio' : '';
    setView(next);
  }, []);

  const guest = async () => {
    setBusy(true);
    setError('');
    try {
      await continueAsGuest();
      go('studio');
    } catch (e) {
      setError(errorMessage(e, 'Could not start a guest session. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (user === undefined) {
    return <div className="boot"><div className="mini-spinner" /></div>;
  }

  // The studio needs an identity; anyone without one is sent to the landing page.
  if (view === 'studio' && user) {
    return (
      <>
        <Studio user={user} onHome={() => go('landing')} onOpenAuth={() => setAuthOpen(true)}
          onSignOut={async () => { await signOut(); go('landing'); }} />
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onDone={() => setAuthOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <Landing signedIn={!!user} busy={busy} error={error} onGuest={guest}
        onSignIn={() => setAuthOpen(true)} onOpenStudio={() => go('studio')} />
      {authOpen && <AuthModal allowGuest={!user} onClose={() => setAuthOpen(false)}
        onDone={() => { setAuthOpen(false); go('studio'); }} />}
    </>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
