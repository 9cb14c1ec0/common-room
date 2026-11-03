FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
# Left empty so the bundle calls /api on its own origin, which Caddy proxies to the API.
ENV VITE_API_URL=
RUN npm ci --include=dev -w @office/web -w @office/contracts && npm run build -w @office/web

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
