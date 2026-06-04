import test from 'node:test';
import assert from 'node:assert';
import { decodeAudioData } from './utils.ts';

// Mock AudioContext and AudioBuffer
class MockAudioBuffer {
  private channels: Float32Array[];
  numberOfChannels: number;
  length: number;
  sampleRate: number;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    if (channel >= this.numberOfChannels || channel < 0) {
      throw new Error("Invalid channel");
    }
    return this.channels[channel];
  }
}

class MockAudioContext {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }
}

test('decodeAudioData tests', async (t) => {
  const ctx = new MockAudioContext() as unknown as AudioContext;
  const sampleRate = 44100;

  await t.test('Happy path: decodes 1 channel correctly', async () => {
    const numChannels = 1;
    // 4 samples: 16384, -16384, 32767, -32768
    const pcmData = new Int16Array([16384, -16384, 32767, -32768]);
    const uint8Data = new Uint8Array(pcmData.buffer);

    const result = await decodeAudioData(uint8Data, ctx, sampleRate, numChannels);

    assert.strictEqual(result.length, 4, 'Frame count should be 4');

    const channelData = result.getChannelData(0);
    assert.strictEqual(channelData[0], 16384 / 32768.0);
    assert.strictEqual(channelData[1], -16384 / 32768.0);
    assert.strictEqual(channelData[2], 32767 / 32768.0);
    assert.strictEqual(channelData[3], -32768 / 32768.0);
  });

  await t.test('Edge case: empty data', async () => {
    const numChannels = 1;
    const uint8Data = new Uint8Array(0);

    const result = await decodeAudioData(uint8Data, ctx, sampleRate, numChannels);

    assert.strictEqual(result.length, 0, 'Frame count should be 0');
    const channelData = result.getChannelData(0);
    assert.strictEqual(channelData.length, 0);
  });

  await t.test('Edge case: multiple channels (stereo interleaved)', async () => {
    const numChannels = 2;
    // Interleaved data: [L1, R1, L2, R2]
    const pcmData = new Int16Array([8192, -8192, 16384, -16384]);
    const uint8Data = new Uint8Array(pcmData.buffer);

    const result = await decodeAudioData(uint8Data, ctx, sampleRate, numChannels);

    assert.strictEqual(result.length, 2, 'Frame count should be 2 for 4 samples across 2 channels');

    const leftChannel = result.getChannelData(0);
    const rightChannel = result.getChannelData(1);

    // Left channel should have L1, L2
    assert.strictEqual(leftChannel[0], 8192 / 32768.0);
    assert.strictEqual(leftChannel[1], 16384 / 32768.0);

    // Right channel should have R1, R2
    assert.strictEqual(rightChannel[0], -8192 / 32768.0);
    assert.strictEqual(rightChannel[1], -16384 / 32768.0);
  });
});
