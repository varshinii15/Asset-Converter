# Asset-Converter

An HTTP microservice you deploy once, then call from any script or backend to
convert images → WebP/AVIF and video → WebM. No build-step dependency, no
per-project npm install — it's a network call.

- `POST /convert/image` — synchronous, response body is the converted image
- `POST /convert/video` — async job (ffmpeg encodes take real time): submit,
  poll status, download result. `?sync=true` will hold the connection open
  and return the file directly, if you'd rather not poll.
- `GET /health` — for load balancer / orchestrator health checks

## Run it

**Docker (recommended — bundles ffmpeg for you):**

```bash
docker compose up --build
# or
docker build -t asset-converter-service .
docker run -p 8080:8080 asset-converter-service
```

**Bare metal / VM:**

```bash
npm install
# ffmpeg must be installed separately (not an npm package):
#   apt-get install ffmpeg   /   brew install ffmpeg
node server.js
```

Env vars: `PORT` (default 8080), `MAX_UPLOAD_MB` (default 200),
`VIDEO_CONCURRENCY` (default 2 — max ffmpeg processes running at once),
`WORK_DIR` (default OS tmp dir — where uploads/outputs are staged).

## Calling it from a script

**Image (synchronous — just POST and read the response body):**

```bash
curl -X POST "http://localhost:8080/convert/image?format=webp&quality=80" \
  -F "file=@./photo.png" -o ./photo.webp
```

**Video (async job — submit, poll, download):**

```bash
JOB=$(curl -s -X POST "http://localhost:8080/convert/video?crf=32" -F "file=@./clip.mp4")
JOB_ID=$(echo "$JOB" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
curl -s "http://localhost:8080/jobs/$JOB_ID"                 # -> {"status":"processing"} then "done"
curl -s -o ./clip.webm "http://localhost:8080/jobs/$JOB_ID/result"
```

Full runnable examples:
- `client-example.js` — Node, uses fetch/FormData, includes video polling logic
- `client-example.sh` — plain curl, works from any language's shell-out

Both were tested against a live instance of this service before being handed
to you — image PNG→WebP and video MP4→WebM both round-trip correctly.

## API reference

| Endpoint | Method | Notes |
|---|---|---|
| `/convert/image?format=webp\|avif\|png\|jpeg&quality=1-100` | POST, multipart `file` | Returns converted bytes directly |
| `/convert/video?crf=32&sync=false` | POST, multipart `file` | Returns `{jobId, statusUrl, resultUrl}`; lower CRF = better quality/bigger file |
| `/jobs/:id` | GET | `{status: pending\|processing\|done\|error}` |
| `/jobs/:id/result` | GET | Streams the converted WebM once `status: done` |
| `/health` | GET | `{ok: true}` |

## Deploying this for real

- **Single instance is fine for most workloads.** Job state is in-memory —
  if you need multiple replicas behind a load balancer, swap `lib/jobs.js`
  for Redis (or any shared store) so a poll can land on a different instance
  than the one doing the encode.
- **Autoscaling on CPU** works well since both sharp and ffmpeg are CPU-bound;
  set `VIDEO_CONCURRENCY` based on core count (roughly `cores / 2` is a safe
  starting point since VP9 encoding is heavy per-process).
- Deploys as-is to any container platform: Fly.io, Cloud Run, ECS/Fargate,
  Render, a plain VPS with the Docker image. No extra infra required beyond
  the container itself.
- Uploaded/converted files are written to `WORK_DIR` and cleaned up after
  each job's TTL (30 min) — fine for ephemeral/stateless containers; mount a
  volume only if you want to inspect files after the fact.