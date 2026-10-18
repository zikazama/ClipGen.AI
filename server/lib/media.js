import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
  });
}

async function hasAudio(file) {
  try {
    await run('ffmpeg', ['-hide_banner', '-i', file]);
  } catch (err) {
    return /Audio:/.test(err.message);
  }
  return false;
}

/**
 * Builds the ffmpeg filter graph. Pure so it can be unit tested.
 * Inputs are numbered in order: 0 = video, then narration (if any), then logo (if any).
 */
export function buildFilterGraph({ narration, backgroundAudio, logo }) {
  const filters = [];
  let nextInput = 1;
  const narrationIdx = narration ? nextInput++ : null;
  const logoIdx = logo ? nextInput++ : null;

  const video = { map: '0:v:0' };
  if (logo) {
    // Logo at 22% of the frame width, 4% margin, top-right, slightly translucent.
    filters.push(
      `[${logoIdx}:v][0:v]scale2ref=w=main_w*0.22:h=ow/mdar[lg][base]`,
      '[lg]format=rgba,colorchannelmixer=aa=0.92[lga]',
      '[base][lga]overlay=x=main_w-overlay_w-main_w*0.04:y=main_h*0.04:format=auto,format=yuv420p[v]'
    );
    video.map = '[v]';
  }

  let audioMap = ['-map', '0:a?'];
  if (narration) {
    if (backgroundAudio) {
      filters.push(
        '[0:a]volume=0.3[bg]',
        `[${narrationIdx}:a]adelay=500|500,aresample=48000[vo]`,
        '[bg][vo]amix=inputs=2:duration=first:normalize=0[a]'
      );
    } else {
      filters.push(`[${narrationIdx}:a]adelay=500|500,aresample=48000[a]`);
    }
    audioMap = ['-map', '[a]'];
  }
  return { filters, videoMap: video.map, audioMap, narrationIdx, logoIdx };
}

/**
 * Trims the clip to `seconds`, re-encodes to a web-friendly H.264/AAC MP4, optionally mixes a narration
 * track (ducking the original sound) and optionally overlays a brand logo.
 */
export async function finalizeVideo({ videoBuffer, seconds, narrationPcm, logoPng }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipgen-'));
  const input = path.join(dir, 'in.mp4');
  const output = path.join(dir, 'out.mp4');
  try {
    await fs.writeFile(input, videoBuffer);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input];

    if (narrationPcm) {
      const pcm = path.join(dir, 'narration.pcm');
      await fs.writeFile(pcm, narrationPcm);
      args.push('-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm);
    }
    if (logoPng) {
      const logo = path.join(dir, 'logo.png');
      await fs.writeFile(logo, logoPng);
      args.push('-i', logo);
    }

    const graph = buildFilterGraph({
      narration: !!narrationPcm,
      backgroundAudio: narrationPcm ? await hasAudio(input) : false,
      logo: !!logoPng,
    });
    if (graph.filters.length) args.push('-filter_complex', graph.filters.join(';'));
    args.push(
      '-map', graph.videoMap, ...graph.audioMap,
      '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      output
    );
    await run('ffmpeg', args);
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
