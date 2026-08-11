// server.js
import express from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { convertImage } from './lib/convertImage.js';
import { convertVideoToWebm } from './lib/convertVideo.js';
import { createJob, getJob, updateJob } from './lib/jobs.js';

const app = express();
const PORT = process.env.PORT || 8080;
const WORK_DIR = process.env.WORK_DIR || path.join(tmpdir(), 'asset-converter');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '200', 10);
const VIDEO_CONCURRENCY = parseInt(process.env.VIDEO_CONCURRENCY || '2', 10);

await mkdir(WORK_DIR, { recursive: true });

// ---- simple concurrency limiter for video jobs, so the box doesn't get
// ---- swamped if several conversions are requested at once ----
let activeVideoJobs = 0;
const videoQueue = [];
function runVideoJob(fn) {
  return new Promise((resolve, reject) => {
    const task = async () => {
      activeVideoJobs++;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        activeVideoJobs--;
        if (videoQueue.length) videoQueue.shift()();
      }
    };
    if (activeVideoJobs < VIDEO_CONCURRENCY) task();
    else videoQueue.push(task);
  });
}

// ---- image uploads: kept in memory, images are small and conversion is fast ----
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// ---- video uploads: written to disk, videos can be large and ffmpeg reads from a path ----
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: WORK_DIR,
    filename: (_req, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /convert/image?format=webp&quality=80
 * multipart field: "file"
 * Returns the converted image bytes directly. Synchronous — sharp is fast
 * enough that scripts can just POST and read the response body.
 */
app.post('/convert/image', imageUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing multipart field "file"' });
  const format = (req.query.format || 'webp').toString();
  const quality = parseInt(req.query.quality?.toString() || '80', 10);
  try {
    const { buffer, contentType } = await convertImage(req.file.buffer, format, quality);
    res.set('Content-Type', contentType);
    res.set('Content-Length', buffer.length.toString());
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /convert/video?crf=32&sync=false
 * multipart field: "file"
 * Kicks off an async ffmpeg job and returns immediately with a job id.
 * Pass ?sync=true to have this endpoint hold the request open and return
 * the converted file directly once done (convenient for scripts, but ties
 * up a connection for the duration of the encode).
 */
app.post('/convert/video', videoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing multipart field "file"' });
  const crf = req.query.crf?.toString() || '32';
  const sync = req.query.sync === 'true';
  const id = nanoid();
  const inputPath = req.file.path;
  const outputPath = path.join(WORK_DIR, `${id}.webm`);

  createJob(id);
  const jobPromise = runVideoJob(async () => {
    updateJob(id, { status: 'processing' });
    try {
      await convertVideoToWebm(inputPath, outputPath, { crf });
      updateJob(id, { status: 'done', outputPath, contentType: 'video/webm' });
    } catch (err) {
      updateJob(id, { status: 'error', error: err.message });
      throw err;
    } finally {
      await rm(inputPath, { force: true });
    }
  });

  if (sync) {
    try {
      await jobPromise;
      const buf = await stat(outputPath).then(() => outputPath);
      res.set('Content-Type', 'video/webm');
      res.sendFile(buf);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  jobPromise.catch(() => {}); // already recorded on the job; avoid unhandled rejection
  res.status(202).json({
    jobId: id,
    statusUrl: `/jobs/${id}`,
    resultUrl: `/jobs/${id}/result`,
  });
});

app.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found (may have expired)' });
  res.json({ id: job.id, status: job.status, error: job.error });
});

app.get('/jobs/:id/result', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found (may have expired)' });
  if (job.status !== 'done') return res.status(409).json({ error: `Job not ready (status: ${job.status})` });
  res.set('Content-Type', job.contentType);
  res.sendFile(job.outputPath);
});

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max ${MAX_UPLOAD_MB}MB.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`asset-converter-service listening on :${PORT}`);
  console.log(`work dir: ${WORK_DIR}`);
});