#!/bin/sh
set -e

# Azure sets PORT=8080. We need to split traffic:
#   - Elysia backend on port 3001
#   - Next.js frontend on port 3000  
#   - Bun reverse proxy on port 8080 (Azure's PORT)

# Capture Azure's PORT before we touch it
PROXY_PORT="${PORT:-8080}"

echo "=== ScreenShare Guide Starting ==="
echo "Proxy: $PROXY_PORT | Backend: 3001 | Frontend: 3000"

# Start Elysia backend
echo "Starting Elysia backend on port 3001..."
env PORT=3001 bun apps/server/dist/index.js &

# Start Next.js frontend standalone server  
echo "Starting Next.js frontend on port 3000..."
cd /app/apps/web
env PORT=3000 node .next/standalone/apps/web/server.js &

# Start reverse proxy on Azure's PORT
echo "Starting reverse proxy on port $PROXY_PORT..."
cd /app
env PORT="$PROXY_PORT" PORT_BACKEND=3001 NEXT_PORT=3000 bun run scripts/proxy.ts &

wait
