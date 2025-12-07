/**
 * API Configuration
 * This app uses API-based AI models via Groq and OpenAI
 */

// Groq API configuration for ChatGPT integration
// Get your API key from https://console.groq.com/keys
// ⚠️ SECURITY WARNING: Do NOT put your API key directly here if deploying publicly!
// See SECURITY_WARNING.md for details and use backend proxy instead.

// Model groups for different modes
// Vision models (used when image understanding is required)
export const VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct'
] as const

// Fast text models for lightweight answers
export const QUICK_MODELS = [
  'llama-3.3-70b-versatile'
] as const

// Auto mode cycles through vision first, then quick text
export const AUTO_MODELS = [
  ...VISION_MODELS,
  ...QUICK_MODELS
] as const

// Reasoning mode: Models that support native reasoning format
export const REASONING_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b'
] as const

// GPT-OSS models use include_reasoning parameter (not reasoning_format)
export const GPT_OSS_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
] as const

// Qwen models use reasoning_format parameter
export const QWEN_MODELS = [
  'qwen/qwen3-32b'
] as const

// Helper function to check if a model is GPT-OSS
export function isGPTOSSModel(model: string): boolean {
  return GPT_OSS_MODELS.includes(model as any)
}

// Helper function to check if a model is Qwen
export function isQwenModel(model: string): boolean {
  return QWEN_MODELS.includes(model as any)
}

// Classification models for smart routing (support structured outputs)
export const CLASSIFICATION_MODELS = [
  'moonshotai/kimi-k2-instruct-0905',
  'openai/gpt-oss-safeguard-20b'
] as const

// Default Groq model (first in AUTO_MODELS)
export const DEFAULT_GROQ_MODEL = AUTO_MODELS[0]

// Backend API URL (your Railway/Render backend URL)
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:3000'
export const API_PROXY_URL = `${BACKEND_URL}/api/chat`

// Google OAuth Client ID
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
