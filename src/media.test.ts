import { describe, it, expect } from 'vitest';
import { buildFilterGraph } from '../server/lib/media.js';
import { maxScriptWords } from '../server/lib/config.js';

describe('buildFilterGraph', () => {
  it('maps the raw streams when there is nothing to add', () => {
    const g = buildFilterGraph({ narration: false, backgroundAudio: false, logo: false });
    expect(g.filters).toEqual([]);
    expect(g.videoMap).toBe('0:v:0');
    expect(g.audioMap).toEqual(['-map', '0:a?']);
  });

  it('numbers inputs video, narration, logo', () => {
    const g = buildFilterGraph({ narration: true, backgroundAudio: true, logo: true });
    expect(g.narrationIdx).toBe(1);
    expect(g.logoIdx).toBe(2);
    expect(g.filters.join(';')).toContain('[2:v][0:v]scale2ref');
    expect(g.filters.join(';')).toContain('[1:a]adelay');
    expect(g.videoMap).toBe('[v]');
    expect(g.audioMap).toEqual(['-map', '[a]']);
  });

  it('puts the logo at index 1 when there is no narration', () => {
    const g = buildFilterGraph({ narration: false, backgroundAudio: false, logo: true });
    expect(g.logoIdx).toBe(1);
    expect(g.audioMap).toEqual(['-map', '0:a?']);
  });

  it('ducks the original audio only when the clip has any', () => {
    const withBg = buildFilterGraph({ narration: true, backgroundAudio: true, logo: false }).filters.join(';');
    const noBg = buildFilterGraph({ narration: true, backgroundAudio: false, logo: false }).filters.join(';');
    expect(withBg).toContain('amix');
    expect(noBg).not.toContain('amix');
  });
});

describe('maxScriptWords', () => {
  it('scales with clip length and never gets too small', () => {
    expect(maxScriptWords(20)).toBeGreaterThan(maxScriptWords(15));
    expect(maxScriptWords(15)).toBeGreaterThan(maxScriptWords(8));
    expect(maxScriptWords(4)).toBeGreaterThanOrEqual(6);
  });
});
