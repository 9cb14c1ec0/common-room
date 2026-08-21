# Common Room

An internal office presence and conferencing application. Team members can signal availability, request a meeting, join a shared SignalWire room, and receive transcripts, summaries, and proposed action items.

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
3. SignalWire room lifecycle webhooks and automatic recording
4. Recording completion jobs and ElevenLabs transcription
5. Structured meeting summaries and action-item confirmation
6. Electron packaging, notification handling, and signed Windows releases

## SignalWire

Set `SIGNALWIRE_SPACE_URL`, `SIGNALWIRE_PROJECT_ID`, and `SIGNALWIRE_API_TOKEN` only on the API service. The API token must have the Video scope. The browser receives a short-lived room token and never receives project credentials.
