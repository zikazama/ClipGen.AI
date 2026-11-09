import { describe, expect, it } from 'vitest';

import { parseImage, validate } from './validation.js';

const FAST = 'veo-3.1-fast-generate-001';
const HQ = 'veo-3.1-generate-001';

const base = {
  model: FAST,
  prompt: 'a coffee cup on a wooden table',
  length: 8,
  aspectRatio: '9:16',
  resolution: '720p',
};

const signedIn = { uid: 'u1', guest: false };
const guest = { uid: 'g1', guest: true };

function expectHttpError(fn: () => unknown, status: number, messagePart?: string) {
  try {
    fn();
  } catch (error) {
    const typed = error as { status?: number; message?: string };
    expect(typed.status).toBe(status);
    if (messagePart) expect(typed.message).toContain(messagePart);
    return;
  }
  throw new Error('Expected the call to throw');
}

describe('validate', () => {
  it('accepts a normal signed in request', () => {
    const v = validate({ ...base }, signedIn);
    expect(v.model).toBe(FAST);
    expect(v.prompt).toBe(base.prompt);
    expect(v.length).toBe(8);
    expect(v.resolution).toBe('720p');
    expect(v.sound).toBe(true);
  });

  it('rejects a model that is not on the list', () => {
    expectHttpError(() => validate({ ...base, model: 'veo-9-turbo' }, signedIn), 400, 'Model not allowed');
  });

  it('needs a prompt or a start frame', () => {
    expectHttpError(() => validate({ ...base, prompt: '   ' }, signedIn), 400, 'Prompt or start frame required');
  });

  it('caps the prompt length', () => {
    const v = validate({ ...base, prompt: 'x'.repeat(5000) }, signedIn);
    expect(v.prompt.length).toBe(1800);
  });

  it('keeps guests on the Fast model', () => {
    expectHttpError(() => validate({ ...base, model: HQ }, guest), 403);
  });

  it('keeps guests on clips of 8 seconds or less', () => {
    expectHttpError(() => validate({ ...base, length: 20 }, guest), 403);
    expect(validate({ ...base, length: 8 }, guest).length).toBe(8);
  });

  it('allows signed in users to pick the HQ model and long clips', () => {
    const v = validate({ ...base, model: HQ, length: 20 }, signedIn);
    expect(v.model).toBe(HQ);
    expect(v.length).toBe(20);
  });

  it('rejects an unsupported length', () => {
    expectHttpError(() => validate({ ...base, length: 12 }, signedIn), 400, 'Unsupported length');
  });

  it('needs a start frame before an end frame', () => {
    const endFrame = { imageBytes: 'AAAA', mimeType: 'image/png' };
    expectHttpError(() => validate({ ...base, lastFrame: endFrame }, signedIn), 400, 'End frame requires a start frame');
  });

  it('only allows an end frame on clips of 8 seconds or more', () => {
    const image = { imageBytes: 'AAAA', mimeType: 'image/png' };
    const lastFrame = { imageBytes: 'BBBB', mimeType: 'image/png' };
    expectHttpError(() => validate({ ...base, length: 4, image, lastFrame }, signedIn), 400, '8s or more');
    expect(validate({ ...base, length: 8, image, lastFrame }, signedIn).lastFrame).not.toBeNull();
  });

  it('only allows 1080p on an 8 second base clip', () => {
    expect(validate({ ...base, length: 4, resolution: '1080p' }, signedIn).resolution).toBe('720p');
    expect(validate({ ...base, length: 8, resolution: '1080p' }, signedIn).resolution).toBe('1080p');
  });

  it('falls back to a known voice and style', () => {
    const v = validate({ ...base, narration: { text: 'hello', voice: 'NotAVoice', style: 'nope' } }, signedIn);
    expect(v.narration?.voice).toBe('Kore');
    expect(v.narration?.style).toBe('neutral');
  });

  it('keeps a known voice', () => {
    const v = validate({ ...base, narration: { text: 'halo', voice: 'Puck', style: 'upbeat' } }, signedIn);
    expect(v.narration?.voice).toBe('Puck');
    expect(v.narration?.style).toBe('upbeat');
  });

  it('cleans the ad metadata', () => {
    const v = validate(
      {
        ...base,
        ad: {
          brief: 'kopi susu',
          caption: 'coba sekarang',
          hashtags: ['a'.repeat(50), '  ', 'kedai'],
          language: 'id',
          platform: 'tiktok',
          directed: true,
        },
      },
      signedIn,
    );
    expect(v.ad?.hashtags.length).toBe(2);
    expect(v.ad?.hashtags[0]?.length).toBe(30);
    expect(v.ad?.platform).toBe('tiktok');
  });

  it('drops an unknown platform or language', () => {
    const v = validate({ ...base, ad: { brief: 'x', caption: 'y', hashtags: [], language: 'xx', platform: 'nowhere' } }, signedIn);
    expect(v.ad?.language).toBeNull();
    expect(v.ad?.platform).toBeNull();
  });

  it('keeps adult people out unless the caller asks for it', () => {
    expect(validate({ ...base }, signedIn).personGeneration).toBe('dont_allow');
    expect(validate({ ...base, personGeneration: 'allow_adult' }, signedIn).personGeneration).toBe('allow_adult');
    expect(validate({ ...base, personGeneration: 'nonsense' }, signedIn).personGeneration).toBe('dont_allow');
  });
});

describe('parseImage', () => {
  it('accepts PNG, JPEG and WebP', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(parseImage({ imageBytes: 'AAAA', mimeType }, 'Product photo')?.mimeType).toBe(mimeType);
    }
  });

  it('rejects other mime types', () => {
    expectHttpError(() => parseImage({ imageBytes: 'AAAA', mimeType: 'image/gif' }, 'Product photo'), 400, 'PNG, JPEG or WebP');
  });

  it('rejects an empty payload', () => {
    expectHttpError(() => parseImage({ imageBytes: '', mimeType: 'image/png' }, 'Product photo'), 400, 'Invalid');
  });

  it('rejects an image over 8 MB', () => {
    const big = 'A'.repeat(Math.ceil((8 * 1024 * 1024) / 0.75) + 10);
    expectHttpError(() => parseImage({ imageBytes: big, mimeType: 'image/png' }, 'Product photo'), 413, 'too large');
  });

  it('returns null when there is no image', () => {
    expect(parseImage(null, 'Product photo')).toBeNull();
    expect(parseImage(undefined, 'Product photo')).toBeNull();
  });
});
