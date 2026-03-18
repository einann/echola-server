# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Echola is a real-time messaging backend built with NestJS. It supports WebSocket-based chat, group conversations, media uploads (images/videos/documents), message reactions, typing indicators, and presence tracking. The backend uses PostgreSQL for persistence, Redis for pub/sub and caching, and MinIO/S3 for media storage.

## Development Commands

### Setup

```bash
# Install dependencies
yarn install

# Start Docker services (PostgreSQL, Redis, MinIO)
docker-compose up -d

# Run Prisma migrations
npx prisma migrate dev

# Generate Prisma client (outputs to ./generated/prisma)
npx prisma generate
```

### Development

```bash
# Development mode with hot reload
yarn start:dev

# Production build
yarn build
yarn start:prod

# Debug mode
yarn start:debug
```

### Testing

```bash
# Run unit tests
yarn test

# Watch mode for tests
yarn test:watch

# E2E tests
yarn test:e2e

# Test coverage
yarn test:cov
```

### Code Quality

```bash
# Lint and auto-fix
yarn lint

# Format code
yarn format
```

### Database

```bash
# Create new migration
npx prisma migrate dev --name <migration_name>

# Reset database (drops all data)
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

## Architecture

### Module Organization

The application follows NestJS modular architecture with these key modules:

- **AuthModule**: JWT-based authentication with refresh tokens, device management
- **GatewayModule**: WebSocket gateway (`/chat` namespace) coordinating all real-time events
- **MessagesModule**: Message CRUD, delivery/read status tracking, typing indicators
- **ConversationsModule**: Direct and group conversation management, archive/pin, mute, notification preferences
- **PresenceModule**: User online/offline status, typing indicators
- **ConnectionModule**: WebSocket connection lifecycle management
- **StorageModule**: File uploads to S3/MinIO with presigned URLs
- **MediaModule**: Image/video/document processing and metadata extraction
- **RedisModule**: Global Redis client for pub/sub and caching
- **PrismaModule**: Global database client
- **LoggerModule**: Pino-based structured logging
- **UserModule**: User profile, avatar upload, email verification, password reset, user search, block/unblock users
- **MetricsModule**: Prometheus metrics at `/metrics` endpoint
- **HealthModule**: Health checks at `/health`, `/health/live`, `/health/ready`
- **NotificationsModule**: Push notifications via Firebase Cloud Messaging (FCM)

### Global Modules

`@Global()` decorator is used for:

- **PrismaModule**: Database access throughout the app
- **RedisModule**: Pub/sub and caching
- **StorageModule**: File upload/download capabilities
- **NotificationsModule**: Push notifications throughout the app

### WebSocket Architecture

The WebSocket gateway uses a handler-based pattern:

- **ChatGateway** (`src/gateway/chat.gateway.ts`): Main gateway listening on `/chat` namespace
- Event handlers are delegated to specialized handlers:
  - `ConnectionHandler`: Connection/disconnection lifecycle
  - `MessagesHandler`: Message send/receive, media uploads, status updates
  - `ReactionsHandler`: Message reactions
  - `PresenceHandler`: Typing indicators, online/offline
  - `GroupsHandler`: Group member management

WebSocket authentication:

- Clients send JWT token in handshake (`auth.token` or `Authorization` header)
- Token verified in `handleConnection()` using `JWT_ACCESS_SECRET`
- User ID and device ID attached to `socket.data` for all subsequent events

WebSocket events emitted:

- `conversation:created`: Emitted to all participants when a new conversation is created (direct or group)

### Redis Pub/Sub

Redis is used for cross-server message delivery in distributed deployments:

- Messages published to `conversation:*` channels
- Gateway subscribes in `subscribeToRedisChannels()`
- RedisIoAdapter enables Socket.IO to scale across multiple servers

### Storage Flow

Media uploads use a two-step presigned URL pattern:

1. Client requests upload URL via `media:request_upload` event
2. Client uploads directly to S3/MinIO using presigned URL
3. Client confirms upload via `media:confirm_upload` event
4. Message with attachment metadata saved to database

### Middleware Stack (Applied in Order)

1. **RequestContextMiddleware**: Request context setup (must be first)
2. **RateLimitMiddleware**: Rate limiting per IP/user (Redis-based, distributed)
   - Auth endpoints: 5 requests / 15 minutes
   - Conversation creation: 10 requests / 1 hour
   - File uploads: 50 requests / 1 hour
   - Default: 100 requests / 1 minute
3. **Global Validation Pipe**: DTO validation with `class-validator`
4. **Transform Interceptor**: Standardizes all API responses
5. **Timeout Interceptor**: 30-second request timeout

### Database Schema

Prisma schema location: `prisma/schema.prisma`
Generated client: `generated/prisma/` (not `node_modules/.prisma`)

Key models:

- **User**: Authentication, profile, presence
- **Device**: Multi-device support per user
- **RefreshToken**: JWT refresh tokens tied to devices
- **EmailVerificationToken**: Tokens for email verification
- **PasswordResetToken**: Tokens for password reset
- **BlockedUser**: User blocking relationships (bidirectional)
- **Conversation**: Direct or group conversations
- **ConversationParticipant**: User membership in conversations with settings:
  - Notification preferences: `notifyOnMessage`, `notifyOnMention`, `notifySound`
  - Archive/pin: `isArchived`, `isPinned`, `pinnedAt`
  - Mute: `isMuted`
  - Read tracking: `lastReadAt`
- **Message**: Text/media/system messages with reply and forwarding support
- **MessageAttachment**: Media files (images/videos/documents/audio) with S3 keys and voice waveform data
- **MessageStatus**: Per-user delivery/read status
- **MessageReaction**: Emoji reactions on messages

### Environment Configuration

Environment validation: `src/config/env.validation.ts`

- Uses `class-validator` and `class-transformer` for type-safe env vars
- ConfigModule is global, inject `ConfigService<EnvironmentVariables>` for typed access

Required env vars (see `.env.example`):

- Database: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- JWT: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION`
- Redis: `REDIS_HOST`, `REDIS_PORT`
- S3/MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_USE_SSL`
- MinIO: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`
- App: `PORT`, `NODE_ENV`, `FRONTEND_URL`
- Monitoring: `SENTRY_DSN`
- Email/SMPT: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Limits: `MAX_IMAGE_SIZE`, `MAX_VIDEO_SIZE`, `MAX_DOCUMENT_SIZE`, `MAX_GROUP_SIZE`
- Firebase (optional): `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`

