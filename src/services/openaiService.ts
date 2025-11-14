import { OPENROUTER_CONFIG, OPENAI_CONFIG } from '../config'
import { MODEL_INSTRUCTIONS } from '../prompts/modelInstructions'

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
 * Send a chat message to OpenRouter API (or OpenAI API as fallback)
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context?: string,
  onChunk?: (chunk: string) => void,
  model?: string
): Promise<string> {
  // Use OpenRouter if API key is configured, otherwise fall back to OpenAI
  const useOpenRouter = !!OPENROUTER_CONFIG.apiKey && OPENROUTER_CONFIG.apiKey !== ''
  const apiKey = useOpenRouter ? OPENROUTER_CONFIG.apiKey : OPENAI_CONFIG.apiKey
  const apiUrl = useOpenRouter 
    ? OPENROUTER_CONFIG.apiUrl 
    : 'https://api.openai.com/v1/chat/completions'
  const selectedModel = model || (useOpenRouter ? OPENROUTER_CONFIG.defaultModel : OPENAI_CONFIG.model)
  
  if (!apiKey) {
    throw new Error('API key is not configured. Please add your OpenRouter API key in config.ts or set VITE_OPENROUTER_API_KEY environment variable')
  }

  // Build system message with context if available
  let systemContent = MODEL_INSTRUCTIONS
  
  if (context) {
    systemContent = `${MODEL_INSTRUCTIONS}

## Current PDF Context

The user has selected the following text from their PDF document:
"${context}"

Use this context to provide relevant and accurate answers. If the context doesn't contain relevant information, you can still help with general questions.`
  }

  const systemMessages: ChatMessage[] = [
    {
      role: 'system',
      content: systemContent,
    },
  ]

  const allMessages = [...systemMessages, ...messages]

  try {
    const requestBody: any = {
      model: selectedModel,
      messages: allMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: useOpenRouter ? OPENROUTER_CONFIG.temperature : OPENAI_CONFIG.temperature,
      max_tokens: useOpenRouter ? OPENROUTER_CONFIG.maxTokens : OPENAI_CONFIG.maxTokens,
    }

    // Only add stream parameter if onChunk is provided
    if (onChunk) {
      requestBody.stream = true
    }

    // OpenRouter requires additional headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }

    if (useOpenRouter) {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'ChatNote - PDF Learning Assistant'
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      let errorMessage = `API request failed with status ${response.status}`
      
      // Handle specific status codes with user-friendly messages
      if (response.status === 429) {
        errorMessage = 'Rate limit exceeded. Please wait a moment before trying again. If you\'re using free models, you may have reached the daily limit.'
      } else if (response.status === 401) {
        errorMessage = 'Invalid API key. Please check your OpenRouter API key configuration.'
      } else if (response.status === 400) {
        errorMessage = 'Invalid request. Please check your input and try again.'
      } else if (response.status >= 500) {
        errorMessage = 'Server error. The API service may be temporarily unavailable. Please try again later.'
      }
      
      // Try to extract more detailed error message from response (but keep user-friendly messages for common errors)
      if (![429, 401, 400].includes(response.status)) {
        try {
          const errorData = await response.json()
          if (errorData.error?.message) {
            errorMessage = errorData.error.message
          } else if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch {
          // If JSON parsing fails, use the default message
        }
      }
      
      throw new Error(errorMessage)
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
        buffer = lines.pop() || '' // Keep incomplete line in buffer

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
              // Skip invalid JSON
              console.warn('Failed to parse streaming chunk:', e)
            }
          }
        }
      }

      // Process any remaining buffer
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
    console.error('OpenAI API Error:', error)
    throw error
  }
}

/**
 * Check if API is configured (OpenRouter or OpenAI)
 */
export function isOpenAIConfigured(): boolean {
  const hasOpenRouter = !!OPENROUTER_CONFIG.apiKey && OPENROUTER_CONFIG.apiKey !== ''
  const hasOpenAI = !!OPENAI_CONFIG.apiKey && OPENAI_CONFIG.apiKey !== 'your-api-key-here'
  return hasOpenRouter || hasOpenAI
}

