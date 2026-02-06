# ScreenShare Guide

AI-powered screen sharing guidance platform. Generate unique session links, guide users through tasks with real-time AI vision analysis and voice instructions.

## Features

- **Template System**: Create reusable instruction templates with multiple steps
- **Session Management**: Generate unique, expiring session links
- **Real-time Screen Analysis**: AI-powered vision analysis using Claude or Azure OpenAI
- **Voice Guidance**: Text-to-speech instructions via ElevenLabs or Azure Speech
- **Recording Storage**: Automatic recording storage in Azure Blob Storage
- **Progress Tracking**: Step-by-step progress with automatic advancement
- **Multi-Provider Support**: Switch between Anthropic/ElevenLabs and Azure OpenAI

## Tech Stack

- **Runtime**: Bun
- **Backend**: Elysia (Bun-native web framework)
- **API**: tRPC for CRUD, raw WebSockets for real-time
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: Next.js 14 (App Router)
- **Storage**: Azure Blob Storage
- **AI**: Anthropic Claude or Azure OpenAI for vision; ElevenLabs or Azure Speech for TTS

## Project Structure

```
screenshare-guide/
├── apps/
│   ├── server/          # Elysia backend
│   │   └── src/
│   │       ├── ai/          # AI provider abstraction
│   │       │   ├── providers/   # Anthropic, Azure implementations
│   │       │   ├── types.ts     # Provider interfaces
│   │       │   └── index.ts     # Provider factory
│   │       ├── routes/      # Storage routes
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
- Azure Storage Account (for recording storage)
- API keys for your chosen AI provider

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

### 3. Configure AI Provider

Choose your AI provider by setting `AI_PROVIDER`:

#### Option A: Anthropic + ElevenLabs (Default)

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

#### Option B: Azure OpenAI + Azure Speech

```env
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT_VISION=gpt-4o
AZURE_SPEECH_ENDPOINT=https://eastus.tts.speech.microsoft.com
AZURE_SPEECH_API_KEY=...
AZURE_SPEECH_VOICE_NAME=en-US-JennyNeural
```

> **Note**: If Azure Speech is not configured, the system falls back to ElevenLabs for TTS.

### 4. Configure Azure Blob Storage

1. Create an Azure Storage Account in the Azure Portal
2. Create a container (e.g., `screenshare-recordings`)
3. Get the connection string from **Access Keys**

```env
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER_NAME=screenshare-recordings
```

### 5. Start PostgreSQL

```bash
docker-compose up -d
```

### 6. Run Database Migrations

```bash
bun run db:push
```

### 7. Start Development Servers

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

### 8. Open the App

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

- `POST /storage/upload-url` - Get SAS URL for video upload
- `POST /storage/frame-upload-url` - Get SAS URL for frame upload
- `GET /storage/download-url/:key` - Get SAS URL for download

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AI_PROVIDER` | `anthropic` (default) or `azure` |

### Anthropic Provider

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for vision |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | Voice ID (default: Rachel) |

### Azure Provider

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT_VISION` | GPT-4o deployment name |
| `AZURE_SPEECH_ENDPOINT` | Azure Speech endpoint (optional) |
| `AZURE_SPEECH_API_KEY` | Azure Speech API key (optional) |
| `AZURE_SPEECH_VOICE_NAME` | Voice name (default: en-US-JennyNeural) |

### Storage

| Variable | Description |
|----------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string |
| `AZURE_STORAGE_CONTAINER_NAME` | Container name (default: screenshare-recordings) |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `CORS_ORIGIN` | http://localhost:3000 | Frontend origin |

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

1. **Database**: Use a managed PostgreSQL service (Neon, Azure Database for PostgreSQL, etc.)
2. **Session State**: Replace in-memory Map with Redis for multi-instance
3. **WebSocket**: Use a WebSocket-capable host (Railway, Azure App Service, etc.)
4. **Frontend**: Deploy Next.js to Vercel or Azure Static Web Apps
5. **HTTPS**: Required for `getDisplayMedia()` in production

### Azure Deployment

```bash
# Using Azure Container Apps
az containerapp up \
  --name screenshare-guide \
  --source . \
  --env-vars DATABASE_URL=... AI_PROVIDER=azure ...
```

### Environment Variables for Production

Ensure all sensitive environment variables are set in your deployment platform:

```bash
# Core
DATABASE_URL=<production-postgres-url>
CORS_ORIGIN=https://your-domain.com

# AI Provider (choose one set)
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT_VISION=gpt-4o

# Storage
AZURE_STORAGE_CONNECTION_STRING=<connection-string>
AZURE_STORAGE_CONTAINER_NAME=screenshare-recordings
```

## License

MIT
