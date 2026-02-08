FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json bun.lock ./
COPY packages/db/package.json packages/db/
COPY packages/protocol/package.json packages/protocol/
COPY packages/trpc/package.json packages/trpc/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/server/ apps/server/

# Build Elysia server
RUN cd apps/server && bun run build

# Production image
FROM oven/bun:1-slim AS production
WORKDIR /app

# Copy built server and dependencies
COPY --from=base /app /app

# Expose the server port (Elysia)
EXPOSE 3001

# Run only the Elysia server (frontend is deployed separately to SWA)
CMD ["bun", "run", "--filter", "@screenshare-guide/server", "start"]
