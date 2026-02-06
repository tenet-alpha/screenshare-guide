#!/bin/sh
set -e

# Azure sets PORT=8080. We run:
#   - Elysia backend on port 3001
#   - Next.js frontend on port 3000  
#   - Bun reverse proxy on port 8080 (Azure's PORT)

PROXY_PORT="${PORT:-8080}"
BACKEND_PORT=3001
FRONTEND_PORT=3000

echo "=== ScreenShare Guide Starting ==="
echo "Proxy: $PROXY_PORT | Backend: $BACKEND_PORT | Frontend: $FRONTEND_PORT"

# Start Elysia backend (override PORT so it doesn't use Azure's 8080)
echo "Starting Elysia backend on port $BACKEND_PORT..."
PORT=$BACKEND_PORT bun apps/server/dist/index.js &

# Start Next.js frontend
echo "Starting Next.js frontend on port $FRONTEND_PORT..."
cd /app/apps/web
PORT=$FRONTEND_PORT node .next/standalone/apps/web/server.js &

# Start reverse proxy on Azure's PORT
echo "Starting reverse proxy on port $PROXY_PORT..."
cd /app
PORT=$PROXY_PORT PORT_BACKEND=$BACKEND_PORT NEXT_PORT=$FRONTEND_PORT bun run scripts/proxy.ts &

wait
