import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from './firebase';
import * as api from './api';
import { PRESETS, PRESET_CATEGORIES, composePrompt, findPreset } from './presets';
import { prepareImage, type PreparedImage } from './image';
import { decode, decodeAudioData, getAudioContext, errorMessage } from '../utils';
import { estimateCost, formatUsd } from './pricing';
import {
  AD_LANGUAGES, AD_PLATFORMS, SPEECH_STYLES, VOICES, findPlatform, maxScriptWords, countWords,
} from './ad';
import { BrandKitModal } from './BrandKitModal';
import { PricingModal } from './PricingPanel';

const MODELS = [
  { id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast', description: 'Quick drafts. Cheaper, great for iterating.' },
  { id: 'veo-3.1-generate-001', name: 'Veo 3.1 HQ', description: 'Highest fidelity for final renders.' },
];
const LENGTHS = [4, 6, 8, 15, 20];
const GUEST_MAX_LENGTH = 8;
const JOB_KEY = 'clipgen.job';
const POLL_MS = 5000;
const MAX_WAIT_MS = 25 * 60 * 1000;

type Frame = PreparedImage;
type Mode = 'ad' | 'free';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clock = (s: number) => `00:${String(s).padStart(2, '0')}`;
const modelName = (id: string) => MODELS.find(m => m.id === id)?.name || id;

interface StudioProps {
  user: User;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onHome: () => void;
}

export const Studio = ({ user, onOpenAuth, onSignOut, onHome }: StudioProps) => {
  const guest = user.isAnonymous;

  // Mode and shared inputs
  const [mode, setMode] = useState<Mode>('ad');
  const [prompt, setPrompt] = useState('');
  const [startFrame, setStartFrame] = useState<Frame | null>(null);
  const [endFrame, setEndFrame] = useState<Frame | null>(null);

  // Product-ad inputs
  const [brief, setBrief] = useState('');
  const [platformId, setPlatformId] = useState<string>(AD_PLATFORMS[0].id);
  const [languageId, setLanguageId] = useState<string>('id');
  const [plan, setPlan] = useState<api.DirectorPlan | null>(null);
  const [kits, setKits] = useState<api.BrandKit[]>([]);
  const [kitId, setKitId] = useState<string>('');
  const [useLogo, setUseLogo] = useState(true);
  const [kitsOpen, setKitsOpen] = useState(false);
  const [directing, setDirecting] = useState(false);

  // Free-form inputs
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetCategory, setPresetCategory] = useState<(typeof PRESET_CATEGORIES)[number]>('Cinematic');

  // Configuration
  const [model, setModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('9:16');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [length, setLength] = useState(guest ? GUEST_MAX_LENGTH : 15);
  const [sound, setSound] = useState(true);
  const [narrationOn, setNarrationOn] = useState(true);
  const [narrationText, setNarrationText] = useState('');
  const [voice, setVoice] = useState('Kore');
  const [speechStyle, setSpeechStyle] = useState<string>('upbeat');

  // Status
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<api.JobView | null>(null);
  const [error, setError] = useState('');
  const [enhancing, setEnhancing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [tab, setTab] = useState<'canvas' | 'library'>('canvas');
  const [result, setResult] = useState<api.Clip | null>(null);
  const [library, setLibrary] = useState<api.Clip[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [copied, setCopied] = useState('');

  const modelRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);

  const isAd = mode === 'ad';
  const preset = findPreset(presetId);
  const kit = kits.find(k => k.id === kitId) || null;
  const longClip = length > 8;
  const resolutionLocked = length < 8;
  const effectiveResolution = resolutionLocked ? '720p' : resolution;
  const endFrameAllowed = !isAd && length >= 8;
  const narrationActive = (narrationOn || isAd) && narrationText.trim().length > 0;
  const wordLimit = maxScriptWords(length);
  const scriptWords = countWords(narrationText);
  const cost = estimateCost({
    model: model.id, resolution: effectiveResolution, length, narration: narrationActive, director: !!plan, sound,
  });
  const estMinutes = length === 20 ? 6 : length === 15 ? 4 : 2;

  const steps = useMemo(() => {
    const ext = job?.extensions ?? (length === 20 ? 2 : length === 15 ? 1 : 0);
    const list = [`Generating the opening clip with ${model.name}`];
    for (let i = 1; i <= ext; i++) list.push(`Extending the scene (${i}/${ext})`);
    const finish = ['Mastering the final MP4'];
    if (narrationActive) finish.push('mixing Gemini narration');
    if (isAd && kit?.hasLogo && useLogo) finish.push('adding your logo');
    list.push(finish.join(', '));
    return list;
  }, [job?.extensions, length, model.name, narrationActive, isAd, kit, useLogo]);

  // Close the model dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Guests get one Fast 8 s draft; keep the form inside that trial.
  useEffect(() => {
    if (!guest) return;
    if (model.id !== MODELS[0].id) setModel(MODELS[0]);
    if (length > GUEST_MAX_LENGTH) setLength(GUEST_MAX_LENGTH);
  }, [guest, model.id, length]);

  // A short clip cannot do 1080p or use an end frame; keep the form consistent.
  useEffect(() => {
    if ((length < 8 || isAd) && endFrame) setEndFrame(null);
  }, [length, isAd, endFrame]);

  // Veo letterboxes images that do not match the video ratio, so re-crop uploads when the ratio changes.
  useEffect(() => {
    let stale = false;
    const redo = async (frame: Frame | null, set: (f: Frame) => void) => {
      if (!frame) return;
      try {
        const next = await prepareImage(frame.source, aspectRatio);
        if (stale) { URL.revokeObjectURL(next.preview); return; }
        URL.revokeObjectURL(frame.preview);
        set(next);
      } catch { /* keep the previous crop */ }
    };
    void redo(startFrame, setStartFrame);
    void redo(endFrame, setEndFrame);
    return () => { stale = true; };
  }, [aspectRatio]);

  // Brand kits live in Firestore; load them once.
  useEffect(() => {
    api.listBrandKits().then(r => {
      setKits(r.kits);
      if (r.kits[0]) { setKitId(r.kits[0].id); setLanguageId(r.kits[0].language); }
    }).catch(() => { /* kits are optional */ });
  }, []);

  // Resume a job that was running when the page was closed.
  useEffect(() => {
    cancelled.current = false;
    try {
      const saved = JSON.parse(localStorage.getItem(JOB_KEY) || 'null');
      if (saved?.id && Date.now() - saved.startedAt < MAX_WAIT_MS) void track(saved.id, saved.startedAt);
      else localStorage.removeItem(JOB_KEY);
    } catch { /* ignore corrupt state */ }
    return () => { cancelled.current = true; };
  }, []);

  useEffect(() => {
    if (tab === 'library') void refreshLibrary();
  }, [tab]);

  async function refreshLibrary() {
    try {
      setLibrary((await api.listClips()).clips);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function track(id: string, startedAt: number) {
    setBusy(true);
    setError('');
    setResult(null);
    setTab('canvas');
    let failures = 0;
    try {
      for (;;) {
        if (cancelled.current) return;
        if (Date.now() - startedAt > MAX_WAIT_MS) throw new Error('Generation timed out. Please try again.');
        try {
          const view = await api.getJob(id);
          failures = 0;
          setJob(view);
          if (view.status === 'error') throw new Error(view.error || 'Generation failed.');
          if (view.status === 'done' && view.clipId) {
            const clip = await api.getClip(view.clipId);
            if (cancelled.current) return;
            setResult(clip);
            setLibrary(null);
            return;
          }
        } catch (e) {
          // Tolerate brief network blips, but surface real API errors straight away.
          if (e instanceof TypeError && ++failures < 5) { await sleep(POLL_MS); continue; }
          throw e;
        }
        await sleep(POLL_MS);
      }
    } catch (e) {
      if (!cancelled.current) setError(errorMessage(e));
    } finally {
      try { localStorage.removeItem(JOB_KEY); } catch { /* ignore */ }
      if (!cancelled.current) { setBusy(false); setJob(null); }
    }
  }

  function pickPlatform(id: string) {
    const p = findPlatform(id);
    setPlatformId(p.id);
    setAspectRatio(p.aspectRatio);
    setLength(guest ? Math.min(p.length, GUEST_MAX_LENGTH) : p.length);
    setPlan(null);
  }

  async function runDirector() {
    if (!brief.trim()) { setError('Write a short brief first, for example: kopi susu gula aren, vibe pagi hari.'); return; }
    if (!startFrame) { setError('Add your product photo first so Gemini can see what you sell.'); return; }
    setDirecting(true);
    setError('');
    try {
      const p = await api.direct({
        brief: brief.trim(), language: languageId, platform: platformId, length, aspectRatio,
        brandKitId: kitId || null,
        image: { imageBytes: startFrame.base64, mimeType: startFrame.file.type },
      });
      setPlan(p);
      setPrompt(p.veoPrompt);
      setNarrationText(p.voiceover);
      setNarrationOn(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDirecting(false);
    }
  }

  async function generate() {
    const finalPrompt = isAd ? prompt.trim() : composePrompt(prompt, preset);
    if (isAd && !startFrame) { setError('Add your product photo to start.'); return; }
    if (isAd && !finalPrompt) { setError('Let Gemini plan your ad first, or write the video prompt yourself.'); return; }
    if (!isAd && !prompt.trim() && !startFrame) { setError('Write a prompt or add a start frame.'); return; }
    if (narrationActive && scriptWords > wordLimit + 4) {
      setError(`The voice-over has ${scriptWords} words; about ${wordLimit} fit in ${length} seconds. Shorten it or pick a longer clip.`);
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setTab('canvas');
    try {
      const payload: api.CreateJobPayload = {
        model: model.id,
        prompt: finalPrompt,
        preset: isAd ? null : presetId,
        length,
        aspectRatio,
        resolution: effectiveResolution,
        sound,
        narration: narrationActive ? { text: narrationText.trim(), voice, style: speechStyle } : null,
        brandKitId: isAd && kitId ? kitId : null,
        useLogo: isAd && !!kit?.hasLogo && useLogo,
        ad: isAd
          ? {
              brief: brief.trim(), caption: plan?.caption || '', hashtags: plan?.hashtags || [],
              language: languageId, platform: platformId, directed: !!plan,
            }
          : null,
      };
      if (startFrame) payload.image = { imageBytes: startFrame.base64, mimeType: startFrame.file.type };
      if (endFrame && endFrameAllowed) payload.lastFrame = { imageBytes: endFrame.base64, mimeType: endFrame.file.type };
      const { id } = await api.createJob(payload);
      const startedAt = Date.now();
      try { localStorage.setItem(JOB_KEY, JSON.stringify({ id, startedAt })); } catch { /* ignore */ }
      void track(id, startedAt);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>, which: 'start' | 'end') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const frame = await prepareImage(file, aspectRatio);
      if (which === 'start') { setStartFrame(frame); setPlan(null); }
      else setEndFrame(frame);
      setError('');
    } catch {
      setError('Could not read that image. Try a PNG or JPEG file.');
    }
  }

  async function enhance() {
    if (!prompt.trim()) { setError('Write a rough idea first, then let Gemini polish it.'); return; }
    setEnhancing(true);
    setError('');
    try {
      setPrompt((await api.enhancePrompt(prompt, preset?.style || '')).prompt);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setEnhancing(false);
    }
  }

  async function previewVoice() {
    if (!narrationText.trim()) return;
    setPreviewing(true);
    setError('');
    try {
      const { audio } = await api.speak(narrationText, voice, speechStyle);
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = decodeAudioData(decode(audio), ctx, 24000, 1);
      source.connect(ctx.destination);
      source.start();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function removeClip(id: string) {
    try {
      await api.deleteClip(id);
      setLibrary(prev => (prev ? prev.filter(c => c.id !== id) : prev));
      if (result?.id === id) setResult(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* clipboard may be blocked */ }
  }

  const identity = guest ? 'Guest' : user.email || 'Signed in';
  const captionText = (ad?: api.Clip['ad']) =>
    ad?.caption ? `${ad.caption}\n\n${(ad.hashtags || []).map(h => `#${h}`).join(' ')}` : '';

  const frameBox = (frame: Frame | null, which: 'start' | 'end', disabled = false) =>
    frame ? (
      <div className="media-upload-box" style={{ cursor: 'default' }}>
        <img src={frame.preview} className="preview-thumb" alt={`${which} frame`} />
        <button className="remove-media-btn" aria-label={`Remove ${which} frame`}
          onClick={() => { URL.revokeObjectURL(frame.preview); if (which === 'start') { setStartFrame(null); setPlan(null); } else setEndFrame(null); }}>&times;</button>
        <span className="frame-tag">{isAd && which === 'start' ? 'Product' : which === 'start' ? 'Start' : 'End'}</span>
      </div>
    ) : (
      <label className={`media-upload-box ${disabled ? 'is-disabled' : ''}`}
        title={disabled ? 'End frames need a clip length of 8s or more' : undefined}>
        <input type="file" accept="image/*" hidden disabled={disabled} onChange={e => onFile(e, which)} />
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        <span>{isAd && which === 'start' ? 'Product photo' : which === 'start' ? 'Start Frame' : 'End Frame'}</span>
      </label>
    );

  const narrationBlock = (
    <div>
      <label className="section-label">Narration</label>
      {!isAd && (
        <label className="switch-row">
          <input type="checkbox" checked={narrationOn} onChange={e => setNarrationOn(e.target.checked)} />
          <span>Add Gemini voice-over to the final clip</span>
        </label>
      )}
      {(narrationOn || isAd) && (
        <div className="narration-box">
          <textarea className="prompt-textarea" style={{ minHeight: 84 }} maxLength={600} value={narrationText}
            placeholder={isAd ? 'Voice-over script (Gemini writes it for you)' : 'What should the narrator say?'}
            onChange={e => setNarrationText(e.target.value)} aria-label="Voice-over script" />
          {narrationText.trim() && (
            <p className={`field-hint ${scriptWords > wordLimit + 4 ? 'warn' : ''}`} style={{ margin: 0 }}>
              {scriptWords} words · about {wordLimit} fit in {length} seconds
            </p>
          )}
          {!isAd && (
            <select className="form-input" value={languageId} onChange={e => setLanguageId(e.target.value)} aria-label="Narration language">
              {AD_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}{l.beta ? ' (beta)' : ''}</option>)}
            </select>
          )}
          <div className="narration-row">
            <select className="form-input" value={voice} onChange={e => setVoice(e.target.value)} aria-label="Narrator voice">
              {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="form-input" value={speechStyle} onChange={e => setSpeechStyle(e.target.value)} aria-label="Speaking style">
              {SPEECH_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <button className="action-btn" onClick={previewVoice} disabled={!narrationText.trim() || previewing}>
            {previewing ? 'Loading...' : '▶ Preview voice'}
          </button>
        </div>
      )}
    </div>
  );

  const lengthBlock = (
    <div>
      <label className="section-label">Length</label>
      <div className="segmented" role="radiogroup" aria-label="Clip length">
        {LENGTHS.map(l => {
          const locked = guest && l > GUEST_MAX_LENGTH;
          return (
            <button key={l} role="radio" aria-checked={length === l} className={length === l ? 'active' : ''} disabled={locked}
              title={locked ? 'Sign in to unlock longer clips' : undefined} style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              onClick={() => { setLength(l); setPlan(null); }}>{l}s</button>
          );
        })}
      </div>
      {longClip && <p className="field-hint">Built by extending the opening clip in 7s blocks and stitching them.</p>}
    </div>
  );

  const settingsBlock = (
    <div className="settings-group">
      {!isAd && (
        <div className="setting-item">
          <div className="setting-label">Aspect ratio</div>
          <div className="setting-control" onClick={() => setAspectRatio(a => (a === '16:9' ? '9:16' : '16:9'))}>{aspectRatio}</div>
        </div>
      )}
      <div className="setting-item">
        <div className="setting-label">Resolution</div>
        <div className="setting-control" style={resolutionLocked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
          title={resolutionLocked ? '1080p needs a clip length of 8s or more' : 'Click to change'}
          onClick={() => { if (!resolutionLocked) setResolution(r => (r === '720p' ? '1080p' : '720p')); }}>
          {effectiveResolution}
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-label">Veo sound</div>
        <div className="setting-control" title="Video-only is billed at a lower rate" onClick={() => setSound(s => !s)}>
          {sound ? 'On' : 'Off (cheaper)'}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`app-container tab-${tab === 'canvas' ? 'canvas' : 'generations'}`}>
      {/* Icon sidebar */}
      <div className="icon-sidebar">
        <button className="sidebar-logo-container" onClick={onHome} aria-label="ClipGen.AI home" title="Home">
          <img src="/favicon.svg" width="28" height="28" alt="" />
        </button>
        <button className={`icon-btn ${tab === 'canvas' ? 'active' : ''}`} onClick={() => setTab('canvas')} title="Create" aria-label="Create">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
        </button>
        <button className={`icon-btn ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')} title="Library" aria-label="Library">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
        <button className="icon-btn" onClick={() => setKitsOpen(true)} title="Brand kits" aria-label="Brand kits">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" /><circle cx="6.5" cy="12.5" r="2.5" /><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3c.5.6.3 2.7-2.5 2.7z" /></svg>
        </button>
        <button className="icon-btn" onClick={() => setPricingOpen(true)} title="What a video costs" aria-label="Pricing and costs">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 7v10M14.5 9.5c-.5-.9-1.4-1.3-2.5-1.3-1.4 0-2.5.7-2.5 1.9s1.1 1.7 2.5 1.9c1.4.2 2.5.7 2.5 1.9s-1.1 1.9-2.5 1.9c-1.1 0-2-.4-2.5-1.3" /></svg>
        </button>
        <div className="spacer" />
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setMenuOpen(o => !o)} aria-label="Account" title={identity}>
            <div className="avatar-dot" />
          </button>
          {menuOpen && (
            <div className="account-menu" onMouseLeave={() => setMenuOpen(false)}>
              <div className="account-id">{identity}</div>
              {guest ? (
                <button onClick={() => { setMenuOpen(false); onOpenAuth(); }}>Sign in to unlock HQ and 20s ads</button>
              ) : (
                <button onClick={() => { setMenuOpen(false); onSignOut(); }}>Sign out</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Config panel */}
      <div className="config-panel">
        <div className="panel-header">
          <div className="panel-title-row">
            <h1>Studio</h1>
            <div className="model-dropdown-container" ref={modelRef}>
              <div className={`model-selector ${modelOpen ? 'active' : ''}`} onClick={() => setModelOpen(o => !o)} role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') setModelOpen(o => !o); }}>
                {model.name}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: modelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {modelOpen && (
                <div className="model-dropdown-menu">
                  {MODELS.map(m => {
                    const locked = guest && m.id !== MODELS[0].id;
                    return (
                      <div key={m.id} className={`model-dropdown-item ${model.id === m.id ? 'selected' : ''}`}
                        style={locked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                        onClick={() => { if (!locked) { setModel(m); setModelOpen(false); } }}>
                        <div className="model-item-name">{m.name}{locked ? ' · sign in' : ''}</div>
                        <div className="model-item-desc">{m.description}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="mode-switch" role="tablist" aria-label="Studio mode">
            <button role="tab" aria-selected={isAd} className={isAd ? 'active' : ''} onClick={() => setMode('ad')}>Product ad</button>
            <button role="tab" aria-selected={!isAd} className={!isAd ? 'active' : ''} onClick={() => setMode('free')}>Free-form</button>
          </div>
          <p className="panel-description">
            {isAd ? 'Product photo + one-line brief in, ready-to-post ad out.' : model.description}
          </p>
        </div>

        {guest && (
          <div className="guest-banner">
            Guest trial: one Fast draft up to 8 seconds. <button className="link-btn" onClick={onOpenAuth}>Sign in</button> for HQ, 20s ads and a saved library.
          </div>
        )}

        <div className="config-content">
          {isAd ? (
            <>
              <div>
                <label className="section-label">Product photo</label>
                <div className="media-inputs-grid" style={{ gridTemplateColumns: '1fr' }}>{frameBox(startFrame, 'start')}</div>
                <p className="field-hint">The photo becomes the first frame of your ad.</p>
              </div>

              <div>
                <label className="section-label" htmlFor="brief">One-line brief</label>
                <textarea id="brief" className="prompt-textarea" style={{ minHeight: 70 }} maxLength={400} value={brief}
                  placeholder="jual kopi susu gula aren, vibe pagi hari" onChange={e => { setBrief(e.target.value); setPlan(null); }} />
              </div>

              <div>
                <label className="section-label">Post it on</label>
                <div className="chip-row">
                  {AD_PLATFORMS.map(p => (
                    <button key={p.id} className={`chip ${platformId === p.id ? 'active' : ''}`} onClick={() => pickPlatform(p.id)}>{p.label}</button>
                  ))}
                </div>
                <p className="field-hint">{aspectRatio} · {length}s{guest && findPlatform(platformId).length > GUEST_MAX_LENGTH ? ' (guest trial is capped at 8s)' : ''}</p>
              </div>

              <div>
                <label className="section-label">Voice-over language</label>
                <select className="form-input" value={languageId} onChange={e => { setLanguageId(e.target.value); setPlan(null); }} aria-label="Voice-over language">
                  {AD_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}{l.beta ? ' (beta)' : ''}</option>)}
                </select>
              </div>

              <div>
                <label className="section-label">Brand kit</label>
                <div className="narration-row">
                  <select className="form-input" value={kitId} onChange={e => { setKitId(e.target.value); const k = kits.find(x => x.id === e.target.value); if (k) setLanguageId(k.language); setPlan(null); }} aria-label="Brand kit">
                    <option value="">No brand kit</option>
                    {kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  <button className="action-btn" onClick={() => setKitsOpen(true)}>{kits.length ? 'Manage' : 'Create'}</button>
                </div>
                {kit?.hasLogo && (
                  <label className="switch-row" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={useLogo} onChange={e => setUseLogo(e.target.checked)} />
                    <span>Add {kit.name} logo to the video</span>
                  </label>
                )}
              </div>

              <button className="generate-btn" onClick={runDirector} disabled={directing || busy}>
                {directing ? 'Gemini is planning...' : <><span style={{ marginRight: 6 }}>🎬</span>{plan ? 'Re-plan with Gemini' : 'Plan my ad with Gemini'}</>}
              </button>

              {plan && (
                <div className="plan-card">
                  <div className="plan-title">{plan.title || 'Your ad plan'}</div>
                  <label className="section-label" htmlFor="vprompt">Video prompt (English, for Veo)</label>
                  <textarea id="vprompt" className="prompt-textarea" style={{ minHeight: 110 }} maxLength={1800} value={prompt}
                    onChange={e => setPrompt(e.target.value)} />
                  {plan.caption && (
                    <>
                      <label className="section-label" style={{ marginTop: 10 }}>Caption and hashtags</label>
                      <p className="caption-text">{plan.caption}</p>
                      <p className="hashtag-text">{plan.hashtags.map(h => `#${h}`).join(' ')}</p>
                      <button className="action-btn" onClick={() => copy('plan', captionText({ caption: plan.caption, hashtags: plan.hashtags, brief: '', language: null, platform: null, directed: true }))}>
                        {copied === 'plan' ? 'Copied ✓' : 'Copy caption'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {narrationBlock}
              {lengthBlock}
              {settingsBlock}
            </>
          ) : (
            <>
              <div>
                <label className="section-label" htmlFor="prompt">Prompt</label>
                <div className="prompt-container">
                  <textarea id="prompt" className="prompt-textarea" placeholder="Describe your scene..." value={prompt}
                    maxLength={1800} onChange={e => setPrompt(e.target.value)} />
                  <button className="tts-btn" onClick={enhance} disabled={!prompt.trim() || enhancing} title="Enhance with Gemini" aria-label="Enhance prompt with Gemini">
                    {enhancing ? <div className="mini-spinner" style={{ width: 14, height: 14 }} /> : <span aria-hidden>✨</span>}
                  </button>
                </div>
                <p className="field-hint">✨ Gemini rewrites your idea into a director-grade prompt.</p>
              </div>

              <div>
                <label className="section-label">Preset <span className="count">{PRESETS.length} looks</span></label>
                <div className="chip-row" role="tablist">
                  {PRESET_CATEGORIES.map(c => (
                    <button key={c} role="tab" aria-selected={presetCategory === c}
                      className={`chip ${presetCategory === c ? 'active' : ''}`} onClick={() => setPresetCategory(c)}>{c}</button>
                  ))}
                </div>
                <div className="preset-grid">
                  <button className={`preset-card ${presetId === null ? 'selected' : ''}`} onClick={() => setPresetId(null)}>None</button>
                  {PRESETS.filter(p => p.category === presetCategory).map(p => (
                    <button key={p.id} className={`preset-card ${presetId === p.id ? 'selected' : ''}`} title={p.style}
                      onClick={() => setPresetId(p.id)}>{p.name}</button>
                  ))}
                </div>
                {preset && presetCategory !== preset.category && <p className="field-hint">Selected: {preset.name}</p>}
              </div>

              <div>
                <label className="section-label">Keyframes</label>
                <div className="media-inputs-grid">
                  {frameBox(startFrame, 'start')}
                  {frameBox(endFrame, 'end', !endFrameAllowed || !startFrame)}
                </div>
                <p className="field-hint">
                  {longClip
                    ? 'Start frame opens the clip. The end frame anchors the first 8 seconds; the extension then continues the story.'
                    : 'Start frame opens the clip; the end frame is where it lands.'}
                </p>
              </div>

              {lengthBlock}
              {settingsBlock}
              {narrationBlock}
            </>
          )}
        </div>

        <div className="config-footer">
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button className="generate-btn" onClick={generate} disabled={busy}>
            {busy ? 'Generating...' : <><span style={{ marginRight: 6 }}>✨</span>{isAd ? `Generate ${length}s ad` : `Generate ${length}s clip`}</>}
          </button>
          <div className="cost-display" title="List-price estimate; see the pricing panel">
            {cost.veoSeconds}s of Veo × {formatUsd(cost.veoUsd / cost.veoSeconds)}/s = {formatUsd(cost.veoUsd)}
            {cost.geminiUsd > 0 ? ` + Gemini ${formatUsd(cost.geminiUsd)}` : ''} · <b>{formatUsd(cost.totalUsd)}</b> · ~{estMinutes}-{estMinutes + 2} min
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="canvas-area">
        <div className="canvas-tabs">
          <button className={`tab-btn ${tab === 'canvas' ? 'active' : ''}`} onClick={() => setTab('canvas')}>Canvas</button>
          <button className={`tab-btn ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>Library</button>
        </div>
        <div className="canvas-content">
          {tab === 'canvas' ? (
            busy ? (
              <div className="loading-steps-container">
                <h3 style={{ marginBottom: 20 }}>Creating your video...</h3>
                {steps.map((label, i) => {
                  const current = (job?.stageNumber ?? 1) - 1;
                  const status = i < current ? 'completed' : i === current ? 'active' : 'pending';
                  return (
                    <div key={i} className={`step-item ${status}`}>
                      <div className="step-icon">
                        {status === 'completed' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                        {status === 'active' && <div className="mini-spinner" />}
                        {status === 'pending' && <div className="empty-dot" />}
                      </div>
                      <span className="step-label">{label}</span>
                    </div>
                  );
                })}
                <p className="field-hint" style={{ marginTop: 16 }}>You can leave this page open or come back later — your clip keeps rendering.</p>
              </div>
            ) : result ? (
              <div className="video-wrapper">
                <div className="result-badge">
                  {result.resolution} | {clock(result.length)} | {modelName(result.model)}{result.narration ? ' | Narrated' : ''}{result.logo ? ' | Logo' : ''}
                  {typeof result.costUsd === 'number' ? ` | ${formatUsd(result.costUsd)}` : ''}
                </div>
                <video key={result.id} src={result.url} controls autoPlay loop playsInline />
                <div className="video-actions">
                  <a className="action-btn" href={result.downloadUrl}>Download MP4</a>
                  <button className="action-btn" onClick={generate}>Regenerate</button>
                  {captionText(result.ad) && (
                    <button className="action-btn" onClick={() => copy('result', captionText(result.ad))}>{copied === 'result' ? 'Copied ✓' : 'Copy caption'}</button>
                  )}
                </div>
                {result.ad?.caption && <p className="caption-text" style={{ marginTop: 12, maxWidth: 420 }}>{result.ad.caption}</p>}
              </div>
            ) : (
              <div className="empty-state">
                <svg className="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                <h3>No video yet</h3>
                <p>{isAd ? 'Add a product photo, write one line about it and let Gemini plan the ad.' : 'Describe a scene, pick a preset and press Generate.'}</p>
              </div>
            )
          ) : (
            <div className="generations-grid">
              {library === null ? (
                <div className="empty-state" style={{ gridColumn: '1/-1', marginTop: 40 }}><div className="mini-spinner" /></div>
              ) : library.length === 0 ? (
                <div className="empty-state" style={{ gridColumn: '1/-1', marginTop: 40 }}><p>No clips yet.</p></div>
              ) : library.map(c => (
                <div key={c.id} className="history-card">
                  <div className="history-thumbnail" onClick={() => { setResult(c); setTab('canvas'); }}>
                    <video src={c.url} preload="metadata" muted style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onMouseOver={e => e.currentTarget.play()} onMouseOut={e => e.currentTarget.pause()} />
                  </div>
                  <div className="history-info">
                    <div className="history-prompt">{c.ad?.brief || c.prompt}</div>
                    <div className="history-date">
                      {c.resolution} • {c.aspectRatio} • {c.length}s{typeof c.costUsd === 'number' ? ` • ${formatUsd(c.costUsd)}` : ''}
                    </div>
                    <div className="card-actions">
                      {captionText(c.ad) && <button className="link-btn" onClick={() => copy(c.id, captionText(c.ad))}>{copied === c.id ? 'Copied ✓' : 'Copy caption'}</button>}
                      <button className="link-btn" onClick={() => removeClip(c.id)}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {kitsOpen && <BrandKitModal kits={kits} onChange={setKits} onClose={() => setKitsOpen(false)} />}
      {pricingOpen && <PricingModal onClose={() => setPricingOpen(false)} />}
    </div>
  );
};
