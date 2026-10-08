# ---- build the React client (npm workspaces: shared, server, client)
FROM node:22-alpine AS client
WORKDIR /app
COPY package.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --no-audit --no-fund
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
RUN npm run build

# ---- API server (also serves the built client)
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
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
