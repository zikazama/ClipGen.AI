import { GoogleGenAI } from '@google/genai';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };
  }
}

// Audio Decoding Helpers for TTS
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const secureFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof window !== 'undefined' && window.aistudio?.fetch) {
    return window.aistudio.fetch(input, init);
  }

  let url = input.toString();

  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    url = url.replace('https://generativelanguage.googleapis.com', '/api');
  }

  // Strip any 'key' parameter to prevent leakage
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const urlObj = new URL(url, base);
    if (urlObj.searchParams.has('key')) {
      urlObj.searchParams.delete('key');
      url = urlObj.pathname + urlObj.search;
      // Re-add origin if it wasn't a relative path
      if (input.toString().startsWith('http')) {
        url = urlObj.toString();
      } else if (input.toString().startsWith('/api')) {
        url = urlObj.pathname + urlObj.search;
      }
    }
  } catch (e) {
    // Ignore invalid URL errors
  }

  return fetch(url, init);
};

export const getAIClient = () => {
  const hasAiStudio = typeof window !== 'undefined' && window.aistudio;
  return new GoogleGenAI({
    // Provide a dummy key to satisfy validation when aistudio isn't present
    apiKey: hasAiStudio ? undefined : 'proxy-key',
    httpOptions: {
      baseUrl: hasAiStudio ? undefined : '/api',
      customFetch: secureFetch
    } as any
  });
};
