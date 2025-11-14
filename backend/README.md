# MyNotes Backend API

Backend server for MyNotes app with authentication, API key management, and secure chat proxy.

## Features

- 🔐 Google OAuth authentication
- 👥 User role management (admin/user)
- 🔑 Encrypted API key storage (AES-256)
- 🛡️ Rate limiting and security
- 💬 Secure chat proxy to OpenRouter API

## Setup

### 1. MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster (M0 - Free tier)
3. Create a database user
4. Whitelist IP address (0.0.0.0/0 for development, or your server IP for production)
5. Get connection string: `mongodb+srv://username:password@cluster.mongodb.net/mynotes?retryWrites=true&w=majority`

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
5. Application type: Web application
6. Authorized JavaScript origins: `https://yourusername.github.io` (your GitHub Pages URL)
7. Authorized redirect URIs: `https://yourusername.github.io` (same)
8. Copy the Client ID

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:
- `MONGODB_URI` - Your MongoDB Atlas connection string
- `JWT_SECRET` - Generate with: `openssl rand -hex 32`
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `ADMIN_EMAILS` - Comma-separated admin emails
- `ADMIN_OPENROUTER_API_KEY` - Your OpenRouter API key for admin users
- `FRONTEND_URL` - Your GitHub Pages URL
- `ENCRYPTION_KEY` - Generate with: `openssl rand -hex 32` (must be 64 hex chars)

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Development Server

```bash
npm run dev
```

### 6. Deploy to Railway (Free Tier)

1. Go to [Railway](https://railway.app)
2. Sign up with GitHub
3. New Project → Deploy from GitHub repo
4. Select your repo
5. Root Directory: `backend`
6. Add environment variables in Railway dashboard
7. Deploy!

Railway will give you a URL like: `https://your-app.railway.app`

## Database Schema

### Collection: `users`
```javascript
{
  _id: ObjectId,
  googleId: String (unique),
  email: String (unique),
  role: "admin" | "user",
  createdAt: Date
}
```

### Collection: `apiKeys`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (reference to users),
  encryptedKey: String (AES-256 encrypted),
  updatedAt: Date
}
```

## API Endpoints

### Authentication
- `POST /api/auth/google` - Verify Google token, return JWT
- `GET /api/auth/me` - Get current user (requires auth)

### API Key Management
- `POST /api/user/api-key` - Save/update user's API key (non-admin only)
- `GET /api/user/api-key/status` - Check if user has API key

### Chat
- `POST /api/chat` - Proxy chat requests to OpenRouter (requires auth)

## Security Features

- ✅ JWT token authentication
- ✅ AES-256 encryption for API keys
- ✅ Rate limiting (100 req/15min general, 10 req/min for chat)
- ✅ CORS protection
- ✅ Input validation
- ✅ Admin/user role separation

## Production Checklist

- [ ] Set strong `JWT_SECRET` (64+ characters)
- [ ] Set strong `ENCRYPTION_KEY` (64 hex characters)
- [ ] Restrict CORS to your GitHub Pages domain
- [ ] Use MongoDB IP whitelist (not 0.0.0.0/0)
- [ ] Set up monitoring/logging
- [ ] Enable HTTPS only
- [ ] Review rate limits for your use case

