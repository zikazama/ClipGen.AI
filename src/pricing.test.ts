import { describe, it, expect } from 'vitest';
import {
  estimateCost, UNIT_ROWS, PLAN_OFFERS, FAST_AD_COST, HQ_AD_COST, GUEST_TRIAL_COST, formatPct,
  VEO_USD_PER_SEC, GEMINI_USD_PER_CLIP, LENGTH_PLANS, EXTENSION_SECONDS,
} from './pricing';
import * as server from '../server/lib/pricing.js';
import { LENGTHS } from '../server/lib/config.js';

const FAST = 'veo-3.1-fast-generate-001';
const HQ = 'veo-3.1-generate-001';

describe('estimateCost', () => {
  it('bills 22 generated seconds for a 20s clip (8s base + two 7s extensions)', () => {
    const c = estimateCost({ model: FAST, resolution: '1080p', length: 20 });
    expect(c.veoSeconds).toBe(22);
    expect(c.veoUsd).toBeCloseTo(22 * 0.12, 5);
    expect(c.geminiUsd).toBe(0);
  });

  it('adds Gemini costs only when narration or the director is used', () => {
    const base = { model: FAST, resolution: '720p' as const, length: 8 };
    const plain = estimateCost(base).totalUsd;
    expect(estimateCost({ ...base, narration: true }).totalUsd).toBeCloseTo(plain + GEMINI_USD_PER_CLIP.tts, 5);
    expect(estimateCost({ ...base, director: true }).totalUsd).toBeCloseTo(plain + GEMINI_USD_PER_CLIP.director, 5);
  });

  it('video-only clips are never more expensive than clips with sound', () => {
    for (const model of [FAST, HQ]) {
      const withSound = estimateCost({ model, resolution: '1080p', length: 20, sound: true }).totalUsd;
      const silent = estimateCost({ model, resolution: '1080p', length: 20, sound: false }).totalUsd;
      expect(silent).toBeLessThanOrEqual(withSound);
    }
    // HQ video-only halves the Veo bill.
    const hq = (sound: boolean) => estimateCost({ model: HQ, resolution: '1080p', length: 20, sound }).veoUsd;
    expect(hq(false)).toBeCloseTo(hq(true) / 2, 5);
  });
});

describe('unit economics', () => {
  it('lists the four Veo price points', () => {
    expect(UNIT_ROWS).toHaveLength(4);
    expect(UNIT_ROWS[0].perSecond).toBe(0.12);
    expect(UNIT_ROWS[1].perSecond).toBe(0.4);
  });

  it('a Fast ad with narration costs about $2.65 because 22 s are generated', () => {
    expect(FAST_AD_COST).toBeCloseTo(22 * 0.12 + 0.005 + 0.002, 5);
    expect(HQ_AD_COST).toBeCloseTo(22 * 0.4 + 0.007, 5);
  });

  it('the guest trial is one Fast 8s draft', () => {
    expect(GUEST_TRIAL_COST).toBeCloseTo(8 * 0.12, 5);
  });

  it('every paid offer sells above cost, with the margin computed from real cost', () => {
    for (const plan of PLAN_OFFERS.filter(p => p.id !== 'guest')) {
      expect(plan.perAd).toBeGreaterThan(plan.costPerAd);
      expect(plan.margin).toBeCloseTo((plan.perAd - plan.costPerAd) / plan.perAd, 8);
    }
    expect(PLAN_OFFERS.find(p => p.id === 'guest')!.margin).toBeNull();
  });

  it('formats percentages', () => {
    expect(formatPct(0.337)).toBe('34%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('client and server price models stay in sync', () => {
  it('uses identical per-second prices and constants', () => {
    expect(VEO_USD_PER_SEC).toEqual(server.VEO_USD_PER_SEC);
    expect(GEMINI_USD_PER_CLIP).toEqual(server.GEMINI_USD_PER_CLIP);
    expect(EXTENSION_SECONDS).toBe(server.EXTENSION_SECONDS);
    expect(LENGTH_PLANS).toEqual(LENGTHS);
  });

  it('computes the same totals as the server', () => {
    for (const model of [FAST, HQ]) {
      for (const resolution of ['720p', '1080p'] as const) {
        for (const length of [4, 6, 8, 15, 20]) {
          for (const sound of [true, false]) {
            const c = estimateCost({ model, resolution, length, narration: true, director: true, sound });
            const s = server.estimateCost({ model, resolution, plan: LENGTHS[length], narration: true, director: true, sound });
            expect(c.totalUsd).toBeCloseTo(s.totalUsd, 8);
          }
        }
      }
    }
  });
});
