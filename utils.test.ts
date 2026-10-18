import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decode, decodeAudioData, errorMessage, getAudioContext } from './utils';

class FakeAudioBuffer {
  private data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) {
    return this.data[channel];
  }
}

const fakeCtx = {
  createBuffer: (ch: number, len: number, rate: number) => new FakeAudioBuffer(ch, len, rate),
} as unknown as BaseAudioContext;

describe('decode', () => {
  it('decodes base64 to bytes', () => {
    expect(decode('aGVsbG8=')).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  it('handles empty input and padding', () => {
    expect(decode('')).toEqual(new Uint8Array([]));
    expect(decode('aGk=')).toEqual(new Uint8Array([104, 105]));
    expect(decode('aA==')).toEqual(new Uint8Array([104]));
  });

  it('throws on invalid base64', () => {
    expect(() => decode('***')).toThrow();
  });
});

describe('decodeAudioData', () => {
  const pcm = (...samples: number[]) => new Uint8Array(new Int16Array(samples).buffer);

  it('normalises 16-bit PCM to [-1, 1) for mono audio', () => {
    const buf = decodeAudioData(pcm(0, 16384, -32768), fakeCtx, 24000, 1);
    expect(buf.length).toBe(3);
    expect(buf.sampleRate).toBe(24000);
    expect(Array.from(buf.getChannelData(0))).toEqual([0, 0.5, -1]);
  });

  it('de-interleaves multiple channels', () => {
    const buf = decodeAudioData(pcm(16384, -16384, 8192, -8192), fakeCtx, 24000, 2);
    expect(Array.from(buf.getChannelData(0))).toEqual([0.5, 0.25]);
    expect(Array.from(buf.getChannelData(1))).toEqual([-0.5, -0.25]);
  });

  it('respects the byteOffset of a view into a larger buffer', () => {
    const whole = new Uint8Array(new Int16Array([111, 16384]).buffer);
    const view = whole.subarray(2);
    expect(Array.from(decodeAudioData(view, fakeCtx, 24000, 1).getChannelData(0))).toEqual([0.5]);
  });

  it('ignores a trailing odd byte instead of throwing', () => {
    const bytes = new Uint8Array([0, 64, 1]);
    expect(decodeAudioData(bytes, fakeCtx, 24000, 1).length).toBe(1);
  });
});

describe('errorMessage', () => {
  it('extracts messages from Error and string values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
  });

  it('falls back for anything else', () => {
    expect(errorMessage(null)).toBe('An unexpected error occurred.');
    expect(errorMessage({}, 'custom')).toBe('custom');
  });
});

describe('getAudioContext', () => {
  const created: number[] = [];
  beforeEach(() => {
    created.length = 0;
    class FakeCtx {
      state = 'running';
      constructor(opts: { sampleRate: number }) {
        created.push(opts.sampleRate);
      }
    }
    vi.stubGlobal('window', { AudioContext: FakeCtx });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates one context and reuses it', () => {
    const a = getAudioContext(24000);
    const b = getAudioContext(24000);
    expect(a).toBe(b);
    expect(created).toEqual([24000]);
  });

  it('recreates the context if it was closed', () => {
    const a = getAudioContext();
    (a as unknown as { state: string }).state = 'closed';
    expect(getAudioContext()).not.toBe(a);
  });
});
