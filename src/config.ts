/**
 * API Configuration
 * This app uses API-based AI models via OpenRouter and OpenAI
 */

// OpenRouter API configuration for ChatGPT integration
// Get your API key from https://openrouter.ai/keys
// ⚠️ SECURITY WARNING: Do NOT put your API key directly here if deploying publicly!
// See SECURITY_WARNING.md for details and use backend proxy instead.

// Available OpenRouter models for selection (OpenRouter format: provider/model:tag)
export const OPENROUTER_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS', provider: 'OpenAI' },
  { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'DeepSeek R1', provider: 'DeepSeek' },
  { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek V3.1', provider: 'DeepSeek' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3', provider: 'Meta' },
  { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen 3', provider: 'Qwen' },
] as const

// Note: If these model IDs don't work, check OpenRouter's model list at https://openrouter.ai/models
// and update the IDs accordingly. The format is typically: provider/model-name:tag

// Default OpenRouter model (first in the list)
export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id

// OpenRouter API configuration
export const OPENROUTER_CONFIG = {
  apiKey: import.meta.env.VITE_OPENROUTER_API_KEY || '', // ⚠️ EXPOSED IN FRONTEND - USE PROXY INSTEAD
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  defaultModel: DEFAULT_OPENROUTER_MODEL,
  temperature: 0.7,      // 0-2, higher = more creative
  maxTokens: 3000,      // Maximum tokens in response (increased to reduce cut-off issues, model is instructed to stay within limits)
}

// Legacy OpenAI config (for backward compatibility)
export const OPENAI_CONFIG = {
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  model: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 3000,  // Increased to reduce cut-off issues, model is instructed to stay within limits
}

// Backend API URL (your Railway/Render backend URL)
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'
export const API_PROXY_URL = `${BACKEND_URL}/api/chat`

// Google OAuth Client ID
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

