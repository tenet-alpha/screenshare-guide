# ScreenShare Guide

AI-powered screen sharing verification platform. Guide users through multi-step proof workflows with real-time vision analysis and voice instructions.

## What It Does

1. **Create a proof session** via API (e.g. "verify your Instagram audience")
2. **Share the link** with the user
3. **User shares their screen** — AI watches, speaks instructions, extracts data
4. **Data is verified** through consensus voting and returned via webhook

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Next.js     │────▶│  Elysia     │────▶│  PostgreSQL   │
│  (SWA)       │ WS  │  (App Svc)  │     │  (Flexible)   │
└─────────────┘     │             │────▶│  Redis Cache   │
                    │             │────▶│  Azure Blob    │
                    │             │────▶│  Azure OpenAI  │
                    │             │────▶│  Azure Speech  │
                    │             │────▶│  Key Vault     │
                    │             │────▶│  App Insights  │
                    └─────────────┘     └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Elysia (WebSockets + HTTP) |
| API | tRPC (CRUD), raw WebSocket (real-time) |
| Database | PostgreSQL + Kysely + Graphile Migrate |
| Session State | Redis (prod) / in-memory Map (dev) |
| Frontend | Next.js 14 (static export → Azure SWA) |
| Storage | Azure Blob Storage |
| Vision AI | Azure OpenAI (GPT) or Anthropic (Claude) |
| TTS | Azure Speech or ElevenLabs |
| Telemetry | Azure Application Insights |
| Infrastructure | Terraform (Azure) |
| CI/CD | GitHub Actions |

## Project Structure

```
screenshare-guide/
├── apps/
│   ├── server/              # Elysia backend
│   │   └── src/
│   │       ├── ai/              # AI provider factory + implementations
│   │       │   └── providers/   # Azure OpenAI, Anthropic, ElevenLabs
│   │       ├── lib/             # Logger, telemetry, Redis, webhook, cleanup
│   │       ├── middleware/      # Security headers, rate limiting
│   │       ├── websocket.ts     # Real-time guidance state machine
│   │       └── index.ts         # Server entry + graceful shutdown
│   └── web/                 # Next.js frontend (static export)
│       └── src/
│           ├── app/             # App Router pages
│           └── components/      # ScreenShare session UI + hooks
├── packages/
│   ├── db/                  # Kysely schema + client
│   ├── protocol/            # Shared types, steps, constants
│   └── trpc/                # tRPC router + context
├── infra/                   # Terraform (Azure)
│   ├── main.tf              # All resources
│   ├── variables.tf         # All config points
│   ├── outputs.tf           # Outputs
│   ├── backend.tf           # Remote state config (uncomment after bootstrap)
│   ├── bootstrap/           # One-time state backend setup
│   └── terraform.tfvars.example
├── migrations/              # Graphile Migrate SQL
├── Dockerfile               # Production container
└── .github/workflows/       # CI + deploy pipelines
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Docker](https://www.docker.com/) (for local PostgreSQL)
- API keys for your AI provider (Azure OpenAI or Anthropic)

### Quick Start

```bash
# Clone and install
git clone <repo-url>
cd screenshare-guide
bun install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Start PostgreSQL
docker-compose up -d

# Run migrations
bun run db:migrate

