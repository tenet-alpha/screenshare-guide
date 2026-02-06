#!/bin/sh
# Start both Next.js frontend and Elysia backend
# Next.js on port 3000, Elysia on PORT_BACKEND (default 3001)
# Reverse proxy on PORT (Azure's exposed port, default 8080)

export PORT_BACKEND=${PORT_BACKEND:-3001}
export NEXT_PORT=3000

echo "Starting Elysia backend on port $PORT_BACKEND..."
PORT=$PORT_BACKEND bun run --filter @screenshare-guide/server start &

echo "Starting Next.js frontend on port $NEXT_PORT..."
cd apps/web && PORT=$NEXT_PORT bun run start &

echo "Starting reverse proxy on port ${PORT:-8080}..."
cd /app && bun run scripts/proxy.ts &

wait
