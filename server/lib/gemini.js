import { GoogleGenAI } from '@google/genai';
import { PROJECT_ID, LOCATION, TTS_MODELS, TEXT_MODEL } from './config.js';
import { HttpError } from './errors.js';

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

/** Gemini TTS -> raw 16-bit mono PCM @ 24 kHz as a Buffer. */
export async function synthesizeSpeech(text, voice = 'Kore') {
  let lastError = null;
  for (const model of TTS_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audio) return Buffer.from(audio, 'base64');
      lastError = new Error('TTS produced no audio.');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('TTS failed.');
}

const ENHANCE_SYSTEM =
  'You are a cinematographer writing prompts for the Veo video model. Rewrite the user\'s idea as ONE vivid, ' +
  'concrete English paragraph (max 90 words): subject, action, setting, camera movement, lens/framing, lighting, ' +
  'mood and ambient sound. Keep the user\'s intent. Do not add text overlays, logos or real people. ' +
  'Output only the prompt, with no preface or quotes.';

/** Gemini rewrites a rough idea into a production-grade Veo prompt. */
export async function enhancePrompt(prompt, style) {
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: `Idea: ${prompt}${style ? `\nVisual style to honour: ${style}` : ''}` }],
      },
    ],
    config: { systemInstruction: ENHANCE_SYSTEM, temperature: 0.8, maxOutputTokens: 400 },
  });
  const text = response.text?.trim();
  if (!text) throw new HttpError(502, 'Could not enhance the prompt right now.');
  return text.slice(0, 1500);
}
