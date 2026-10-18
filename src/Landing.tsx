import React from 'react';

interface LandingProps {
  signedIn: boolean;
  busy: boolean;
  error: string;
  onGuest: () => void;
  onSignIn: () => void;
  onOpenStudio: () => void;
}

const FEATURES = [
  { icon: '🎬', title: 'Text-to-video', body: 'Describe a scene in plain language and Veo 3.1 turns it into a cinematic clip with its own sound.' },
  { icon: '🖼️', title: 'Dual keyframe anchors', body: 'Add a start and end image so the story opens and lands exactly where you want.' },
  { icon: '⏱️', title: 'Up to 20 seconds', body: 'Clips are extended in 7-second blocks and stitched into one seamless video.' },
  { icon: '🎨', title: '30+ presets', body: 'One-click looks and motion styles, from film noir to product hero and TikTok hooks.' },
  { icon: '⚡', title: 'Fast and HQ modes', body: 'Draft quickly with Veo 3.1 Fast, then render the final with Veo 3.1 HQ.' },
  { icon: '🖥️', title: '1080p master', body: 'Native 1080p from Veo, encoded to a social-ready H.264 MP4.' },
  { icon: '🎙️', title: 'Gemini narration', body: 'Gemini 2.5 text-to-speech voice-over, mixed over the clip while its own sound is ducked underneath.' },
  { icon: '🚀', title: 'Instant access', body: 'Sign in with Google or email, or jump in as a guest — no sign-up wall before your first clip.' },
];

const STEPS = [
  { n: '01', title: 'Describe', body: 'Write a prompt, pick a preset and optionally add start and end images. Let Gemini sharpen the prompt.' },
  { n: '02', title: 'Generate', body: 'Veo 3.1 creates the opening clip, then extends it in coherent blocks up to 20 seconds.' },
  { n: '03', title: 'Polish and export', body: 'We master a 1080p MP4, mix in AI narration if you asked for it, and you download it.' },
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
      <span className="eyebrow">Powered by Veo 3.1 and Gemini 2.5</span>
      <h1>From one sentence to a cinematic <em>20-second</em> clip.</h1>
      <p>
        ClipGen.AI is the production crew a small team doesn't have. Turn a prompt — plus optional start and end
        images — into a 1080p video with AI narration, in one studio.
      </p>
      <div className="hero-cta">
        {signedIn ? (
          <button className="btn-primary big" onClick={onOpenStudio}>Open the studio</button>
        ) : (
          <>
            <button className="btn-primary big" onClick={onGuest} disabled={busy}>
              {busy ? 'Opening...' : 'Try it as a guest'}
            </button>
            <button className="btn-secondary big" onClick={onSignIn}>Sign in</button>
          </>
        )}
      </div>
      {error && <div className="error-banner" role="alert" style={{ maxWidth: 420, margin: '16px auto 0' }}>{error}</div>}
      <p className="hero-note">No credit card. Guests get a daily allowance; sign in for more.</p>
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

    <section className="landing-section pipeline">
      <h2>The generation pipeline</h2>
      <ol className="pipeline-list">
        <li><b>Conditioning</b><span>Prompt, preset style and optional keyframes are combined into the request.</span></li>
        <li><b>Veo 3.1</b><span>The Fast or HQ model synthesizes motion, lighting and sound.</span></li>
        <li><b>20s extension</b><span>Veo extends the clip in 7-second blocks; the result is trimmed to your length.</span></li>
        <li><b>Master and voice</b><span>ffmpeg encodes the MP4 and mixes Gemini narration over the original audio.</span></li>
      </ol>
    </section>

    <footer className="landing-footer">
      Built on Google Cloud: Veo 3.1 and Gemini on Vertex AI · Firebase Auth and Hosting · Firestore · Cloud Run · Cloud Storage
    </footer>
  </div>
);