### Logging

Uses `nestjs-pino` with `pino-pretty` for structured logging:

- Configured in `LoggerModule`
- Inject `Logger` from `nestjs-pino` (not `@nestjs/common`)
- Console output in development, JSON in production

### Error Handling

- **HttpExceptionFilter**: Global HTTP exception handling with Sentry integration
- **AllWsExceptionsFilter**: WebSocket-specific exception handling
- Sentry initialized in `main.ts` before any setup

## Docker

### Development Services

Default ports (configured in `docker-compose.yml`):

- PostgreSQL: `5433:5432` (host:container)
- Redis: `6379:6379`
- MinIO API: `9000:9000`
- MinIO Console: `9001:9001` (web UI)

Access MinIO console at `http://localhost:9001` with credentials from `.env`.

### Production Docker Image

Build and run the production Docker image:

```bash
# Build image
docker build -t echola-server .

# Run container
docker run -p 3000:3000 --env-file .env echola-server
```

The Dockerfile uses:
- Multi-stage build for smaller image size
- Non-root user for security
- Health check on `/health` endpoint
- `dumb-init` for proper signal handling

## Common Patterns

### Adding a New WebSocket Event

1. Define DTO in relevant module's `dto/` directory
2. Add handler method in appropriate handler (e.g., `MessagesHandler`)
3. Add `@SubscribeMessage()` in `ChatGateway` that delegates to handler
4. Update Redis pub/sub if event needs cross-server broadcasting

### Adding a New REST Endpoint

1. Create controller method with `@Post/@Get/@Put/@Delete` decorator
2. Create DTO with `class-validator` decorators
3. Add service method with business logic
4. Use `@UseGuards(JwtAuthGuard)` for protected endpoints

### Database Changes

1. Update `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name descriptive_name`
3. Prisma client auto-regenerates to `generated/prisma/`
4. Import types from `@prisma/client` (points to generated directory)

### Block Validation Pattern

When implementing features that involve user interactions:

1. Check `BlockedUser` table for bidirectional blocks
2. Use helper method: `checkIfBlocked(userId, targetUserId)`
3. Throw `ForbiddenException` with clear message if blocked
4. Already implemented in:
   - Conversation creation (direct and group)
   - Adding members to groups

