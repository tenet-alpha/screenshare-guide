# ScreenShare Guide

AI-powered screen sharing guidance platform. Generate unique session links, guide users through tasks with real-time AI vision analysis and voice instructions.

## Features

- **Template System**: Create reusable instruction templates with multiple steps
- **Session Management**: Generate unique, expiring session links
- **Real-time Screen Analysis**: AI-powered vision analysis using Claude
- **Voice Guidance**: Text-to-speech instructions via ElevenLabs
- **Recording Storage**: Automatic recording storage in Cloudflare R2
- **Progress Tracking**: Step-by-step progress with automatic advancement

## Tech Stack

- **Runtime**: Bun
- **Backend**: Elysia (Bun-native web framework)
- **API**: tRPC for CRUD, raw WebSockets for real-time
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: Next.js 14 (App Router)
- **Storage**: Cloudflare R2 (S3-compatible)
- **AI**: Anthropic Claude for vision, ElevenLabs for TTS

## Project Structure

```
screenshare-guide/
├── apps/
│   ├── server/          # Elysia backend
│   │   └── src/
│   │       ├── services/    # AI services (vision, TTS)
│   │       ├── routes/      # Storage/upload routes
│   │       └── websocket.ts # Real-time guidance loop
│   └── web/             # Next.js frontend
│       └── src/
│           ├── app/         # App router pages
│           ├── components/  # React components
│           └── lib/         # Utilities, tRPC client
├── packages/
│   ├── db/              # Drizzle schema + migrations
│   └── trpc/            # Shared tRPC router
├── docker-compose.yml   # Local PostgreSQL
└── .env.example         # Environment template
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://www.docker.com/) (for PostgreSQL)
- API keys for Anthropic, ElevenLabs, and Cloudflare R2

### 1. Clone and Install

```bash
git clone https://github.com/your-username/screenshare-guide.git
cd screenshare-guide
bun install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
# Required
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/screenshare"
ANTHROPIC_API_KEY="sk-ant-..."
ELEVENLABS_API_KEY="..."

# Optional (for recording storage)
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME="screenshare-recordings"
```

### 3. Start PostgreSQL

```bash
docker-compose up -d
```

### 4. Run Database Migrations

```bash
bun run db:push
```

### 5. Start Development Servers

In separate terminals:

```bash
# Backend (port 3001)
bun run dev:server

# Frontend (port 3000)
bun run dev:web
```

Or run both:

```bash
bun run dev
```

### 6. Open the App

Visit [http://localhost:3000](http://localhost:3000)

## Usage

### Creating a Template

1. Go to the home page
2. Fill in template name and description
3. Add steps with instructions and success criteria
4. Click "Create Template"

### Starting a Session

1. Click "Create Link" on any template
2. Share the generated link with your user
3. User opens link and shares their screen
4. AI guides them through each step with voice instructions

## API Endpoints

### tRPC Routes

- `template.create` - Create a new template
- `template.list` - List all templates
- `template.get` - Get template by ID
- `template.update` - Update a template
- `template.delete` - Delete a template
- `session.create` - Create a session from template
- `session.getByToken` - Get session by share token
- `session.start` - Mark session as active
- `session.complete` - Mark session as complete
- `recording.create` - Register a recording chunk
- `recording.createFrameSample` - Register a frame sample

### WebSocket (`/ws/:token`)

Messages from client:
- `{ type: "frame", imageData: string }` - Send screen frame for analysis
- `{ type: "requestHint" }` - Request a hint for current step
- `{ type: "skipStep" }` - Skip to next step
- `{ type: "ping" }` - Heartbeat

Messages from server:
- `{ type: "connected", sessionId, currentStep, totalSteps, instruction }`
- `{ type: "analyzing" }` - Frame analysis started
- `{ type: "analysis", description, matchesSuccess, confidence }`
- `{ type: "stepComplete", currentStep, totalSteps, nextInstruction }`
- `{ type: "audio", text, audioData }` - Voice instruction (base64 MP3)
- `{ type: "completed" }` - All steps done
- `{ type: "error", message }`

### Storage Routes

- `POST /storage/upload-url` - Get presigned URL for video upload
- `POST /storage/frame-upload-url` - Get presigned URL for frame upload
- `GET /storage/download-url/:key` - Get presigned URL for download

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for vision |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (default: Rachel) |
| `R2_ACCOUNT_ID` | No* | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | No* | R2 access key |
| `R2_SECRET_ACCESS_KEY` | No* | R2 secret key |
| `R2_BUCKET_NAME` | No | R2 bucket name |
| `PORT` | No | Server port (default: 3001) |
| `CORS_ORIGIN` | No | Frontend origin (default: http://localhost:3000) |

\* Required for recording storage

## Development

### Database Commands

```bash
# Generate migrations from schema changes
bun run db:generate

# Apply migrations
bun run db:migrate

# Push schema directly (dev only)
bun run db:push

# Open Drizzle Studio
bun run db:studio
```

### Type Checking

```bash
bun run typecheck
```

### Testing

```bash
bun run test
```

## Deployment

### Production Considerations

1. **Database**: Use a managed PostgreSQL service (Neon, Supabase, etc.)
2. **Session State**: Replace in-memory Map with Redis for multi-instance
3. **WebSocket**: Use a WebSocket-capable host (Railway, Fly.io, etc.)
4. **Frontend**: Deploy Next.js to Vercel or similar
5. **HTTPS**: Required for `getDisplayMedia()` in production

### Example Railway Deployment

```bash
# Install Railway CLI
bun add -g @railway/cli

# Login and init
railway login
railway init

# Add PostgreSQL
railway add --database postgres

# Deploy
railway up
```

## License

MIT
