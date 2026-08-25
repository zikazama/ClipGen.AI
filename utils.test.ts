import { test, mock } from 'node:test';
import assert from 'node:assert';
import { decode, decodeAudioData } from './utils.ts';

test('decode should convert base64 string to Uint8Array', () => {
  // Mock atob
  const originalAtob = globalThis.atob;
  globalThis.atob = (base64: string) => Buffer.from(base64, 'base64').toString('binary');

  try {
    const input = 'SGVsbG8gV29ybGQ='; // "Hello World" in base64
    const expected = new Uint8Array(Buffer.from('Hello World', 'utf-8'));

    const result = decode(input);

    assert.deepStrictEqual(result, expected);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('decodeAudioData should create AudioBuffer and copy normalized data', async () => {
  // Create a mock AudioBuffer
  class MockAudioBuffer {
    public length: number;
    public duration: number;
    public sampleRate: number;
    public numberOfChannels: number;
    private channelData: Float32Array[];

    constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
      this.numberOfChannels = options.numberOfChannels;
      this.length = options.length;
      this.sampleRate = options.sampleRate;
      this.duration = options.length / options.sampleRate;
      this.channelData = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    getChannelData(channel: number) {
      if (channel >= this.numberOfChannels) {
        throw new Error('Channel index out of bounds');
      }
      return this.channelData[channel];
    }

    copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset?: number) {}
    copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number) {}
  }

  // Create a mock AudioContext
  const mockAudioContext = {
    createBuffer: (numberOfChannels: number, length: number, sampleRate: number) => {
      return new MockAudioBuffer({ numberOfChannels, length, sampleRate });
    }
  } as unknown as AudioContext;

  const sampleRate = 24000;
  const numChannels = 1;
  const frameCount = 10;

  // Create test data: 10 frames of Int16 data for 1 channel
  // We'll put values like 0, 16384 (0.5), 32767 (~1.0), -16384 (-0.5), -32768 (-1.0)
  const testDataInt16 = new Int16Array(frameCount);
  testDataInt16[0] = 0;
  testDataInt16[1] = 16384;
  testDataInt16[2] = 32767;
  testDataInt16[3] = -16384;
  testDataInt16[4] = -32768;
  for (let i = 5; i < frameCount; i++) {
    testDataInt16[i] = i * 1000;
  }

  // Int16Array is a view over an ArrayBuffer. We need to pass a Uint8Array view of the same buffer.
  const testData = new Uint8Array(testDataInt16.buffer);

  const buffer = await decodeAudioData(testData, mockAudioContext, sampleRate, numChannels);

  // Validate buffer properties
  assert.strictEqual(buffer.numberOfChannels, numChannels);
  assert.strictEqual(buffer.length, frameCount);
  assert.strictEqual(buffer.sampleRate, sampleRate);

  // Validate channel data normalization
  const channelData = buffer.getChannelData(0);
  assert.strictEqual(channelData[0], 0);
  assert.strictEqual(channelData[1], 16384 / 32768.0);
  assert.strictEqual(channelData[2], 32767 / 32768.0);
  assert.strictEqual(channelData[3], -16384 / 32768.0);
  assert.strictEqual(channelData[4], -32768 / 32768.0); // -1.0

  for (let i = 5; i < frameCount; i++) {
    assert.strictEqual(channelData[i], (i * 1000) / 32768.0);
  }
});
