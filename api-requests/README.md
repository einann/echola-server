# API Requests Collection

This folder contains REST Client files for testing all API endpoints in VS Code.

## Prerequisites

1. Install the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension for VS Code
2. Make sure your server is running: `yarn start:dev`

## How to Use

### 1. Start with Authentication

1. Open `auth.http`
2. Use the **Register** or **Login** endpoint
3. Click "Send Request" above the request
4. Copy the `accessToken` from the response

### 2. Update the Token (Choose One Method)

**Method 1 - Single Update Location (RECOMMENDED):**
1. Open `.vscode/settings.json` in the project root
2. Find `"rest-client.environmentVariables.$shared"`
3. Replace `YOUR_ACCESS_TOKEN_HERE` with your actual access token
4. Save the file
5. **All .http files will now use this token!**

**Method 2 - Manual Update (if you prefer):**
1. Update the `@token` variable at the top of each `.http` file you want to use
2. You'll need to update it in multiple files when the token expires

### 3. Test Other Endpoints

Now you can test any endpoint in the other files:
- `users.http` - User profile, avatar, email verification, password reset
- `conversations.http` - Create and manage conversations
- `messages.http` - Send, edit, delete messages
- `media.http` - Upload and download media files
- `storage.http` - Low-level storage operations (dev/testing)
- `health.http` - Health check endpoints (no auth required)

## File Structure

```
api-requests/
├── _shared.http           # Shared variables (baseUrl, token, contentType)
├── auth.http              # Authentication endpoints
├── users.http             # User management endpoints
├── conversations.http     # Conversation endpoints
├── messages.http          # Message endpoints
├── media.http             # Media upload/download endpoints
├── storage.http           # Storage endpoints (dev only)
├── health.http            # Health check endpoints
└── README.md              # This file
```

## Tips

- Click "Send Request" above any HTTP request to execute it
- Responses appear in a new panel to the right
- You can save response data and use it in subsequent requests
- Use `Cmd/Ctrl + Alt + R` to send the request at cursor
- Use `Cmd/Ctrl + Alt + L` to switch between request and response

## Variables

The following variables are shared across all files:

- `{{baseUrl}}` - API base URL (default: http://localhost:3000)
- `{{token}}` - JWT access token (update after login)
- `{{contentType}}` - Content-Type header (default: application/json)

## Common Workflows

### Register and Login Flow
1. Register a new user → `auth.http` (Register)
2. Login with credentials → `auth.http` (Login)
3. Copy the `accessToken` and update `_shared.http`

### Send a Message Flow
1. Get your conversations → `conversations.http` (Get All My Conversations)
2. Or create a new conversation → `conversations.http` (Create Direct/Group)
3. Send a message → `messages.http` (Send Message)

### Upload Media Flow
1. Request upload URL → `media.http` (Request Upload URL)
2. Upload file directly to S3/MinIO using the presigned URL (use curl or Postman)
3. Confirm upload → `media.http` (Confirm Media Upload)

## Notes

- Most endpoints require authentication (Bearer token)
- Health check endpoints do not require authentication
- Storage endpoints are for development/testing only
- Replace UUIDs in URLs with actual IDs from your responses
