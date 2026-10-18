import React from 'react';
import {
  UNIT_ROWS, PLAN_OFFERS, FAST_AD_COST, HQ_AD_COST, formatUsd, formatPct, GEMINI_USD_PER_CLIP,
} from './pricing';

/** Unit economics of one 20-second ad and how ads are sold. Numbers come from src/pricing.ts. */
export const UnitEconomics = () => (
  <div className="econ">
    <div className="econ-table" role="table" aria-label="Cost of one 20 second ad">
      <div className="econ-head" role="row">
        <span>Cost item (1080p)</span><span>Price</span><span>Per 20 s ad*</span>
      </div>
      {UNIT_ROWS.map(r => (
        <div className="econ-row" role="row" key={r.label}>
          <span>{r.label}</span><span>{formatUsd(r.perSecond)} / s</span><span>{formatUsd(r.adCost)}</span>
        </div>
      ))}
      <div className="econ-row" role="row">
        <span>Gemini 2.5 Flash TTS, 20 s voice-over</span><span>audio tokens</span><span>{formatUsd(GEMINI_USD_PER_CLIP.tts)}</span>
      </div>
      <div className="econ-row" role="row">
        <span>Gemini 2.5 Flash creative director</span><span>text tokens</span><span>~{formatUsd(GEMINI_USD_PER_CLIP.director)}</span>
      </div>
    </div>
    <p className="field-hint">
      *A 20 s ad is built from 22 s of generated video (8 s + two 7 s extensions, trimmed), so it is billed for 22 s.
      Totals include narration and the director: Fast ad {formatUsd(FAST_AD_COST)}, HQ ad {formatUsd(HQ_AD_COST)}.
      Turn off Veo sound to use the cheaper video-only rate. Hosting is not included; list prices, verify before budgeting.
    </p>

    <div className="offer-grid">
      {PLAN_OFFERS.map(p => (
        <div className="landing-card" key={p.id}>
          <div className="step-no">{p.name.toUpperCase()}</div>
          <h3>{p.price}</h3>
          <p>{p.detail}</p>
          {p.margin !== null && <p className="margin">Gross margin on a Fast ad: <b>{formatPct(p.margin)}</b></p>}
        </div>
      ))}
    </div>
    <p className="field-hint">
      We price per ad, not per second. Margin = (price − API cost) / price, before hosting, payment fees and taxes.
    </p>
  </div>
);

export const PricingModal = ({ onClose }: { onClose: () => void }) => (
  <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-content pricing-modal" role="dialog" aria-modal="true" aria-label="Unit economics">
      <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
      <h2 style={{ marginBottom: 6 }}>What a video costs</h2>
      <p className="field-hint" style={{ marginTop: 0, marginBottom: 16 }}>Transparent unit economics for one 20-second ad.</p>
      <UnitEconomics />
    </div>
  </div>
);
