# Vite dev server, not a production build: this image exists so `docker compose
# up` gives you the app you actually develop against, with HMR and the /api and
# /socket.io proxies pointed at the terrain service container.
#
# Node runtime, Bun package manager -- Vite 8 uses Node APIs (util.parseEnv)
# that Bun 1.1 does not implement, so running `bun run dev` here fails outright.
FROM node:22-slim

WORKDIR /app

RUN npm install --global bun@1.1.45

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig*.json index.html eslint.config.js vite.config.ts ./
COPY public ./public
COPY src ./src

EXPOSE 5173

# --host binds 0.0.0.0 so the port is reachable from outside the container.
CMD ["node_modules/.bin/vite", "--host"]
