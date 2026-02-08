FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json bun.lock ./
COPY packages/db/package.json packages/db/
COPY packages/protocol/package.json packages/protocol/
COPY packages/trpc/package.json packages/trpc/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build Next.js frontend
RUN cd apps/web && bun run build

# Build Elysia server
RUN cd apps/server && bun run build

# Production image
FROM oven/bun:1-slim AS production
WORKDIR /app

# Copy everything from builder
COPY --from=base /app /app

# Expose the server port (Elysia)
EXPOSE 3001

# Start script runs both services
CMD ["bun", "run", "start:prod"]
