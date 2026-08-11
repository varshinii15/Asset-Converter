// lib/convertVideo.js
import { spawn } from 'node:child_process';

/**
 * Converts a video file on disk to WebM (VP9 + Opus) at outPath.
 * Requires the `ffmpeg` binary on PATH.
 */
export function convertVideoToWebm(inputPath, outputPath, { crf = '32' } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0',
      '-c:a', 'libopus',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(Object.assign(new Error('ffmpeg not found on PATH inside this container/host.'), { status: 500 }));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`), { status: 500 }));
    });
  });
}