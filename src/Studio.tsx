import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from './firebase';
import * as api from './api';
import { PRESETS, PRESET_CATEGORIES, composePrompt, findPreset } from './presets';
import { prepareImage, type PreparedImage } from './image';
import { decode, decodeAudioData, getAudioContext, errorMessage } from '../utils';

const MODELS = [
  { id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast', description: 'Quick drafts. Cheaper, great for iterating.' },
  { id: 'veo-3.1-generate-001', name: 'Veo 3.1 HQ', description: 'Highest fidelity for final renders.' },
];
const LENGTHS = [4, 6, 8, 15, 20];
const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'];
const JOB_KEY = 'clipgen.job';
const POLL_MS = 5000;
const MAX_WAIT_MS = 25 * 60 * 1000;

type Frame = PreparedImage;

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
  // Inputs
  const [prompt, setPrompt] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetCategory, setPresetCategory] = useState<(typeof PRESET_CATEGORIES)[number]>('Cinematic');
  const [startFrame, setStartFrame] = useState<Frame | null>(null);
  const [endFrame, setEndFrame] = useState<Frame | null>(null);

  // Configuration
  const [model, setModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [length, setLength] = useState(8);
  const [narrationOn, setNarrationOn] = useState(false);
  const [narrationText, setNarrationText] = useState('');
  const [voice, setVoice] = useState('Kore');

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

  const modelRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);

  const preset = findPreset(presetId);
  const longClip = length > 8;
  const resolutionLocked = length < 8;
  const effectiveResolution = resolutionLocked ? '720p' : resolution;
  const endFrameAllowed = length >= 8;
  const estMinutes = length === 20 ? 6 : length === 15 ? 4 : 2;

  const steps = useMemo(() => {
    const ext = job?.extensions ?? (length === 20 ? 2 : length === 15 ? 1 : 0);
    const list = [`Generating the opening clip with ${model.name}`];
    for (let i = 1; i <= ext; i++) list.push(`Extending the scene (${i}/${ext})`);
    list.push(narrationOn ? 'Mastering MP4 and mixing Gemini narration' : 'Mastering the final MP4');
    return list;
  }, [job?.extensions, length, model.name, narrationOn]);

  // Close the model dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // A short clip cannot do 1080p or use an end frame; keep the form consistent.
  useEffect(() => {
    if (length < 8 && endFrame) setEndFrame(null);
  }, [length, endFrame]);

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

  async function generate() {
    if (!prompt.trim() && !startFrame) { setError('Write a prompt or add a start frame.'); return; }
    if (narrationOn && !narrationText.trim()) { setError('Write the narration script, or turn narration off.'); return; }
    setBusy(true);
    setError('');
    setResult(null);
    setTab('canvas');
    try {
      const payload: api.CreateJobPayload = {
        model: model.id,
        prompt: composePrompt(prompt, preset),
        preset: presetId,
        length,
        aspectRatio,
        resolution: effectiveResolution,
        narration: narrationOn ? { text: narrationText.trim(), voice } : null,
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
      const frame = await prepareImage(file);
      if (which === 'start') setStartFrame(frame);
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
      const { audio } = await api.speak(narrationText, voice);
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = decodeAudioData(decode(audio), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
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

  const identity = user.isAnonymous ? 'Guest' : user.email || 'Signed in';

  const frameBox = (frame: Frame | null, which: 'start' | 'end', disabled = false) =>
    frame ? (
      <div className="media-upload-box" style={{ cursor: 'default' }}>
        <img src={frame.preview} className="preview-thumb" alt={`${which} frame`} />
        <button className="remove-media-btn" aria-label={`Remove ${which} frame`}
          onClick={() => { URL.revokeObjectURL(frame.preview); if (which === 'start') setStartFrame(null); else setEndFrame(null); }}>&times;</button>
        <span className="frame-tag">{which === 'start' ? 'Start' : 'End'}</span>
      </div>
    ) : (
      <label className={`media-upload-box ${disabled ? 'is-disabled' : ''}`}
        title={disabled ? 'End frames need a clip length of 8s or more' : undefined}>
        <input type="file" accept="image/*" hidden disabled={disabled} onChange={e => onFile(e, which)} />
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        <span>{which === 'start' ? 'Start Frame' : 'End Frame'}</span>
      </label>
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
        <div className="spacer" />
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setMenuOpen(o => !o)} aria-label="Account" title={identity}>
            <div className="avatar-dot" />
          </button>
          {menuOpen && (
            <div className="account-menu" onMouseLeave={() => setMenuOpen(false)}>
              <div className="account-id">{identity}</div>
              {user.isAnonymous ? (
                <button onClick={() => { setMenuOpen(false); onOpenAuth(); }}>Sign in to keep your clips</button>
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
                  {MODELS.map(m => (
                    <div key={m.id} className={`model-dropdown-item ${model.id === m.id ? 'selected' : ''}`}
                      onClick={() => { setModel(m); setModelOpen(false); }}>
                      <div className="model-item-name">{m.name}</div>
                      <div className="model-item-desc">{m.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="panel-description">{model.description}</p>
        </div>

        <div className="config-content">
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

          <div>
            <label className="section-label">Length</label>
            <div className="segmented" role="radiogroup" aria-label="Clip length">
              {LENGTHS.map(l => (
                <button key={l} role="radio" aria-checked={length === l} className={length === l ? 'active' : ''}
                  onClick={() => setLength(l)}>{l}s</button>
              ))}
            </div>
            {longClip && <p className="field-hint">Built by extending the opening clip in 7s blocks and stitching them.</p>}
          </div>

          <div className="settings-group">
            <div className="setting-item">
              <div className="setting-label">Aspect ratio</div>
              <div className="setting-control" onClick={() => setAspectRatio(a => (a === '16:9' ? '9:16' : '16:9'))}>
                {aspectRatio}
              </div>
            </div>
            <div className="setting-item">
              <div className="setting-label">Resolution</div>
              <div className="setting-control" style={resolutionLocked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                title={resolutionLocked ? '1080p needs a clip length of 8s or more' : 'Click to change'}
                onClick={() => { if (!resolutionLocked) setResolution(r => (r === '720p' ? '1080p' : '720p')); }}>
                {effectiveResolution}
              </div>
            </div>
          </div>

          <div>
            <label className="section-label">Narration</label>
            <label className="switch-row">
              <input type="checkbox" checked={narrationOn} onChange={e => setNarrationOn(e.target.checked)} />
              <span>Add Gemini voice-over to the final clip</span>
            </label>
            {narrationOn && (
              <div className="narration-box">
                <textarea className="prompt-textarea" style={{ minHeight: 80 }} maxLength={600} value={narrationText}
                  placeholder="What should the narrator say?" onChange={e => setNarrationText(e.target.value)} aria-label="Narration script" />
                <div className="narration-row">
                  <select className="form-input" value={voice} onChange={e => setVoice(e.target.value)} aria-label="Narrator voice">
                    {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <button className="action-btn" onClick={previewVoice} disabled={!narrationText.trim() || previewing}>
                    {previewing ? 'Loading...' : '▶ Preview'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="config-footer">
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button className="generate-btn" onClick={generate} disabled={busy}>
            {busy ? 'Generating...' : <><span style={{ marginRight: 6 }}>✨</span>Generate {length}s clip</>}
          </button>
          <div className="cost-display">About {estMinutes}-{estMinutes + 2} min · {modelName(model.id)} · {effectiveResolution}</div>
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
                <div className="result-badge">{result.resolution} | {clock(result.length)} | {modelName(result.model)}{result.narration ? ' | Narrated' : ''}</div>
                <video key={result.id} src={result.url} controls autoPlay loop playsInline />
                <div className="video-actions">
                  <a className="action-btn" href={result.downloadUrl}>Download MP4</a>
                  <button className="action-btn" onClick={generate}>Regenerate</button>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <svg className="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                <h3>No video yet</h3>
                <p>Describe a scene, pick a preset and press Generate.</p>
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
                    <div className="history-prompt">{c.prompt}</div>
                    <div className="history-date">{c.resolution} • {c.aspectRatio} • {c.length}s</div>
                    <button className="link-btn" onClick={() => removeClip(c.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
