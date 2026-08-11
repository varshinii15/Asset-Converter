// lib/jobs.js
// Minimal in-memory job store for async video conversions.
// Swap this for Redis/a DB if you run more than one instance of the service,
// since job state currently lives only in this process's memory.

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000; // auto-clean finished jobs after 30 min

export function createJob(id) {
  const job = {
    id,
    status: 'pending', // pending | processing | done | error
    error: null,
    outputPath: null,
    contentType: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  if (job.status === 'done' || job.status === 'error') {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
  return job;
}