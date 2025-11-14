# ChatNote Backend API

RESTful API server for ChatNote application providing authentication, secure API key management, and chat proxy functionality.

## Overview

The ChatNote backend is a Node.js/Express server that handles:
- User authentication via Google OAuth
- Secure storage and management of user API keys (encrypted)
- Proxy service for OpenRouter API requests
- Role-based access control (admin/user)
- Rate limiting and security protections

## Features

- 🔐 **Google OAuth Authentication** - Secure user authentication with JWT tokens
- 👥 **User Role Management** - Admin and user roles with different permissions
- 🔑 **Encrypted API Key Storage** - User API keys encrypted with AES-256-GCM
- 🛡️ **Rate Limiting** - Configurable rate limits to prevent abuse
- 💬 **Chat Proxy** - Secure proxy to OpenRouter API with user API key management
- 🌐 **CORS Protection** - Secure cross-origin request handling
- ✅ **Input Validation** - All user inputs are validated

## Architecture

```
Frontend (GitHub Pages)
    │
    │ HTTPS
    │
Backend (Render/Railway)
    │
    ├── Authentication (JWT)
    ├── API Key Management (Encrypted)
    ├── Chat Proxy (OpenRouter)
    │
    │ MongoDB Connection
    │
MongoDB Atlas
    ├── users collection
    └── apiKeys collection (encrypted)
```

## Technology Stack

- **Node.js** - Runtime environment
- **Express** - Web framework
- **MongoDB** - Database (via MongoDB Atlas)
- **JWT** - Token-based authentication
- **Google OAuth 2.0** - User authentication
- **crypto** - AES-256-GCM encryption
- **express-rate-limit** - Rate limiting middleware
- **CORS** - Cross-origin resource sharing

## API Endpoints

### Authentication

#### `POST /api/auth/google`
Verify Google OAuth token and return JWT.

**Request:**
```json
{
  "credential": "google-oauth-token"
}
```

**Response:**
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "profile-picture-url",
    "role": "user"
  }
}
```

#### `GET /api/auth/me`
Get current authenticated user information.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "profile-picture-url",
    "role": "user"
  }
}
```

### API Key Management

#### `POST /api/user/api-key`
Save or update user's OpenRouter API key (encrypted before storage).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Request:**
```json
{
  "apiKey": "sk-or-v1-user-api-key"
}
```

**Response:**
```json
{
  "message": "API key saved successfully"
}
```

#### `GET /api/user/api-key/status`
Check if user has an API key stored.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "hasApiKey": true
}
```

### Chat Proxy

#### `POST /api/chat`
Proxy chat requests to OpenRouter API using user's stored API key.

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello, AI!"
    }
  ],
  "model": "openai/gpt-oss-120b",
  "temperature": 0.7,
  "maxTokens": 3000
}
```

**Response:**
Streaming response from OpenRouter API.

## Database Schema

### Users Collection

```javascript
{
  _id: ObjectId,
  googleId: String (unique, indexed),
  email: String (unique, indexed),
  name: String,
  picture: String,
  role: "admin" | "user",
  createdAt: Date
}
```

### API Keys Collection

```javascript
{
  _id: ObjectId,
  userId: ObjectId (reference to users._id, indexed),
  encryptedKey: String (AES-256-GCM encrypted),
  updatedAt: Date
}
```

## Security Features

### Encryption

- **Algorithm**: AES-256-GCM
- **Key Storage**: Environment variable (`ENCRYPTION_KEY`)
- **Key Format**: 64 hex characters (32 bytes)
- **IV**: Random 16 bytes per encryption
- **Authentication Tag**: Included in encrypted data

### Authentication

- **JWT Tokens**: Signed with `JWT_SECRET`
- **Token Expiration**: Configured in JWT payload
- **Google OAuth**: Token verification via Google API

### Rate Limiting

- **General Endpoints**: 100 requests per 15 minutes per IP
- **Chat Endpoint**: 10 requests per minute per IP
- **Configurable**: Via `express-rate-limit` middleware

### CORS

- **Allowed Origins**: Configured via `FRONTEND_URL` environment variable
- **Credentials**: Enabled for cookie/token support
- **Local Development**: Allows `localhost` and `127.0.0.1` origins

## Environment Variables

### Required Variables

- `MONGODB_URI` - MongoDB Atlas connection string
  - Format: `mongodb+srv://username:password@cluster.mongodb.net/chatnote?...`
  - Must include database name: `/chatnote`
  
- `JWT_SECRET` - Secret key for JWT token signing
  - Generate with: `openssl rand -hex 32`
  - Minimum 64 characters recommended

- `GOOGLE_CLIENT_ID` - Google OAuth 2.0 Client ID
  - Format: `xxxxx.apps.googleusercontent.com`
  - From Google Cloud Console

- `FRONTEND_URL` - Frontend URL for CORS configuration
  - Format: `https://username.github.io/ChatNote`
  - Must match exact frontend deployment URL

- `ENCRYPTION_KEY` - AES-256 encryption key
  - Generate with: `openssl rand -hex 32`
  - Must be exactly 64 hex characters

### Optional Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (`development` or `production`)
- `ADMIN_EMAILS` - Comma-separated admin email addresses
- `ADMIN_OPENROUTER_API_KEY` - OpenRouter API key for admin users

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in all required variables.

### 3. Run Development Server

```bash
npm run dev
```

Server runs on `http://localhost:3000`

### 4. Production Deployment

Deploy to Render or Railway:

1. Connect GitHub repository
2. Set root directory to `backend`
3. Configure build command: `npm install`
4. Configure start command: `npm start`
5. Add all environment variables
6. Deploy

## Health Check

The server provides a health check endpoint:

```
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

## Error Handling

All errors return JSON responses:

```json
{
  "error": "Error message"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Production Checklist

- [ ] Set strong `JWT_SECRET` (64+ characters)
- [ ] Set strong `ENCRYPTION_KEY` (64 hex characters)
- [ ] Configure `FRONTEND_URL` to match production frontend
- [ ] Restrict MongoDB Network Access (not `0.0.0.0/0` in production)
- [ ] Set `NODE_ENV=production`
- [ ] Configure admin emails in `ADMIN_EMAILS`
- [ ] Review and adjust rate limits for your use case
- [ ] Set up monitoring and logging
- [ ] Enable HTTPS only (handled by Render/Railway)

## License

Copyright (c) 2025. All rights reserved.

This software and associated documentation files (the "Software") are the proprietary and confidential property of the owner. 

**No part of this Software may be:**
- Copied, modified, or distributed
- Used for any purpose without explicit written permission
- Reverse engineered or decompiled
- Used to create derivative works

Unauthorized use, reproduction, or distribution of this Software, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
