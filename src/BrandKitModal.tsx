import React, { useEffect, useState } from 'react';
import * as api from './api';
import { AD_LANGUAGES } from './ad';
import { prepareLogo } from './image';
import { errorMessage } from '../utils';

interface BrandKitModalProps {
  kits: api.BrandKit[];
  onChange: (kits: api.BrandKit[]) => void;
  onClose: () => void;
}

const EMPTY: api.BrandKitInput = { name: '', tone: '', audience: '', colors: ['#B06028'], language: 'id' };

export const BrandKitModal = ({ kits, onChange, onClose }: BrandKitModalProps) => {
  const [editingId, setEditingId] = useState<string | 'new' | null>(kits.length ? null : 'new');
  const [form, setForm] = useState<api.BrandKitInput>(EMPTY);
  const [logo, setLogo] = useState<{ base64: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editingId === 'new') { setForm(EMPTY); setLogo(null); }
    else if (editingId) {
      const k = kits.find(x => x.id === editingId);
      if (k) { setForm({ name: k.name, tone: k.tone, audience: k.audience, colors: k.colors, language: k.language }); setLogo(null); }
    }
    setError('');
  }, [editingId]);

  const refresh = async () => onChange((await api.listBrandKits()).kits);

  async function save() {
    setBusy(true);
    setError('');
    try {
      let saved: api.BrandKit;
      if (editingId === 'new') saved = await api.createBrandKit(form);
      else saved = await api.updateBrandKit(editingId as string, form);
      if (logo) await api.uploadBrandLogo(saved.id, logo.base64);
      await refresh();
      setEditingId(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteBrandKit(id);
      await refresh();
      setEditingId(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setLogo(await prepareLogo(file));
      setError('');
    } catch {
      setError('Could not read that image. Use a PNG or JPEG logo.');
    }
  }

  const setColor = (i: number, value: string) =>
    setForm(f => ({ ...f, colors: f.colors.map((c, idx) => (idx === i ? value : c)) }));
  const current = editingId && editingId !== 'new' ? kits.find(k => k.id === editingId) : null;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content kit-modal" role="dialog" aria-modal="true" aria-label="Brand kits">
        <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        <h2 style={{ marginBottom: 6 }}>Brand kits</h2>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: 16 }}>
          Save your logo, colours and tone once. Gemini writes every ad in your voice and the logo is added to the video.
        </p>

        {editingId === null ? (
          <>
            {kits.length === 0 && <p className="field-hint">No brand kits yet.</p>}
            <div className="kit-list">
              {kits.map(k => (
                <button key={k.id} className="kit-row" onClick={() => setEditingId(k.id)}>
                  {k.logoUrl ? <img src={k.logoUrl} alt="" /> : <span className="kit-swatch" style={{ background: k.colors[0] || '#444' }} />}
                  <span><b>{k.name}</b><small>{k.tone || 'No tone set'}</small></span>
                </button>
              ))}
            </div>
            <button className="btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => setEditingId('new')} disabled={kits.length >= 5}>
              {kits.length >= 5 ? 'Limit reached (5)' : '+ New brand kit'}
            </button>
          </>
        ) : (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="kit-name">Brand name</label>
              <input id="kit-name" className="form-input" maxLength={40} value={form.name} placeholder="Kopi Pagi"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="kit-tone">Tone of voice</label>
              <input id="kit-tone" className="form-input" maxLength={120} value={form.tone} placeholder="hangat, santai, anak muda"
                onChange={e => setForm(f => ({ ...f, tone: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="kit-aud">Target audience</label>
              <input id="kit-aud" className="form-input" maxLength={100} value={form.audience} placeholder="pekerja kantoran 20-35 tahun"
                onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Brand colours</label>
              <div className="color-row">
                {form.colors.map((c, i) => (
                  <input key={i} type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={e => setColor(i, e.target.value)} />
                ))}
                {form.colors.length < 5 && (
                  <button className="chip" onClick={() => setForm(f => ({ ...f, colors: [...f.colors, '#FFFFFF'] }))}>+ colour</button>
                )}
                {form.colors.length > 1 && (
                  <button className="chip" onClick={() => setForm(f => ({ ...f, colors: f.colors.slice(0, -1) }))}>− colour</button>
                )}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="kit-lang">Default narration language</label>
              <select id="kit-lang" className="form-input" value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}>
                {AD_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}{l.beta ? ' (beta)' : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Logo (PNG with transparency works best)</label>
              <div className="logo-row">
                {(logo?.preview || current?.logoUrl) && <img className="logo-preview" src={logo?.preview || current?.logoUrl || ''} alt="Logo preview" />}
                <label className="action-btn" style={{ cursor: 'pointer' }}>
                  {logo || current?.hasLogo ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogo} />
                </label>
              </div>
            </div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <div className="narration-row">
              <button className="btn-primary" style={{ flex: 1 }} onClick={save} disabled={busy || !form.name.trim()}>
                {busy ? 'Saving...' : 'Save brand kit'}
              </button>
              <button className="btn-secondary" onClick={() => setEditingId(kits.length ? null : 'new')} disabled={busy}>Cancel</button>
            </div>
            {current && <button className="link-btn" onClick={() => remove(current.id)} disabled={busy}>Delete this brand kit</button>}
          </div>
        )}
        {editingId === null && error && <div className="error-banner" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
};
