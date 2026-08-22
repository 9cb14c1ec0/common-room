# Common Room

An internal office presence and conferencing application. Team members can signal availability, request a meeting, join a shared Agora channel, and receive transcripts, summaries, and proposed action items.

## Local development

Requirements: Node.js 22 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

The web application runs at `http://localhost:5173` and proxies API requests to `http://localhost:4000`.

On Render, set `VITE_API_URL` on the static site to the public API service URL and set `WEB_ORIGIN` on the API to the static site's URL.

## Workspace layout

- `apps/web` — React web client, later shared by the Electron shell
- `apps/api` — Fastify HTTP/WebSocket API and integration webhooks
- `apps/worker` — durable recording/transcription/summary job consumer
- `packages/contracts` — shared client/server types
- `db/schema.sql` — initial PostgreSQL model
- `render.yaml` — Render Blueprint

## Current slice

The office dashboard, directory, meeting requests, health endpoint, presence socket, database design, and Render topology are present. The API uses deterministic demo data until authentication and persistence are connected.

## Integration order

1. Invite-only authentication and PostgreSQL repositories
2. Redis-backed presence and meeting-request delivery
3. Agora channel lifecycle webhooks and automatic recording
4. Recording completion jobs and ElevenLabs transcription
5. Structured meeting summaries and action-item confirmation
6. Electron packaging, notification handling, and signed Windows releases

## Agora

Create an Agora project secured with an App Certificate. Set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` only on the API service. The browser receives a one-hour channel token; the App Certificate is never sent to it. Calls join with microphone audio only and publish video only after the user enables their camera.

For automatic recording, enable Agora Cloud Recording and set `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET`, `AGORA_RECORDING_STORAGE_VENDOR`, and `AGORA_RECORDING_STORAGE_REGION` on the API service, together with the `OBJECT_STORAGE_*` bucket credentials. When these are absent, calls continue normally without recording.

The worker reads completed recordings directly from private S3-compatible storage and submits them to ElevenLabs Scribe v2. Set `ELEVENLABS_API_KEY`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ENDPOINT` (when not using AWS), `OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY` on the worker service.
