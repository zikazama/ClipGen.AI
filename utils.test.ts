import { test, describe } from 'node:test';
import assert from 'node:assert';
import { decodeAudioData, decode } from './utils.ts';

describe('decodeAudioData', () => {
  // Mock AudioContext
  class MockAudioBuffer {
    channels: Float32Array[];
    constructor(numChannels: number, frameCount: number, sampleRate: number) {
      this.channels = Array(numChannels).fill(0).map(() => new Float32Array(frameCount));
    }
    getChannelData(channel: number) {
      return this.channels[channel];
    }
  }

  const mockCtx = {
    createBuffer: (numChannels: number, frameCount: number, sampleRate: number) => {
      return new MockAudioBuffer(numChannels, frameCount, sampleRate);
    }
  } as unknown as AudioContext;

  test('should correctly decode mono audio data', async () => {
    const dataInt16 = new Int16Array([0, 16384, -16384, 32767]); // 4 samples
    const data = new Uint8Array(dataInt16.buffer);

    const buffer = await decodeAudioData(data, mockCtx, 24000, 1); // 1 channel

    assert.strictEqual(buffer.getChannelData(0).length, 4);

    assert.strictEqual(buffer.getChannelData(0)[0], 0);
    assert.strictEqual(buffer.getChannelData(0)[1], 16384 / 32768.0);
    assert.strictEqual(buffer.getChannelData(0)[2], -16384 / 32768.0);
    assert.strictEqual(buffer.getChannelData(0)[3], 32767 / 32768.0);
  });

  test('should correctly decode stereo audio data', async () => {
    const dataInt16 = new Int16Array([0, 16384, -16384, 32767]); // 4 samples
    const data = new Uint8Array(dataInt16.buffer); // 8 bytes

    const buffer = await decodeAudioData(data, mockCtx, 24000, 2); // 2 channels, 2 frames per channel

    assert.strictEqual(buffer.getChannelData(0).length, 2);
    assert.strictEqual(buffer.getChannelData(1).length, 2);

    // Frame 0
    // Channel 0: 0
    assert.strictEqual(buffer.getChannelData(0)[0], 0);
    // Channel 1: 16384 / 32768 = 0.5
    assert.strictEqual(buffer.getChannelData(1)[0], 0.5);

    // Frame 1
    // Channel 0: -16384 / 32768 = -0.5
    assert.strictEqual(buffer.getChannelData(0)[1], -0.5);
    // Channel 1: 32767 / 32768 = 0.999969482421875
    assert.strictEqual(buffer.getChannelData(1)[1], 32767 / 32768.0);
  });

  test('should correctly handle decoding an empty buffer', async () => {
    const data = new Uint8Array(0);

    const buffer = await decodeAudioData(data, mockCtx, 24000, 1);

    assert.strictEqual(buffer.getChannelData(0).length, 0);
  });

  test('should properly scale minimum and maximum Int16 values', async () => {
    const dataInt16 = new Int16Array([-32768, 32767]); // Min and max values
    const data = new Uint8Array(dataInt16.buffer);

    const buffer = await decodeAudioData(data, mockCtx, 24000, 1);

    assert.strictEqual(buffer.getChannelData(0).length, 2);

    // -32768 / 32768.0 = -1.0
    assert.strictEqual(buffer.getChannelData(0)[0], -1.0);
    // 32767 / 32768.0 = 0.999969482421875
    assert.strictEqual(buffer.getChannelData(0)[1], 32767 / 32768.0);
  });
});
