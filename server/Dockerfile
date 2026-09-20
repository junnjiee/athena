# Node runtime, Bun package manager -- the same split the project uses locally.
# The service runs on Node via tsx (Socket.IO's websocket upgrade is flaky on
# Bun 1.1.x; see the stack decisions in the root README), while Bun owns
# bun.lockb. `oven/bun` ships no node binary, and tsx is `#!/usr/bin/env node`.
FROM node:22-slim

WORKDIR /app

RUN npm install --global bun@1.1.45

# Dependencies first so a source edit does not reinstall the world.
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets

ENV HOST=0.0.0.0 \
    PORT=8787

EXPOSE 8787

# Migrations run before the service accepts traffic. drizzle-kit connects with
# its own postgres driver, so this works against a plain Postgres container as
# well as against Neon.
CMD ["sh", "-c", "node_modules/.bin/drizzle-kit migrate && exec node_modules/.bin/tsx src/index.ts"]
