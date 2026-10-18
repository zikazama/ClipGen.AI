import React from 'react';
import { UnitEconomics } from './PricingPanel';
import { AD_LANGUAGES } from './ad';
import { FAST_AD_COST, formatUsd } from './pricing';

interface LandingProps {
  signedIn: boolean;
  busy: boolean;
  error: string;
  onGuest: () => void;
  onSignIn: () => void;
  onOpenStudio: () => void;
}

const STEPS = [
  { n: '01', title: 'Product photo + one line', body: 'Upload a photo of what you sell and write a short brief, like "kopi susu gula aren, vibe pagi hari".' },
  { n: '02', title: 'Gemini plans the ad', body: 'Gemini looks at your photo and brand kit, then writes the cinematic Veo prompt, the voice-over script, a caption and hashtags.' },
  { n: '03', title: 'Veo renders, Gemini speaks', body: 'Veo 3.1 builds up to 20 seconds in 1080p; Gemini narrates it in your language. Download and post.' },
];

const WHY = [
  { title: 'Built for sellers', body: 'Your product photo is the first frame. The result is a vertical, ready-to-post ad for TikTok, Reels, Shopee Video or Shorts.' },
  { title: 'No prompt skills', body: 'Gemini acts as your creative director. 33 presets are there when you want to drive the look yourself.' },
  { title: 'Local-language voice', body: 'Voice-over in Bahasa Indonesia and English, plus Javanese and Sundanese in beta, all from Gemini text-to-speech.' },
  { title: 'Low cost per ad', body: `About ${formatUsd(FAST_AD_COST)} of API cost for a 20-second Fast ad with narration. See the unit economics below.` },
];

const FEATURES = [
  { icon: '🎬', title: 'Gemini creative director', body: 'Brief + product photo in; prompt, script, caption and hashtags out.' },
  { icon: '🖼️', title: 'Dual keyframes', body: 'Free-form mode: a start and end image anchor the opening of your clip.' },
  { icon: '⏱️', title: 'Up to 20 seconds', body: 'Veo extends the clip in 7-second blocks and stitches them.' },
  { icon: '🏷️', title: 'Brand kits in Firestore', body: 'Logo, colours and tone saved once; the logo is added to every ad.' },
  { icon: '⚡', title: 'Fast and HQ', body: 'Draft with Veo 3.1 Fast, finish with HQ.' },
  { icon: '🖥️', title: '1080p master', body: 'Native 1080p from Veo, encoded to social-ready H.264.' },
  { icon: '🗂️', title: 'History and gallery', body: 'Every ad is saved with its brief, script, caption and cost.' },
  { icon: '🚀', title: 'Instant access', body: 'Google, email or guest: your first Fast draft needs no sign-up.' },
];

export const Landing = ({ signedIn, busy, error, onGuest, onSignIn, onOpenStudio }: LandingProps) => (
  <div className="landing">
    <header className="landing-nav">
      <div className="brand"><img src="/favicon.svg" width="28" height="28" alt="" /> ClipGen.AI</div>
      <div className="nav-actions">
        {signedIn
          ? <button className="btn-primary" onClick={onOpenStudio}>Open studio</button>
          : <button className="btn-text" onClick={onSignIn}>Sign in</button>}
      </div>
    </header>

    <section className="hero">
      <span className="eyebrow">Product ads for UMKM and online sellers</span>
      <h1>One product photo. One line. A <em>20-second</em> ad, ready to post.</h1>
      <p>
        Upload a photo of what you sell and say what the vibe is. Gemini writes the script, Veo 3.1 shoots the clip
        and a local-language voice narrates it, for TikTok, Reels or Shopee.
      </p>
      <div className="hero-cta">
        {signedIn ? (
          <button className="btn-primary big" onClick={onOpenStudio}>Open the studio</button>
        ) : (
          <>
            <button className="btn-primary big" onClick={onGuest} disabled={busy}>
              {busy ? 'Opening...' : 'Try a free draft'}
            </button>
            <button className="btn-secondary big" onClick={onSignIn}>Sign in</button>
          </>
        )}
      </div>
      {error && <div className="error-banner" role="alert" style={{ maxWidth: 420, margin: '16px auto 0' }}>{error}</div>}
      <p className="hero-note">Guests get one Fast draft (up to 8 seconds). Sign in for HQ, 20-second ads and a saved library.</p>
      <div className="pill-row" aria-label="Narration languages">
        {AD_LANGUAGES.map(l => <span key={l.id} className={`pill ${l.beta ? 'beta' : ''}`}>{l.label}</span>)}
      </div>
    </section>

    <section className="landing-section">
      <h2>How it works</h2>
      <div className="steps-grid">
        {STEPS.map(s => (
          <div key={s.n} className="landing-card">
            <div className="step-no">{s.n}</div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="landing-section">
      <h2>Why not a generic AI video tool?</h2>
      <div className="compare-grid">
        {WHY.map(w => (
          <div key={w.title} className="landing-card">
            <h3>{w.title}</h3>
            <p>{w.body}</p>
          </div>
        ))}
      </div>
      <p className="field-hint" style={{ textAlign: 'center', marginTop: 14 }}>
        General-purpose tools such as Sora, Runway and Pika make creative video; ClipGen.AI packages Veo 3.1 and Gemini into one seller workflow.
      </p>
    </section>

    <section className="landing-section">
      <h2>Everything in one pipeline</h2>
      <div className="features-grid">
        {FEATURES.map(f => (
          <div key={f.title} className="landing-card">
            <div className="feature-icon" aria-hidden>{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="landing-section">
      <h2>What an ad costs</h2>
      <UnitEconomics />
    </section>

    <footer className="landing-footer">
      Built on Google Cloud: Veo 3.1 and Gemini on Vertex AI · Firebase Auth and Hosting · Firestore · Cloud Run · Cloud Storage
    </footer>
  </div>
);
