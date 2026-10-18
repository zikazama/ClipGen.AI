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
 * Trims the clip to `seconds`, re-encodes to a web-friendly H.264/AAC MP4 and (optionally)
 * mixes a narration track over the clip's own sound, ducking the original.
 */
export async function finalizeVideo({ videoBuffer, seconds, narrationPcm }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipgen-'));
  const input = path.join(dir, 'in.mp4');
  const output = path.join(dir, 'out.mp4');
  try {
    await fs.writeFile(input, videoBuffer);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input];
    let audioMap = ['-map', '0:a?'];
    const filters = [];

    if (narrationPcm) {
      const pcm = path.join(dir, 'narration.pcm');
      await fs.writeFile(pcm, narrationPcm);
      args.push('-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm);
      if (await hasAudio(input)) {
        filters.push(
          '[0:a]volume=0.3[bg]',
          '[1:a]adelay=500|500,aresample=48000[vo]',
          '[bg][vo]amix=inputs=2:duration=first:normalize=0[a]'
        );
      } else {
        filters.push('[1:a]adelay=500|500,aresample=48000[a]');
      }
      audioMap = ['-map', '[a]'];
    }

    if (filters.length) args.push('-filter_complex', filters.join(';'));
    args.push(
      '-map', '0:v:0', ...audioMap,
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
