/**
 * OpenAI Service with Backend Proxy
 * 
 * This version uses a backend proxy to keep API keys secure.
 * Update the PROXY_URL to point to your backend/serverless function.
 */

const PROXY_URL = import.meta.env.VITE_API_PROXY_URL || '/api/chat'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Send a chat message via backend proxy
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context?: string,
  onChunk?: (chunk: string) => void,
  model?: string,
  temperature?: number,
  maxTokens?: number
): Promise<string> {
  try {
    const requestBody = {
      messages,
      context,
      model: model || 'gpt-3.5-turbo',
      temperature: temperature || 0.7,
      maxTokens: maxTokens || 3000,  // Increased default to reduce cut-off issues
      stream: !!onChunk,
    }

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      throw new Error(error.error?.message || `API request failed with status ${response.status}`)
    }

    // Handle streaming response
    if (onChunk && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine) continue

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content || ''
              if (content) {
                fullContent += content
                onChunk(content)
              }
            } catch (e) {
              console.warn('Failed to parse streaming chunk:', e)
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const trimmedLine = buffer.trim()
        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6)
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content || ''
              if (content) {
                fullContent += content
                onChunk(content)
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      return fullContent
    }

    // Handle non-streaming response
    const data: ChatCompletionResponse = await response.json()
    return data.choices[0]?.message?.content || 'No response from API'
  } catch (error) {
    console.error('OpenAI Proxy Error:', error)
    throw error
  }
}

/**
 * Check if proxy is configured
 */
export function isProxyConfigured(): boolean {
  return !!PROXY_URL && PROXY_URL !== '/api/chat' || !!import.meta.env.VITE_API_PROXY_URL
}

