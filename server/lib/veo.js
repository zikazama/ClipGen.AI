import { GoogleAuth } from 'google-auth-library';
import { PROJECT_ID, LOCATION, BUCKET } from './config.js';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const HOST = `https://${LOCATION}-aiplatform.googleapis.com/v1`;

function modelPath(model) {
  return `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}`;
}

async function call(url, data) {
  const client = await auth.getClient();
  const res = await client.request({ url, method: 'POST', data });
  return res.data;
}

/** Starts a Veo job. Output is written to gs://BUCKET/<outputPrefix>. Returns the operation name. */
export async function startVideo({ model, prompt, image, lastFrame, video, aspectRatio, resolution, durationSeconds, outputPrefix }) {
  const instance = { prompt };
  if (image) instance.image = { bytesBase64Encoded: image.imageBytes, mimeType: image.mimeType };
  if (lastFrame) instance.lastFrame = { bytesBase64Encoded: lastFrame.imageBytes, mimeType: lastFrame.mimeType };
  if (video) instance.video = { gcsUri: video, mimeType: 'video/mp4' };

  const parameters = {
    storageUri: `gs://${BUCKET}/${outputPrefix}`,
    sampleCount: 1,
    resolution,
    generateAudio: true,
  };
  // Extensions inherit aspect ratio and add a fixed number of seconds.
  if (!video) {
    parameters.aspectRatio = aspectRatio;
    parameters.durationSeconds = durationSeconds;
  }
  const data = await call(`${HOST}/${modelPath(model)}:predictLongRunning`, { instances: [instance], parameters });
  return data.name;
}

/** Returns { done, error?, uri? } for an operation started with startVideo. */
export async function getOperation(operationName) {
  const model = operationName.match(/\/models\/([^/]+)\/operations\//)?.[1];
  if (!model) throw new Error('Bad operation name.');
  const data = await call(`${HOST}/${modelPath(model)}:fetchPredictOperation`, { operationName });
  if (!data.done) return { done: false };
  if (data.error) {
    console.error('veo operation error:', JSON.stringify(data.error));
    return { done: true, error: 'Generation failed.' };
  }
  const uri = data.response?.videos?.[0]?.gcsUri;
  if (!uri) {
    const filtered = data.response?.raiMediaFilteredCount > 0;
    return {
      done: true,
      error: filtered
        ? 'The video was blocked by safety filters. Try rephrasing your prompt or using a different image.'
        : 'No video was returned.',
    };
  }
  return { done: true, uri };
}
