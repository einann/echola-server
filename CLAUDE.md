# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Echola is a real-time chat application backend built with NestJS, using WebSocket (Socket.io) for real-time messaging, PostgreSQL for data persistence, and Redis for caching/pub-sub.

## Tech Stack

- **Framework:** NestJS 11 with TypeScript
- **Database:** PostgreSQL 15 via Prisma ORM
- **Real-time:** Socket.io with Redis adapter (multi-instance support)
- **Caching:** Redis
- **File Storage:** AWS S3 / MinIO
- **Auth:** JWT with Passport.js
- **Monitoring:** Sentry
- **Logging:** Pino (structured logging)

## Common Commands

```bash
# Development
yarn start:dev          # Run with hot reload

# Build & Production
yarn build              # Compile TypeScript
yarn start:prod         # Run production build

# Testing
yarn test               # Run unit tests
yarn test:watch         # Watch mode
yarn test:e2e           # End-to-end tests
yarn test:cov           # Coverage report

# Code Quality
yarn lint               # ESLint with auto-fix
yarn format             # Prettier formatting

# Database
npx prisma generate     # Generate Prisma client after schema changes
npx prisma migrate dev  # Run migrations in development
npx prisma studio       # Visual database browser
```

## Architecture

### Module Structure

Each feature is a self-contained NestJS module following this pattern:

- `*.module.ts` - Module definition with imports/providers
- `*.service.ts` - Business logic
- `*.controller.ts` - HTTP endpoints
- `*.handler.ts` - WebSocket event handlers
- `dto/` - Request/response DTOs with class-validator decorators

### Key Modules

| Module           | Purpose                                           |
| ---------------- | ------------------------------------------------- |
| `auth/`          | JWT authentication, login/register, token refresh |
| `gateway/`       | Main WebSocket gateway (`chat.gateway.ts`)        |
| `conversations/` | Direct & group chat management                    |
| `messages/`      | Message CRUD, attachments                         |
| `presence/`      | Online status, typing indicators                  |
| `media/`         | Image/video processing (Sharp)                    |
| `storage/`       | S3/MinIO file operations                          |
| `redis/`         | Redis client wrapper                              |

### Response Format

All HTTP responses use a standardized envelope:

```typescript
// Success
{ success: true, data: T, timestamp, requestId, path }

// Error
{ success: false, error: { code, message, details? }, timestamp, path, requestId }
```

### WebSocket Events

Real-time events flow through the gateway and are handled by dedicated `*.handler.ts` files. Events are broadcast via Redis adapter for multi-instance support.

### Middleware Pipeline

1. `RequestContextMiddleware` - Adds requestId and userId to request
2. `RateLimitMiddleware` - Request rate limiting
3. `ValidationPipe` - DTO validation (global)

## Database Schema (Prisma)

Key models: `User`, `Device`, `RefreshToken`, `Conversation`, `ConversationParticipant`, `Message`, `MessageAttachment`, `MessageStatus`, `MessageReaction`

Key enums: `ConversationType` (DIRECT, GROUP), `MessageType` (TEXT, MEDIA, SYSTEM, DELETED), `MediaType`, `DeliveryStatus`

## Infrastructure

Docker Compose provides local development services:

- PostgreSQL 15
- Redis 7
- MinIO (S3-compatible storage)

Run `docker-compose up -d` to start services before development.

## Environment

Copy `.env.example` to `.env` and configure:

- Database connection (PostgreSQL)
- Redis connection
- JWT secrets
- S3/MinIO credentials
- Sentry DSN (optional)

# When implementing a new library or framework or a feature which uses these, use context7 to check latest documents.