# Start dev servers (backend :3001 + frontend :3000)
bun run dev
```

### AI Provider Configuration

**Vision** (`VISION_PROVIDER`): `azure` (default) or `anthropic`
**TTS** (`TTS_PROVIDER`): `azure` (default) or `elevenlabs`

See `.env.example` for all required env vars per provider.

## API

### Authentication

Protected routes require `Authorization: Bearer <API_KEY>` header.
When `API_KEY` env var is not set, auth is disabled (dev mode).

### tRPC Routes

| Route | Auth | Description |
|-------|------|-------------|
| `session.createProof` | 🔒 | Create proof session for a platform |
| `session.getByToken` | Public | Get session by share token |
| `session.start` | Public | Mark session as active |
| `session.get` | 🔒 | Get session by ID |
| `session.list` | 🔒 | List all sessions |
| `session.create` | 🔒 | Create session from template ID |
| `session.update` | 🔒 | Update session progress |
| `session.complete` | 🔒 | Mark session as complete |
| `session.getUploadUrl` | 🔒 | Get SAS URL for recording upload |

### WebSocket (`/ws/:token`)

**Client → Server:**
| Message | Description |
|---------|-------------|
| `frame` | Screen capture frame (JPEG base64) |
| `linkClicked` | User clicked a step link |
| `requestHint` | Request a hint |
| `skipStep` | Skip current step |
| `ping` | Heartbeat |

**Server → Client:**
| Message | Description |
|---------|-------------|
| `connected` | Session initialized with current state |
| `analyzing` | Frame analysis in progress |
| `analysis` | Analysis result + extracted data |
| `stepComplete` | Step advanced |
| `completed` | All steps done + final extracted data |
| `audio` | Voice instruction (base64 MP3) |
| `instruction` | Text-only instruction (TTS fallback) |
| `error` | Error message |

### Webhook (Optional)

When `WEBHOOK_URL` is set, a POST is sent on session completion:

```json
{
  "event": "session.completed",
  "sessionId": "uuid",
  "platform": "instagram",
  "extractedData": [{"label": "Handle", "value": "@username"}],
  "completedAt": "2024-01-01T00:00:00.000Z"
}
```

Optionally signed with HMAC-SHA256 via `WEBHOOK_SECRET` (header: `X-Webhook-Signature`).

## Adding a New Platform

1. Define a `ProofTemplate` in `packages/protocol/src/steps.ts`
2. Register it in the `PROOF_TEMPLATES` record
3. That's it — `createProof({ platform: "your-platform" })` works

Each step supports:
- `instruction` + `successCriteria` (for AI analysis)
- `link` (navigation URL + label)
- `extractionSchema` (typed data extraction with field names)
- `requiresLinkClick` (gate analysis until user clicks)
- `hints` (user-requested help)

## Infrastructure

All infrastructure is managed by Terraform in `infra/`.

### Resources

| Resource | Purpose | Configurable |
|----------|---------|-------------|
| Resource Group | Container for all resources | — |
| App Service (B1) | Backend container host | — |
| Container Registry | Docker image storage | — |
| PostgreSQL Flexible | Database | `database_mode`: create / existing |
| Storage Account | Blob storage for recordings | — |
| Redis Cache | WebSocket session persistence | `redis_mode`: create / existing / none |
| Application Insights | Telemetry + metrics | `appinsights_mode`: create / existing |
| Key Vault | Secret management | — |
| Static Web App | Frontend hosting (CDN) | — |
| Speech Services | Azure TTS | — |

### Secrets Management

- API keys (OpenAI, Anthropic, Speech) → **Azure Key Vault** (referenced by App Service)
- PostgreSQL password → **auto-generated** by Terraform, stored in Key Vault
- All other config → Terraform variables

### Deploying

```bash
# First time: bootstrap remote state
cd infra/bootstrap && ./init.sh

# Then uncomment backend block in infra/backend.tf and:
cd infra
terraform init -migrate-state
terraform plan
terraform apply
```

Per-environment config via tfvars:
```bash
terraform plan -var-file=prod.tfvars
```

### CI/CD

- **Push to main** → CI (typecheck + tests) → Deploy backend (Docker → ACR → webhook → App Service) → Deploy frontend (build → SWA)

## Environment Variables

See `.env.example` for the complete list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `VISION_PROVIDER` | No | `azure` (default) or `anthropic` |
| `TTS_PROVIDER` | No | `azure` (default) or `elevenlabs` |
| `REDIS_URL` | No | Redis connection URL (omit for in-memory) |
| `API_KEY` | No | API auth key (omit for dev mode) |
| `WEBHOOK_URL` | No | POST on session completion |
| `WEBHOOK_SECRET` | No | HMAC-SHA256 signing secret |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | Telemetry (omit to disable) |

## Development

```bash
bun run dev          # Start all services
bun run typecheck    # Type check all packages
bun run test         # Run all tests
bun run db:migrate   # Apply migrations
bun run db:watch     # Watch current.sql for changes
bun run db:reset     # Reset database (destructive!)
```

## License

MIT
