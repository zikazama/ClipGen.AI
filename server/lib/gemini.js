import { GoogleGenAI, Type } from '@google/genai';
import {
  PROJECT_ID, LOCATION, TTS_MODELS, TEXT_MODEL, LANGUAGES, SPEECH_STYLES, maxScriptWords,
} from './config.js';
import { HttpError } from './errors.js';

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

/** Gemini TTS -> raw 16-bit mono PCM @ 24 kHz as a Buffer. */
export async function synthesizeSpeech(text, voice = 'Kore', style = 'neutral') {
  const prefix = SPEECH_STYLES[style] ?? '';
  let lastError = null;
  for (const model of TTS_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `${prefix}${text}` }] }],
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
      { role: 'user', parts: [{ text: `Idea: ${prompt}${style ? `\nVisual style to honour: ${style}` : ''}` }] },
    ],
    config: { systemInstruction: ENHANCE_SYSTEM, temperature: 0.8, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  });
  const text = response.text?.trim();
  if (!text) throw new HttpError(502, 'Could not enhance the prompt right now.');
  return text.slice(0, 1500);
}

const DIRECTOR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Short internal title for the ad, max 6 words.' },
    veoPrompt: { type: Type.STRING, description: 'English cinematic prompt for the Veo model.' },
    voiceover: { type: Type.STRING, description: 'Voice-over script in the requested language.' },
    caption: { type: Type.STRING, description: 'Social post caption in the requested language.' },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '5 to 8 hashtags without the # sign.' },
  },
  required: ['title', 'veoPrompt', 'voiceover', 'caption', 'hashtags'],
};

function directorSystem({ language, languageNote, maxWords, seconds, aspectRatio, platformLabel }) {
  return [
    'You are the creative director of a small-business advertising studio in Southeast Asia.',
    'From a short brief (and a product photo if given) you write a complete ad package for a vertical-first social video.',
    '',
    'Rules for "veoPrompt" (English, 60-90 words, one paragraph):',
    '- Describe the product exactly as it looks in the photo (shape, colour, packaging); the photo is the first frame.',
    '- Add ONE clear camera move, lens/framing, lighting, setting and an appetising or aspirational motion (steam, pouring, hands, light sweep).',
    '- Mood and ambient sound/music that fit the brief. Keep it feasible for an AI video model.',
    '- No on-screen text, prices, logos, brand names or recognisable real people.',
    `- Compose for ${aspectRatio}. The finished ad is ${seconds} seconds.`,
    '',
    `Rules for "voiceover" (${language}):`,
    `- At most ${maxWords} words so it fits ${seconds} seconds of speech. Spoken, natural, no emojis, no stage directions.`,
    '- Structure: a 3-second hook, one concrete benefit, a short call to action.',
    `Rules for "caption" (${language}): max 220 characters, friendly, 1-2 emojis, ends with a call to action for ${platformLabel}.`,
    'Rules for "hashtags": 5-8 relevant, mix of niche and broad, no spaces, no # sign.',
    'Never invent prices, discounts, health claims or awards that the brief does not state.',
    languageNote ? `Language note: ${languageNote} Apply it to the voiceover, the caption and the hashtags.` : '',
  ].join('\n');
}

/**
 * Gemini as creative director: brief (+ product photo + brand kit) -> Veo prompt, voice-over script,
 * social caption and hashtags, as validated JSON.
 */
export async function directBrief({ brief, languageId, image, brand, length, aspectRatio, platformLabel }) {
  const language = LANGUAGES[languageId].gemini;
  const maxWords = maxScriptWords(length);
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.imageBytes } });
  const brandLines = brand
    ? [
        `Brand: ${brand.name}`,
        brand.tone ? `Brand tone: ${brand.tone}` : '',
        brand.audience ? `Target audience: ${brand.audience}` : '',
        brand.colors?.length ? `Brand colours: ${brand.colors.join(', ')}` : '',
      ].filter(Boolean)
    : [];
  parts.push({ text: [`Brief: ${brief}`, ...brandLines].join('\n') });

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: directorSystem({ language, languageNote: LANGUAGES[languageId].note, maxWords, seconds: length, aspectRatio, platformLabel }),
      responseMimeType: 'application/json',
      responseSchema: DIRECTOR_SCHEMA,
      temperature: 0.8,
      // Flash 'thinking' tokens count against the output budget and can truncate JSON; plans need no reasoning.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
    },
  });

  let data;
  try {
    data = JSON.parse(response.text || '');
  } catch {
    throw new HttpError(502, 'The creative director could not produce a plan. Please try again.');
  }
  const words = String(data.voiceover || '').trim().split(/\s+/).filter(Boolean);
  if (!data.veoPrompt || !words.length) {
    throw new HttpError(502, 'The creative director could not produce a plan. Please try again.');
  }
  return {
    title: String(data.title || '').slice(0, 80),
    veoPrompt: String(data.veoPrompt).slice(0, 1500),
    // Hard cap in case the model overshoots the word budget.
    voiceover: words.slice(0, maxWords + 4).join(' ').slice(0, 600),
    caption: String(data.caption || '').slice(0, 300),
    hashtags: (Array.isArray(data.hashtags) ? data.hashtags : [])
      .map((h) => String(h).replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30))
      .filter(Boolean)
      .slice(0, 8),
    maxWords,
  };
}
