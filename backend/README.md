# ChatNote Backend API

Backend server for ChatNote application providing authentication, secure API key management, and chat proxy functionality.

## Overview

The ChatNote backend handles user authentication via Google OAuth, securely stores encrypted API keys, and proxies chat requests to Groq API. It provides role-based access control and includes security features like rate limiting and CORS protection.

## Features

- Google OAuth authentication with JWT tokens
- Encrypted API key storage
- Chat proxy to Groq API
- Two-stage content moderation chain (configurable):
  - Stage 1: Prompt Guard - Detects jailbreak attempts
  - Stage 2: Llama Guard - Detects harmful content
- Role-based access control (admin/user)
- Rate limiting and security protections

## Quick Start

1. Install dependencies: `npm install`
2. Configure environment variables (see `.env.example`)
3. Run development server: `npm run dev`
4. Server runs on `http://localhost:3000`

## Deployment

Deploy to Render or Railway by connecting your GitHub repository, setting the root directory to `backend`, and configuring the required environment variables.

## License

Copyright (c) 2025. All rights reserved.
