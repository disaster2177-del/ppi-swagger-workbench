# Base image. Override for an internal registry, e.g.
#   docker compose build --build-arg NODE_IMAGE=registry.local/node:22-alpine
ARG NODE_IMAGE=node:22-alpine

# ---- build the React client (npm workspaces: shared, server, client)
FROM ${NODE_IMAGE} AS client
WORKDIR /app
# Optional: an internal npm mirror (Nexus / Artifactory / Verdaccio)
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# npm ci (exact versions) when package-lock.json is committed, else npm install
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
# The client bundles the example YAML files ("Load example projects" in browser-only builds).
COPY samples/ samples/
RUN npm run build

# ---- API server (also serves the built client)
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
# Let fetch() honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY for the API request proxy (Node >= 22.21).
ENV NODE_USE_ENV_PROXY=1
WORKDIR /app
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --omit=dev --no-audit --no-fund --workspace server --workspace shared
COPY shared/ shared/
COPY server/ server/
COPY samples/ samples/
COPY --from=client /app/client/dist client/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
