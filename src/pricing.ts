// Cost model for a finished clip. Mirrors server/lib/pricing.js (a unit test keeps them in sync).
// All figures are USD list-price estimates for Veo 3.1 and Gemini; verify current rates before budgeting.

export type Resolution = '720p' | '1080p';
type SoundMode = 'audio' | 'silent';

/** "audio" = Veo generates native sound (default). "silent" = video only, billed lower by Google. */
export const VEO_USD_PER_SEC: Record<string, Record<SoundMode, Record<Resolution, number>>> = {
  'veo-3.1-fast-generate-001': {
    audio: { '720p': 0.1, '1080p': 0.12 },
    silent: { '720p': 0.1, '1080p': 0.1 },
  },
  'veo-3.1-generate-001': {
    audio: { '720p': 0.4, '1080p': 0.4 },
    silent: { '720p': 0.2, '1080p': 0.2 },
  },
};
export const GEMINI_USD_PER_CLIP = { director: 0.002, tts: 0.005 };
export const EXTENSION_SECONDS = 7;

export interface LengthPlan { base: number; extensions: number }
export const LENGTH_PLANS: Record<number, LengthPlan> = {
  4: { base: 4, extensions: 0 },
  6: { base: 6, extensions: 0 },
  8: { base: 8, extensions: 0 },
  15: { base: 8, extensions: 1 },
  20: { base: 8, extensions: 2 },
};

export interface CostInput {
  model: string;
  resolution: Resolution;
  length: number;
  narration?: boolean;
  director?: boolean;
  sound?: boolean;
}

export interface CostEstimate {
  /** Seconds of video Veo actually generates (and bills), including the unused tail of an extension. */
  veoSeconds: number;
  veoUsd: number;
  geminiUsd: number;
  totalUsd: number;
}

export function estimateCost({ model, resolution, length, narration = false, director = false, sound = true }: CostInput): CostEstimate {
  const plan = LENGTH_PLANS[length] ?? LENGTH_PLANS[8];
  const veoSeconds = plan.base + plan.extensions * EXTENSION_SECONDS;
  const veoUsd = veoSeconds * (VEO_USD_PER_SEC[model]?.[sound ? 'audio' : 'silent']?.[resolution] ?? 0);
  const geminiUsd = (narration ? GEMINI_USD_PER_CLIP.tts : 0) + (director ? GEMINI_USD_PER_CLIP.director : 0);
  return { veoSeconds, veoUsd, geminiUsd, totalUsd: veoUsd + geminiUsd };
}

/** Two decimals, or three for sub-cent amounts such as a Gemini call ($0.002). */
export const formatUsd = (v: number) => (v > 0 && v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

// --- Unit economics (cost of one 20-second ad) ---

const FAST = 'veo-3.1-fast-generate-001';
const HQ = 'veo-3.1-generate-001';

export interface UnitRow {
  label: string;
  perSecond: number;
  /** Cost of one 20 s ad, including narration and the creative director. */
  adCost: number;
}

const adRow = (label: string, model: string, sound: boolean): UnitRow => ({
  label,
  perSecond: VEO_USD_PER_SEC[model][sound ? 'audio' : 'silent']['1080p'],
  adCost: estimateCost({ model, resolution: '1080p', length: 20, narration: true, director: true, sound }).totalUsd,
});

export const UNIT_ROWS: UnitRow[] = [
  adRow('Veo 3.1 Fast, with sound · 1080p', FAST, true),
  adRow('Veo 3.1 HQ, with sound · 1080p', HQ, true),
  adRow('Veo 3.1 Fast, video only · 1080p', FAST, false),
  adRow('Veo 3.1 HQ, video only · 1080p', HQ, false),
];

export const FAST_AD_COST = UNIT_ROWS[0].adCost;
export const HQ_AD_COST = UNIT_ROWS[1].adCost;

// --- Pricing model: how ads are sold (priced per ad, not per second) ---

export interface PlanOffer {
  id: 'guest' | 'pack' | 'seller';
  name: string;
  price: string;
  /** Revenue per Fast ad in USD (0 for the free guest trial). */
  perAd: number;
  /** Our API cost for what the offer includes, per Fast ad. */
  costPerAd: number;
  /** Gross margin on a Fast ad before hosting, payment fees and taxes; null when free. */
  margin: number | null;
  detail: string;
}

const margin = (price: number, cost: number) => (price > 0 ? (price - cost) / price : null);

/** The free guest trial: one Fast 8 s draft, 1080p, no extension. */
export const GUEST_TRIAL_COST = estimateCost({ model: FAST, resolution: '1080p', length: 8 }).totalUsd;

export const PLAN_OFFERS: PlanOffer[] = [
  {
    id: 'guest', name: 'Guest trial', price: 'Free', perAd: 0, costPerAd: GUEST_TRIAL_COST, margin: null,
    detail: `1 Fast 8 s draft per guest. Our cost ${formatUsd(GUEST_TRIAL_COST)}, treated as acquisition cost.`,
  },
  {
    id: 'pack', name: 'Credit pack', price: '$40 / 10 ads', perAd: 4, costPerAd: FAST_AD_COST,
    margin: margin(4, FAST_AD_COST),
    detail: `$4.00 per Fast ad. An HQ ad costs 3 credits ($12): ${Math.round((margin(12, HQ_AD_COST) ?? 0) * 100)}% margin.`,
  },
  {
    id: 'seller', name: 'Seller plan', price: '$99 / month', perAd: 99 / 30, costPerAd: FAST_AD_COST,
    margin: margin(99 / 30, FAST_AD_COST),
    detail: '30 Fast ads included ($3.30 each). Top-ups at pack price.',
  },
];

export const formatPct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
