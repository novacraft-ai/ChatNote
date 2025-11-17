# ChatNote

A modern web application that enables students to upload PDF documents, extract text selections, and interact with AI chatbots to enhance their understanding of course materials.

## Overview

ChatNote provides an interactive learning platform where students can:
- Upload and view PDF documents with advanced zoom and navigation controls
- Select and highlight text from PDFs
- Engage with multiple AI models through a contextual chat interface
- Store and manage their API keys securely through encrypted backend storage
- Authenticate via Google OAuth for a seamless experience

## Features

- **PDF Viewer**: Full-featured PDF viewer with zoom controls, page navigation, and text selection
- **AI Chat Interface**: Contextual chatbot that uses selected PDF text to provide relevant answers
- **Multiple AI Models**: Support for various AI models including GPT OSS, DeepSeek, Llama, Qwen, Gemma, etc.
- **Flexible Layouts**: Two layout modes - floating chat panel and split-screen view
- **Theme Support**: Light and dark theme with smooth transitions
- **Responsive Design**: Modern, mobile-friendly UI
- **Markdown Rendering**: Chat responses support Markdown and LaTeX math rendering
- **Secure Authentication**: Google OAuth with encrypted API key storage

## Deployment

### Frontend
Deployed via GitHub Actions to GitHub Pages. Push to `main` branch to trigger automatic deployment.

### Backend
Deployed to Render or Railway. See `backend/README.md` for details.

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