## Key Features

### Conversation Management

**Archive/Unarchive:**
- `POST /conversations/:id/archive` - Archive a conversation (per-user)
- `POST /conversations/:id/unarchive` - Unarchive a conversation
- `GET /conversations?archived=true` - Filter archived conversations

**Pin/Unpin:**
- `POST /conversations/:id/pin` - Pin a conversation (max 5 per user)
- `POST /conversations/:id/unpin` - Unpin a conversation
- Pinned conversations appear first in list, sorted by `pinnedAt` DESC

**Mute/Unmute:**
- `POST /conversations/:id/mute` - Mute notifications
- `POST /conversations/:id/unmute` - Unmute notifications

**Notification Preferences:**
- `PUT /conversations/:id/notification-preferences` - Update per-conversation notification settings
- Settings: `notifyOnMessage`, `notifyOnMention`, `notifySound`

**Bulk Operations:**
- `POST /conversations/mark-all-read` - Mark all conversations as read

**Search and Filters:**
- Query parameters: `search`, `type`, `muted`, `archived`
- Cursor-based pagination with `limit` and `cursor`
- Example: `GET /conversations?search=john&type=GROUP&muted=false&limit=20`

### User Blocking

**Block/Unblock Users:**
- `POST /users/block/:userId` - Block a user
- `DELETE /users/block/:userId` - Unblock a user
- `GET /users/blocked` - Get list of blocked users

**Blocking Rules:**
- Bidirectional: If A blocks B OR B blocks A, they cannot interact
- Prevents: Creating conversations, adding to groups
- Cannot block yourself
- Cannot block the same user twice

### Message Forwarding

**Forward messages to other conversations:**
- `POST /messages/forward` - Forward a message to multiple conversations
- WebSocket event: `message:forward`
- Preserves original sender info via `forwardedFromUserId`
- Copies all attachments to forwarded message
- Supports forwarding to multiple conversations at once

### Voice Messages

**Voice message support with waveform visualization:**
- Audio files processed by `AudioProcessor`
- Generates waveform data (100 normalized amplitude peaks)
- Duration estimation based on file size and codec
- Waveform stored in `MessageAttachment.waveformData`

### Push Notifications (FCM)

**Firebase Cloud Messaging integration:**
- `POST /notifications/fcm-token` - Register FCM token for device
- `DELETE /notifications/fcm-token` - Unregister FCM token
- Automatic push for offline users when messages arrive
- Respects conversation mute and notification preferences
- Automatically removes invalid/expired tokens

### Message Search

**Full-text search within conversations:**
- `GET /messages/conversation/:id/search?q=query` - Search messages
- WebSocket event: `message:search`
- PostgreSQL GIN index for efficient full-text search
- Supports pagination with `limit` and `offset`
- Returns matching messages with full context

## Testing

- Unit tests: `*.spec.ts` files alongside source files
- E2E tests: `test/` directory with `jest-e2e.json` config
- Use `@nestjs/testing` to create testing modules
- Mock PrismaService and RedisService in tests

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push/PR to `main` and `develop`:

1. **Lint**: ESLint and Prettier checks
2. **Build**: TypeScript compilation and Prisma generation
3. **Test**: Unit tests with coverage (requires PostgreSQL and Redis services)
4. **Docker**: Build Docker image (on main branch only)

## Monitoring

### Health Checks

- `GET /health` - Full health check (database, Redis, MinIO, memory, disk)
- `GET /health/live` - Liveness probe (is the app running?)
- `GET /health/ready` - Readiness probe (is the app ready for traffic?)

### Prometheus Metrics

- `GET /metrics` - Prometheus-compatible metrics endpoint
- Default metrics: Node.js runtime metrics
- Custom metrics: HTTP requests, WebSocket connections, messages sent, auth attempts

### Security

- **Helmet**: Security headers (CSP, X-Frame-Options, HSTS, etc.)
- **CORS**: Configured via `FRONTEND_URL` environment variable
- **Trust Proxy**: Enabled for rate limiting behind load balancers
- **Graceful Shutdown**: 15-second timeout for clean shutdown

# When implementing a new library or framework, or adding a feature that uses them, check the latest documentation using context7.

# Whenever you update prisma schema or add new modules or update environment variables, update this file.
