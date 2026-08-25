# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Hearth — self-hosted image
#
# Two stages. The builder compiles the SPA and bundles the server into a single
# ESM file with esbuild; the runtime stage carries only that bundle, the built
# interface and the schema. Because the bundle inlines every dependency, the
# final image has no node_modules at all — nothing to audit, nothing to install
# at boot, and no native module to compile for arm64.
#
# SQLite comes from `node:sqlite`, which is built into Node. That is the reason
# this image needs no build toolchain and works identically on Apple silicon and
# on x86.
# ---------------------------------------------------------------------------

FROM node:24-alpine AS builder

WORKDIR /build

# Dependencies first, so a source-only change reuses the cached layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The interface, then the server bundle.
RUN npm run build && npm run build:server


# ---------------------------------------------------------------------------

FROM node:24-alpine AS runtime

# Tini reaps zombies and forwards signals, so `docker stop` is instant and
# clean rather than waiting out a 10-second SIGKILL timeout.
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=builder /build/dist            ./dist
COPY --from=builder /build/dist-server     ./dist-server
COPY --from=builder /build/schema.sql      ./schema.sql

# The database and the credential-vault key live here. Mount it to keep them.
RUN mkdir -p /data && chown -R node:node /data /app

ENV NODE_ENV=production \
    PORT=8788 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    ASSETS_DIR=/app/dist

EXPOSE 8788
VOLUME ["/data"]

# Never run as root: this process is reachable from every device on the network.
USER node

# Plain HTTP by design — see the note printed at start-up. An HTTPS page cannot
# talk to a LAN server, so serving locally over HTTP is what makes Direct mode
# work at all.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist-server/hearth.mjs"]
