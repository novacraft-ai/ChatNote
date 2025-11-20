/**
 * Authenticated Chat Service
 * Uses backend proxy with JWT authentication
 */

import { BACKEND_URL, AUTO_MODELS, REASONING_MODELS, ADVANCED_MODELS, isGPTOSSModel, isQwenModel } from '../config'

export type MessageContent = 
  | string 
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: MessageContent
}

export interface SearchResult {
  title: string
  url: string
  content: string
  score: number
}

export interface ExecutedTool {
  search_results?: {
    results: SearchResult[]
  }
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
      reasoning?: string  // Reasoning field for parsed format or GPT-OSS models
      executed_tools?: ExecutedTool[]  // Search results from web search tool
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface StreamingChunk {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning?: string  // Reasoning field in streaming
    }
  }>
}

/**
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

/**
 * Get fallback models for a given model
 */
function getFallbackModels(model: string): string[] {
  // Auto mode models
  if (AUTO_MODELS.includes(model as any)) {
    const index = AUTO_MODELS.indexOf(model as any)
    return AUTO_MODELS.slice(index)
  }
  
  // Reasoning mode models
  if (REASONING_MODELS.includes(model as any)) {
    const index = REASONING_MODELS.indexOf(model as any)
    return REASONING_MODELS.slice(index)
  }
  
  // Advanced mode models
  if (model === ADVANCED_MODELS.primary) {
    return [ADVANCED_MODELS.primary, ADVANCED_MODELS.fallback]
  }
  
  // Single model, no fallback
  return [model]
}

/**
 * Check if an error is retryable (rate limit, temporary server error, etc.)
 */
function isRetryableError(error: any, status: number): boolean {
  // Rate limit errors
  if (status === 429) return true
  
  // Server errors that might be temporary
  if (status >= 500 && status < 600) return true
  
  // Check error message for common retryable patterns
  const errorMessage = typeof error?.error === 'string' 
    ? error.error 
    : error?.error?.message || error?.message || ''
  
  // Common retryable error patterns
  const retryablePatterns = [
    'rate limit',
    'too many requests',
    'service unavailable',
    'internal server error',
    'bad gateway',
    'gateway timeout',
    'timeout'
  ]
  
  return retryablePatterns.some(pattern => 
    errorMessage.toLowerCase().includes(pattern)
  )
}

/**
 * Sanitize error messages to provide user-friendly messages without exposing provider details
 */
function sanitizeErrorMessage(error: any, status: number): string {
  // Handle specific status codes with user-friendly messages
  if (status === 429) {
    return 'Rate limit reached. Please wait a moment and try again.'
  }
  
  if (status === 401) {
    return 'Authentication failed. Please log in again.'
  }
  
  if (status === 400) {
    // Check for specific error types
    const errorMessage = typeof error?.error === 'string' 
      ? error.error 
      : error?.error?.message || error?.message || ''
    
    if (errorMessage.includes('API key not configured')) {
      return 'API key not configured. Please add your API key in settings.'
    }
    
    if (errorMessage.includes('model') || errorMessage.includes('invalid')) {
      return 'Invalid request. Please try again or select a different model.'
    }
    
    return 'Invalid request. Please check your input and try again.'
  }
  
  if (status === 403) {
    return 'Access denied. Please check your API key permissions.'
  }
  
  if (status === 404) {
    return 'Model not found. Please select a different model.'
  }
  
  if (status >= 500 && status < 600) {
    return 'Service temporarily unavailable. Please try again in a moment.'
  }
  
  // For other errors, provide a generic message
  const errorMessage = typeof error?.error === 'string' 
    ? error.error 
    : error?.error?.message || error?.message || ''
  
  console.error('API error details (not shown to user):', {
    status,
    message: errorMessage,
    error
  })
  
  // Generic user-friendly message
  return 'An error occurred while processing your request. Please try again.'
}

