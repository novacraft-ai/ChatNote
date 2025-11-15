/**
 * Authenticated Chat Service
 * Uses backend proxy with JWT authentication
 */

import { BACKEND_URL } from '../config'

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
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

/**
 * Send a chat message via authenticated backend proxy
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context?: string,
  onChunk?: (chunk: string) => void,
  model?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication required. Please log in.')
  }

  try {
    const requestBody = {
      messages,
      context,
      model: model || 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 3000,
      stream: !!onChunk
    }

    let response: Response
    try {
      response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
        body: JSON.stringify(requestBody),
        signal: abortSignal
    })
    } catch (error) {
      // Handle abort error from fetch
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new DOMException('Request aborted by user', 'AbortError')
      }
      throw error
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      
      // Handle specific error cases
      if (response.status === 401) {
        localStorage.removeItem('auth_token')
        throw new Error('Session expired. Please log in again.')
      }
      
      if (response.status === 400 && error.error?.includes('API key not configured')) {
        throw new Error('API key not configured. Please add your OpenRouter API key in settings.')
      }
      
      throw new Error(error.error?.message || `API request failed with status ${response.status}`)
    }

    // Handle streaming response
    if (onChunk && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      while (true) {
        // Check if aborted
        if (abortSignal?.aborted) {
          reader.cancel()
          throw new DOMException('Request aborted by user', 'AbortError')
        }
        
        let done: boolean
        let value: Uint8Array | undefined
        try {
          const result = await reader.read()
          done = result.done
          value = result.value
        } catch (error) {
          // Handle abort during read
          if (error instanceof DOMException && error.name === 'AbortError') {
            reader.cancel()
            throw new DOMException('Request aborted by user', 'AbortError')
          }
          throw error
        }
        
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
    // Re-throw abort errors as-is
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    console.error('Chat service error:', error)
    throw error
  }
}

/**
 * Check if chat is configured (user is authenticated and has API key)
 */
export async function isChatConfigured(): Promise<boolean> {
  const token = getAuthToken()
  if (!token) return false

  try {
    const response = await fetch(`${BACKEND_URL}/api/user/api-key/status`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (response.ok) {
      const data = await response.json()
      return data.hasApiKey || data.isAdmin
    }
    return false
  } catch {
    return false
  }
}

