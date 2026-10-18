declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Decodes a base64 string into raw bytes. */
export function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/** Converts 16-bit PCM bytes into an AudioBuffer (little-endian, interleaved). */
export function decodeAudioData(
  data: Uint8Array,
  ctx: BaseAudioContext,
  sampleRate: number,
  numChannels: number,
): AudioBuffer {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const frameCount = Math.floor(dataInt16.length / numChannels);
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

let sharedAudioContext: AudioContext | null = null;

/** Browsers limit the number of AudioContexts, so reuse a single one. */
export function getAudioContext(sampleRate = 24000): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not supported in this browser.');
    sharedAudioContext = new Ctor({ sampleRate });
  }
  return sharedAudioContext;
}

/** Extracts a user-facing message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'An unexpected error occurred.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
