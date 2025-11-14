# ChatNote

A modern web application that enables students to upload PDF documents, extract text selections, and interact with AI chatbots to enhance their understanding of course materials. Built with React, TypeScript, and a secure Node.js backend.

## Overview

ChatNote provides an interactive learning platform where students can:
- Upload and view PDF documents with advanced zoom and navigation controls
- Select and highlight text from PDFs
- Engage with multiple AI models through a contextual chat interface
- Store and manage their API keys securely through encrypted backend storage
- Authenticate via Google OAuth for a seamless experience

## Features

### Frontend Features

- **PDF Viewer**: Full-featured PDF viewer with zoom controls, page navigation, and text selection
- **AI Chat Interface**: Contextual chatbot that uses selected PDF text to provide relevant answers
- **Multiple AI Models**: Support for various AI models via OpenRouter API (GPT OSS, DeepSeek, Llama, Qwen)
- **Flexible Layouts**: Two layout modes - floating chat panel and split-screen view
- **Theme Support**: Light and dark theme with smooth transitions
- **Responsive Design**: Modern, mobile-friendly UI built with CSS Flexbox
- **Markdown Rendering**: Chat responses support Markdown and LaTeX math rendering

### Backend Features

- **Google OAuth Authentication**: Secure user authentication with Google Sign-In
- **Encrypted API Key Storage**: User API keys are encrypted (AES-256) and stored securely in MongoDB
- **Role-Based Access**: Admin and user roles with different permissions
- **Rate Limiting**: Protection against abuse with configurable rate limits
- **CORS Protection**: Secure cross-origin request handling
- **Chat Proxy**: Secure proxy to OpenRouter API with user API key management

## Tech Stack

### Frontend

- **React 18** + **TypeScript** - Modern UI framework with type safety
- **Vite** - Fast build tool and development server
- **react-pdf** (PDF.js) - PDF rendering and text extraction
- **react-markdown** + **KaTeX** - Markdown and LaTeX math rendering
- **Modern CSS** - Flexbox-based responsive layout

### Backend

- **Node.js** + **Express** - RESTful API server
- **MongoDB Atlas** - Cloud database for user data and encrypted API keys
- **JWT** - Token-based authentication
- **Google OAuth 2.0** - User authentication
- **AES-256-GCM** - Encryption for API keys
- **express-rate-limit** - Rate limiting middleware

## Architecture

```
┌─────────────────┐
│   GitHub Pages  │  Frontend (React + Vite)
│   (Frontend)    │  - Static files
└────────┬────────┘  - Environment variables via GitHub Secrets
         │
         │ HTTPS
         │
┌────────▼────────┐
│   Render/Railway│  Backend (Node.js + Express)
│   (Backend API) │  - Authentication
└────────┬────────┘  - API key management
         │           - Chat proxy
         │
         │ MongoDB Connection
         │
┌────────▼────────┐
│  MongoDB Atlas  │  Database
│                 │  - Users collection
└─────────────────┘  - API keys collection (encrypted)
```

## Project Structure

```
ChatNote/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   │   ├── NavBar.tsx      # Navigation bar
│   │   ├── PDFViewer.tsx   # PDF upload and viewer
│   │   ├── ChatGPTEmbedded.tsx  # Chat interface
│   │   └── LoginButton.tsx # Google OAuth login
│   ├── contexts/           # React contexts
│   │   ├── AuthContext.tsx # Authentication state
│   │   └── ThemeContext.tsx # Theme management
│   ├── services/           # API services
│   │   ├── authService.ts  # Authentication API
│   │   ├── authenticatedChatService.ts  # Chat API
│   │   └── openaiService.ts # Legacy OpenAI service
│   ├── config.ts           # Configuration (models, API URLs)
│   └── prompts/            # AI model instructions
│       └── modelInstructions.ts
├── backend/                # Backend server
│   ├── server.js           # Express server
│   ├── package.json        # Backend dependencies
│   └── README.md           # Backend documentation
├── public/                 # Static assets
│   └── chatnote-icon.svg   # App icon
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Actions deployment
```

## Configuration

### Supported AI Models

The application supports multiple AI models via OpenRouter:

- **GPT OSS** (OpenAI) - `openai/gpt-oss-120b`
- **DeepSeek R1** (DeepSeek) - `tngtech/deepseek-r1t2-chimera:free`
- **DeepSeek V3.1** (DeepSeek) - `deepseek/deepseek-chat-v3.1:free`
- **Llama 3.3** (Meta) - `meta-llama/llama-3.3-70b-instruct:free`
- **Qwen 3** (Qwen) - `qwen/qwen3-235b-a22b:free`

Models can be customized in `src/config.ts`.

### Environment Variables

#### Frontend (GitHub Secrets)

- `VITE_GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `VITE_BACKEND_URL` - Backend API URL (Render/Railway)

#### Backend (Render/Railway Environment Variables)

- `MONGODB_URI` - MongoDB Atlas connection string
- `JWT_SECRET` - JWT token signing secret
- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `ADMIN_EMAILS` - Comma-separated admin email addresses
- `ADMIN_OPENROUTER_API_KEY` - OpenRouter API key for admin users
- `FRONTEND_URL` - Frontend URL for CORS configuration
- `ENCRYPTION_KEY` - AES-256 encryption key for API keys

## Deployment

### Frontend (GitHub Pages)

The frontend is deployed via GitHub Actions to GitHub Pages:

1. Push code to `main` branch
2. GitHub Actions builds the React app
3. Deploys to `https://username.github.io/ChatNote/`

See `.github/workflows/deploy.yml` for deployment configuration.

### Backend (Render)

The backend is deployed to Render:

1. Connect GitHub repository
2. Configure service (Root Directory: `backend`)
3. Set environment variables
4. Deploy automatically on push

See `backend/README.md` for detailed deployment instructions.

## Security

- **API Key Encryption**: User API keys are encrypted using AES-256-GCM before storage
- **JWT Authentication**: Secure token-based authentication
- **CORS Protection**: Restricted to configured frontend origins
- **Rate Limiting**: Prevents abuse with configurable limits
- **Input Validation**: All user inputs are validated
- **HTTPS Only**: All communications are encrypted

## Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  googleId: String (unique),
  email: String (unique),
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
- `POST /api/user/api-key` - Save/update user's API key (encrypted)
- `GET /api/user/api-key/status` - Check if user has API key

### Chat
- `POST /api/chat` - Proxy chat requests to OpenRouter (requires auth)

## Setup Guides

- **[MONGODB_ATLAS_SETUP.md](./MONGODB_ATLAS_SETUP.md)** - MongoDB Atlas database setup
- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete setup and deployment guide

## License

Copyright (c) 2025. All rights reserved.

This software and associated documentation files (the "Software") are the proprietary and confidential property of the owner. 

**No part of this Software may be:**
- Copied, modified, or distributed
- Used for any purpose without explicit written permission
- Reverse engineered or decompiled
- Used to create derivative works

Unauthorized use, reproduction, or distribution of this Software, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
