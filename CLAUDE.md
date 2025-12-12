# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Echola is a real-time messaging backend built with NestJS, featuring WebSocket-based chat functionality with Redis pub/sub for horizontal scaling.

## Common Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Build & Production
npm run build              # Build the project
npm run start:prod         # Run production build

# Database
npx prisma generate        # Generate Prisma client (outputs to generated/prisma)
npx prisma migrate dev     # Run migrations in development
npx prisma migrate deploy  # Run migrations in production
npx prisma studio          # Open Prisma Studio GUI

# Infrastructure
docker compose up -d       # Start PostgreSQL, Redis, and MinIO

# Testing
npm run test               # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:e2e           # Run e2e tests (uses test/jest-e2e.json)
npm run test -- --testPathPattern="filename"  # Run specific test file

# Code Quality
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting
```

## Architecture

### Module Structure

The application follows NestJS modular architecture with domain-based organization:

- **Gateway Layer** (`src/gateway/`) - Single `ChatGateway` handles all WebSocket connections at `/chat` namespace. Delegates event handling to specialized handlers.

- **Handler Pattern** - WebSocket events are processed by dedicated handlers:
  - `ConnectionHandler` - User connect/disconnect, room management
  - `MessagesHandler` - Send, deliver, read status
  - `ReactionsHandler` - Emoji reactions on messages
  - `PresenceHandler` - Typing indicators
  - `StorageHandler` - File upload via presigned URLs
  - `GroupsHandler` - Group management (add/remove members, roles)

- **Service Layer** - Business logic separate from handlers:
  - `ConversationsService` - Conversation CRUD
  - `MessagesService` - Message persistence
  - `StorageService` - S3/MinIO operations (low-level)
  - `StorageOrchestrationService` - High-level upload flow
  - `StorageValidationService` - File type/size validation

### Cross-Cutting Concerns

- **Global Filters**: `HttpExceptionFilter`, `AllWsExceptionsFilter` - Centralized error handling for HTTP and WebSocket
- **Global Interceptors**: `TransformInterceptor` (response format), `TimeoutInterceptor` (30s limit)
- **Middleware**: `RequestContextMiddleware`, `LoggingMiddleware`, `RateLimitMiddleware`

### Data Layer

- **Prisma** - ORM with schema at `prisma/schema.prisma`, client output at `generated/prisma`
- **Redis** - Used for:
  - Socket.IO adapter for multi-server pub/sub (`RedisIoAdapter`)
  - User presence tracking (`user:{userId}:online`)
  - Typing indicators (5s TTL)
  - Message inbox for offline users (ZSET with 7-day expiry)
  - Upload metadata caching
  - Session storage

### WebSocket Events

Client emits: `send_message`, `message_delivered`, `message_read`, `typing_start`, `typing_stop`, `file:upload:request`, `file:upload:complete`, `message:reaction:add`, `message:reaction:remove`, `group:*`

Server emits: `new_message`, `message_delivered`, `message_read`, `user_typing`, `error`

### Authentication

JWT-based with access/refresh token pattern:

- Access token verified on WebSocket connection via handshake auth
- Guards: `JwtAccessGuard`, `JwtRefreshGuard`
- Strategies: `JwtAccessStrategy`, `JwtRefreshStrategy`
- Device tracking for multi-device support

### Storage

MinIO/S3-compatible storage with presigned URL flow:

1. Client requests upload URL via WebSocket
2. Server validates and returns presigned PUT URL
3. Client uploads directly to MinIO
4. Client confirms upload, server creates message with media

## Environment Variables

Required in `.env` (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` - JWT signing keys
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` - MinIO/S3 config

## Key Patterns

- **Prisma imports**: Use `import { ... } from 'generated/prisma/client'` (custom output path)
- **WebSocket responses**: Handlers return acknowledgment objects, errors go through `AllWsExceptionsFilter`
- **DTO validation**: `class-validator` decorators with global `ValidationPipe`
- **Socket typing**: `AuthenticatedSocket` extends Socket with `data.userId`, `data.deviceId`

- When creating new modules, always update app.module. Don't use newly created module/controller/service files elsewhere before ask.
- When implementing a new feature which uses a library of framework, use context7 in order to check up to date documentation.
