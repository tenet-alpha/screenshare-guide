import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { trpcHandler } from "./trpc-adapter";
import { websocketHandler } from "./websocket";
import { storageRoutes } from "./routes/storage";

const PORT = process.env.PORT || 3001;

const app = new Elysia()
  // Enable CORS for frontend
  .use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }))
  
  // Health check
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  
  // tRPC handler for all CRUD operations
  .all("/trpc/*", trpcHandler)
  
  // Storage routes (presigned URLs)
  .use(storageRoutes)
  
  // WebSocket handler for real-time AI guidance
  .use(websocketHandler)
  
  .listen(PORT);

console.log(`🦊 Server running at http://localhost:${PORT}`);
console.log(`   - tRPC endpoint: http://localhost:${PORT}/trpc`);
console.log(`   - WebSocket endpoint: ws://localhost:${PORT}/ws`);

export type App = typeof app;