/**
 * Send a chat message via authenticated backend proxy
 * Supports automatic fallback for advanced models
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context?: string,
  onChunk?: (chunk: string) => void,
  model?: string,
  abortSignal?: AbortSignal,
  isReasoningMode?: boolean
): Promise<string> {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication required. Please log in.')
  }

  const targetModel = model || AUTO_MODELS[0]
  const modelsToTry = getFallbackModels(targetModel)
  const isReasoning = isReasoningMode || false

  let lastError: Error | null = null

  for (const tryModel of modelsToTry) {
    try {
      // Build request body with reasoning parameters for reasoning models
      const requestBody: any = {
        messages,
        context,
        model: tryModel,
        temperature: 0.7,
        maxTokens: 3000,
        stream: !!onChunk
      }

      // Add reasoning parameters for reasoning models
      // GPT-OSS models use include_reasoning (defaults to true, but we set it explicitly)
      // Qwen models use reasoning_format: 'parsed'
      // Note: reasoning_format and include_reasoning are mutually exclusive
      if (isReasoning && REASONING_MODELS.includes(tryModel as any)) {
        if (isGPTOSSModel(tryModel)) {
          // GPT-OSS models: use include_reasoning parameter
          requestBody.include_reasoning = true
        } else if (isQwenModel(tryModel)) {
          // Qwen models: use reasoning_format parameter
          requestBody.reasoning_format = 'parsed'
        }
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
        let error
        try {
          const errorText = await response.text()
          try {
            error = JSON.parse(errorText)
          } catch {
            error = { error: { message: errorText || 'Unknown error' } }
          }
        } catch {
          error = { error: { message: 'Unknown error' } }
        }
        
        // Handle specific error cases
        if (response.status === 401) {
          localStorage.removeItem('auth_token')
          throw new Error('Session expired. Please log in again.')
        }
        
        if (response.status === 400 && error.error?.message?.includes('API key not configured')) {
          throw new Error('API key not configured. Please add your Groq API key in settings.')
        }
        
        // Check if error is retryable and we have a fallback
        const retryable = isRetryableError(error, response.status)
        const hasFallback = modelsToTry.length > 1 && tryModel !== modelsToTry[modelsToTry.length - 1]
        
        if (retryable && hasFallback) {
          // Try fallback model
          // Store sanitized error message for fallback
          lastError = new Error(sanitizeErrorMessage(error, response.status))
          continue // Try next model
        }
        
        // Use sanitized error message instead of exposing provider details
        const errorMessage = sanitizeErrorMessage(error, response.status)
        console.error('Backend error response (details logged, user sees sanitized message):', error)
        throw new Error(errorMessage)
      }

      // Handle streaming response
      if (onChunk && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let fullReasoning = ''  // Accumulate reasoning from delta.reasoning
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
              const parsed: StreamingChunk = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta
              
              // Extract content
              if (delta?.content) {
                fullContent += delta.content
                onChunk(delta.content)
              }
              
              // Extract reasoning (for parsed format or GPT-OSS models)
              if (delta?.reasoning) {
                fullReasoning += delta.reasoning
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
              const parsed: StreamingChunk = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta
              
              if (delta?.content) {
                fullContent += delta.content
                onChunk(delta.content)
              }
              
              if (delta?.reasoning) {
                fullReasoning += delta.reasoning
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Return content with reasoning if available
      // We'll need to modify the return type to include reasoning
      // For now, we'll store it in a way that can be extracted
      if (fullReasoning) {
        // Store reasoning in a special format that can be extracted
        return `__REASONING_START__${fullReasoning}__REASONING_END__${fullContent}`
      }

      return fullContent
    }

      // Handle non-streaming response
      const data: ChatCompletionResponse = await response.json()
      const message = data.choices[0]?.message
      let content = message?.content || 'No response from API'
      const reasoning = message?.reasoning
      const executedTools = message?.executed_tools
      
      // Extract search results and format as sources
      // Only for Advanced mode models (groq/compound) that support web search
      let sourcesSection = ''
      if (executedTools && executedTools.length > 0) {
        const searchTool = executedTools.find(tool => tool.search_results)
        if (searchTool?.search_results?.results && searchTool.search_results.results.length > 0) {
          const results = searchTool.search_results.results
          sourcesSection = '\n\n---\n\n## Sources\n\n'
          results.forEach((result, index) => {
            // Format as markdown links with title and URL
            sourcesSection += `${index + 1}. [${result.title}](${result.url})\n`
          })
        }
      }
      
      // Append sources to content if they exist
      if (sourcesSection) {
        content = content + sourcesSection
      }
      
      // If reasoning exists, return it in a format that can be extracted
      if (reasoning) {
        return `__REASONING_START__${reasoning}__REASONING_END__${content}`
      }
      
      return content
    } catch (error) {
      // If this is the last model to try, throw the error
      if (tryModel === modelsToTry[modelsToTry.length - 1]) {
        // Re-throw abort errors as-is
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }
        // If we have a lastError from a previous attempt, use it
        if (lastError) {
          throw lastError
        }
        console.error('Chat service error:', error)
        throw error
      }
      // Otherwise, continue to next model
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  // If we get here, all models failed
  if (lastError) {
    throw lastError
  }
  throw new Error('Unable to process your request. Please try again later.')
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
    
    // If rate limited (429), don't treat as error - return current state
    // This prevents false warnings when rate limit is hit
    if (response.status === 429) {
      throw new Error('Rate limited')
    }
    
    return false
  } catch (error) {
    // Re-throw rate limit errors so they can be handled gracefully
    if (error instanceof Error && error.message === 'Rate limited') {
      throw error
    }
    return false
  }
}

