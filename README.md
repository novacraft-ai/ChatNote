# ChatNote

A web application for students to upload PDFs, make notes, and interact with an AI chatbot to help understand course materials.

## Features

- 📄 PDF upload and preview
- ✏️ Text selection and highlighting
- 💬 AI chatbot with context from selected text (multiple model support)
- 🔍 Zoom in/out functionality with fit-to-width and fit-to-height
- 📑 Page navigation
- 🎨 Modern, responsive UI with light/dark theme
- 🔄 Multiple layout modes (floating and split view)
- 🤖 Support for multiple AI models via OpenRouter API

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

## Configuration

### API Setup

This app uses **API-based AI models** via OpenRouter and OpenAI. You'll need to configure API keys to use the chatbot.

#### Option 1: OpenRouter (Recommended - Multiple Models)

1. Get your API key from [OpenRouter](https://openrouter.ai/keys)
2. Create a `.env` file in the root directory:
   ```
   VITE_OPENROUTER_API_KEY=your-openrouter-api-key-here
   ```

#### Option 2: OpenAI (Legacy Support)

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add to `.env` file:
   ```
   VITE_OPENAI_API_KEY=your-openai-api-key-here
   ```

⚠️ **Security Warning**: For production deployments, use a backend proxy to keep your API keys secure. See [BACKEND_PROXY_SETUP.md](./BACKEND_PROXY_SETUP.md) for details.

### Available Models

The app supports multiple models via OpenRouter:

- **GPT OSS** (OpenAI) - `openai/gpt-oss-120b`
- **DeepSeek R1** (DeepSeek) - `tngtech/deepseek-r1t2-chimera:free`
- **DeepSeek V3.1** (DeepSeek) - `deepseek/deepseek-chat-v3.1:free`
- **Llama 3.3** (Meta) - `meta-llama/llama-3.3-70b-instruct:free`
- **Qwen 3** (Qwen) - `qwen/qwen3-235b-a22b:free`

You can customize available models in `src/config.ts`:

```typescript
export const OPENROUTER_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS', provider: 'OpenAI' },
  // Add more models here
]
```

### Model Configuration

You can adjust model settings in `src/config.ts`:

```typescript
export const OPENROUTER_CONFIG = {
  apiKey: import.meta.env.VITE_OPENROUTER_API_KEY || '',
  defaultModel: 'openai/gpt-oss-120b',
  temperature: 0.7,      // 0-2, higher = more creative
  maxTokens: 3000,       // Maximum tokens in response
}
```

### Backend Proxy (Recommended for Production)

For production deployments, use a backend proxy to keep API keys secure. The app supports:

- **Vercel Serverless Functions** - See [BACKEND_PROXY_SETUP.md](./BACKEND_PROXY_SETUP.md)
- **Netlify Functions** - See [BACKEND_PROXY_SETUP.md](./BACKEND_PROXY_SETUP.md)
- **Custom Express Server** - See `api/chat.js` for example

### Deployment

#### GitHub Pages

1. Update the `base` path in `vite.config.ts` to match your repository name:
   ```typescript
   base: process.env.NODE_ENV === 'production' ? '/your-repo-name/' : '/',
   ```

2. Enable GitHub Pages in your repository settings:
   - Go to Settings → Pages
   - Source: GitHub Actions

3. Push to the `main` branch - the GitHub Action will automatically deploy

#### Vercel / Netlify

For serverless function support, deploy to Vercel or Netlify and configure environment variables in the dashboard.

## Project Structure

```
src/
├── components/
│   ├── NavBar.tsx              # Top navigation bar
│   ├── PDFViewer.tsx           # PDF upload and viewer component
│   └── ChatGPTEmbedded.tsx     # Chat interface component (API-based)
├── services/
│   ├── openaiService.ts        # OpenAI API service
│   ├── openaiServiceProxy.ts   # OpenAI API via backend proxy
│   ├── multiModelService.ts    # Multi-model routing service
│   ├── modelRouter.ts          # Model selection logic
│   └── webSearch.ts            # Web search integration
├── contexts/
│   └── ThemeContext.tsx        # Theme management (light/dark)
├── prompts/
│   └── model-instructions.md   # AI model instructions
├── App.tsx                     # Main app component
├── config.ts                   # Configuration (API keys, models)
└── main.tsx                    # Entry point
```

## Tech Stack

- **React 18** + **TypeScript** - Modern UI framework
- **Vite** - Fast build tool and dev server
- **react-pdf** (PDF.js) - PDF rendering and text extraction
- **react-markdown** + **KaTeX** - Markdown and LaTeX math rendering
- **OpenRouter API** - Access to multiple AI models
- **OpenAI API** - Legacy support for OpenAI models
- **Modern CSS** - Flexbox-based responsive layout with smooth transitions

## Usage

1. **Upload a PDF**: Click "Upload PDF" to select a PDF file
2. **Navigate pages**: Use Previous/Next buttons or page input
3. **Zoom controls**: 
   - Use zoom in/out buttons
   - Use "Fit to width" button to fit PDF width to window
   - Use "Fit to height" button to fit one page height to window
4. **Select text**: Click and drag to select text in the PDF
5. **Chat with AI**:
   - Selected text automatically provides context to the AI
   - Choose from multiple AI models in the model selector
   - Switch between floating and split layouts
   - Use "Use in Chat" button to quickly reference selected text
6. **Layout modes**:
   - **Floating**: Chat appears as a floating panel at the bottom
   - **Split**: PDF and chat appear side-by-side

## Setup Guides

- **[CHATGPT_SETUP.md](./CHATGPT_SETUP.md)** - Detailed OpenAI API setup instructions
- **[BACKEND_PROXY_SETUP.md](./BACKEND_PROXY_SETUP.md)** - Secure backend proxy setup for production

## License

MIT

