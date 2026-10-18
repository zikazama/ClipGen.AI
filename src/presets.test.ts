import { describe, it, expect } from 'vitest';
import { PRESETS, PRESET_CATEGORIES, composePrompt, findPreset } from './presets';

describe('presets', () => {
  it('ships at least 30 presets with unique ids', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
  });

  it('only uses known categories and has a style for every preset', () => {
    for (const p of PRESETS) {
      expect(PRESET_CATEGORIES).toContain(p.category);
      expect(p.style.length).toBeGreaterThan(10);
    }
  });

  it('finds presets by id', () => {
    expect(findPreset('film-noir')?.name).toBe('Film Noir');
    expect(findPreset('nope')).toBeNull();
    expect(findPreset(null)).toBeNull();
  });
});

describe('composePrompt', () => {
  const noir = findPreset('film-noir')!;

  it('returns the trimmed prompt when there is no preset', () => {
    expect(composePrompt('  a cat  ', null)).toBe('a cat');
  });

  it('appends the preset style without doubling punctuation', () => {
    expect(composePrompt('a cat.', noir)).toBe(`a cat. Style: ${noir.style}.`);
    expect(composePrompt('a cat', noir)).toBe(`a cat. Style: ${noir.style}.`);
  });

  it('falls back to the style alone for an empty prompt', () => {
    expect(composePrompt('   ', noir)).toBe(`${noir.style}.`);
  });
});
