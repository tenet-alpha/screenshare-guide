/**
 * Simple reverse proxy that routes requests between Next.js frontend and Elysia backend.
 * 
 * Routes:
 *   /trpc/*  → Elysia backend (PORT_BACKEND)
 *   /health  → Elysia backend
 *   /ws/*    → Elysia backend (WebSocket)
 *   /storage/* → Elysia backend
 *   /*       → Next.js frontend (NEXT_PORT)
 */

const PORT = parseInt(process.env.PORT || "8080");
const BACKEND_PORT = parseInt(process.env.PORT_BACKEND || "3001");
const FRONTEND_PORT = parseInt(process.env.NEXT_PORT || "3000");

const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

// Wait for both services to be ready
async function waitForService(url: string, name: string, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      console.log(`${name} is ready at ${url}`);
      return;
    } catch {
      if (i % 5 === 0) console.log(`Waiting for ${name} at ${url}... (${i}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error(`WARNING: ${name} at ${url} did not become ready in time`);
}

// Determine which upstream to use based on path
function getUpstream(pathname: string): string {
  if (
    pathname.startsWith("/trpc") ||
    pathname.startsWith("/health") ||
    pathname.startsWith("/ws") ||
    pathname.startsWith("/storage")
  ) {
    return BACKEND_URL;
  }
  return FRONTEND_URL;
}

async function proxyRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const upstream = getUpstream(url.pathname);
  const target = `${upstream}${url.pathname}${url.search}`;

  try {
    const headers = new Headers(req.headers);
    headers.set("host", `127.0.0.1:${upstream === BACKEND_URL ? BACKEND_PORT : FRONTEND_PORT}`);

    const response = await fetch(target, {
      method: req.method,
      headers,
      body: req.body,
      // @ts-ignore - duplex is needed for streaming bodies
      duplex: "half",
      signal: AbortSignal.timeout(30000),
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err: any) {
    console.error(`Proxy error for ${url.pathname}: ${err.message}`);
    return new Response(JSON.stringify({ error: "Bad Gateway", message: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Wait for services then start proxy
await Promise.all([
  waitForService(`${BACKEND_URL}/health`, "Backend"),
  waitForService(FRONTEND_URL, "Frontend"),
]);

const server = Bun.serve({
  port: PORT,
  fetch: proxyRequest,
});

console.log(`Reverse proxy listening on port ${PORT}`);
console.log(`  Backend: ${BACKEND_URL}`);
console.log(`  Frontend: ${FRONTEND_URL}`);
