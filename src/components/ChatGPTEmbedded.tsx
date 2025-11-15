import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { sendChatMessage, isChatConfigured, type ChatMessage } from '../services/authenticatedChatService'
import { OPENROUTER_MODELS, DEFAULT_OPENROUTER_MODEL } from '../config'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './ChatGPTEmbedded.css'

/**
 * Clean up excessive newlines and normalize spacing in markdown content
 */
function cleanupMarkdownContent(content: string): string {
  if (!content) return content
  
  // Step 1: Remove newlines that appear right after a bullet point (before content)
  // Pattern: bullet point, optional space, newline(s), then text (not another bullet or blank line)
  let cleaned = content.replace(/^([-*+])\s*\n+(?=\S)/gm, '$1 ')
  
  // Step 2: Normalize multiple consecutive newlines (3+ newlines -> 2 newlines for paragraph breaks)
  // But preserve single newlines within paragraphs and double newlines for paragraph breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  
  // Step 3: Clean up newlines around list items - ensure single newline between list items
  // Pattern: list item content, then 2+ newlines, then another list item
  cleaned = cleaned.replace(/([-*+]\s+[^\n]+)\n{2,}([-*+])/g, '$1\n$2')
  
  // Step 4: Remove trailing whitespace from each line
  cleaned = cleaned.replace(/[ \t]+$/gm, '')
  
  // Step 5: Normalize spacing around headings - ensure single newline before headings
  cleaned = cleaned.replace(/\n{2,}(#{1,6}\s+)/g, '\n\n$1')
  
  // Step 6: Fix cases where bullet point is on its own line followed by content on next line
  // Pattern: bullet point on line, newline, then content
  cleaned = cleaned.replace(/^([-*+])\s*\n+([^\n-*+\s])/gm, '$1 $2')
  
  return cleaned
}

/**
 * Preprocess markdown content to convert LaTeX wrapped in square brackets to proper math delimiters
 * Detects patterns like [\hat{y}...] and converts them to \[...\] for block math
 */
function preprocessMathContent(content: string): string {
  // First clean up excessive newlines
  let cleaned = cleanupMarkdownContent(content)
  
  // Pattern to match LaTeX expressions wrapped in square brackets
  // This handles cases where LaTeX is wrapped in [ ] instead of proper math delimiters
  // Matches: [ followed by optional whitespace/newlines, content with LaTeX commands, optional whitespace/newlines, ]
  const latexInBracketsPattern = /\[\s*\n*\s*((?:[^[\]]*\\[a-zA-Z@]+[^[\]]*)+)\s*\n*\s*\]/g
  
  return cleaned.replace(latexInBracketsPattern, (match, latexContent) => {
    // Check if it contains LaTeX commands (backslash followed by letters)
    // Common LaTeX commands: \hat, \pm, \text, \begin, \end, \frac, \sqrt, etc.
    const hasLatexCommands = /\\[a-zA-Z@]+/.test(latexContent)
    
    if (hasLatexCommands) {
      // Clean up the content:
      // - Trim leading/trailing whitespace
      // - Replace multiple consecutive newlines with single newline
      // - Preserve single newlines for multi-line LaTeX (like \begin{aligned}...\end{aligned})
      const cleanedLatex = latexContent
        .trim()
        .replace(/\n\s*\n+/g, '\n')  // Multiple newlines -> single newline
        .replace(/^\s+|\s+$/gm, '')  // Trim each line
      
      // Convert to block math format \[...\]
      return `\\[${cleanedLatex}\\]`
    }
    
    // If no LaTeX commands detected, return original (might be a regular link or reference)
    return match
  })
}

interface ChatGPTEmbeddedProps {
  selectedText: string
  pdfText: string
  isExtractingText: boolean
  onToggleLayout: () => void
  layout: 'floating' | 'split'
  currentPageNumber?: number
  onCreateKnowledgeNote?: (content: string, linkedText: string | undefined, pageNumber: number | undefined, messageId: string) => void
}

function ChatGPTEmbedded({ selectedText, pdfText, isExtractingText, onToggleLayout, layout, currentPageNumber, onCreateKnowledgeNote }: ChatGPTEmbeddedProps) {
  const { theme } = useTheme()
  const { isAuthenticated, user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Array<ChatMessage & { id: string; selectedTextAtSend?: string }>>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyMissing, setApiKeyMissing] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_OPENROUTER_MODEL)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [usePdfContext, setUsePdfContext] = useState<boolean>(true) // Default to enabled when PDF is available
  const [responseMode, setResponseMode] = useState<'quick' | 'thinking'>('quick') // Response mode: quick or thinking
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ width: number } | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const adjustTextareaHeight = () => {
    const textarea = inputRef.current
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto'
      // Calculate the new height based on content, with min and max constraints
      const minHeight = 24 // Minimum height for one line (line-height * 1)
      const maxHeight = 200 // Maximum height before scrolling (matches CSS max-height)
      const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
      textarea.style.height = `${newHeight}px`
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
    adjustTextareaHeight()
  }, [])

  // Auto-resize textarea when input changes
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated before measuring
    const timeoutId = setTimeout(() => {
      adjustTextareaHeight()
    }, 0)
    return () => clearTimeout(timeoutId)
  }, [input])

  useEffect(() => {
    const checkApiKey = async () => {
      if (isAuthenticated) {
        const configured = await isChatConfigured()
        setApiKeyMissing(!configured)
      } else {
        setApiKeyMissing(true)
      }
    }
    checkApiKey()
  }, [isAuthenticated, user])

  // Auto-unfold chat history when in split layout
  useEffect(() => {
    if (layout === 'split') {
      setIsCollapsed(false)
    }
  }, [layout])

  // Auto-enable PDF context when PDF text becomes available
  useEffect(() => {
    if (pdfText && pdfText.trim().length > 0) {
      setUsePdfContext(true)
    }
  }, [pdfText])

  useEffect(() => {
    if (!showModelSelector) {
      setDropdownPosition(null)
      return
    }

    const updatePosition = () => {
      if (modelSelectorRef.current) {
        const rect = modelSelectorRef.current.getBoundingClientRect()
        const width = Math.max(rect.width, 220)
        setDropdownPosition({ width })
      }
    }

    updatePosition()
    const timeout1 = setTimeout(updatePosition, 10)
    const rafId = requestAnimationFrame(updatePosition)
    const timeout2 = setTimeout(updatePosition, 50)

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      clearTimeout(timeout1)
      clearTimeout(timeout2)
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [showModelSelector])

  useEffect(() => {
    if (!showModelSelector) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        modelSelectorRef.current &&
        dropdownRef.current &&
        !modelSelectorRef.current.contains(target) &&
        !dropdownRef.current.contains(target)
      ) {
        setShowModelSelector(false)
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showModelSelector])

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId)
    setShowModelSelector(false)
  }

  const getSelectedModelName = () => {
    if (apiKeyMissing) {
      return 'Select Model'
    }
    const model = OPENROUTER_MODELS.find(m => m.id === selectedModel)
    return model ? model.name : 'Select Model'
  }

  const handleSend = async () => {
    const userInput = input.trim()
    if (!userInput && !selectedText) return
    
    if (!isAuthenticated) {
      setError('Please sign in to use the chat feature.')
      return
    }
    
    if (apiKeyMissing) {
      setError('Please configure your OpenRouter API key in Settings.')
      return
    }

    if (isCollapsed) {
      setIsCollapsed(false)
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    let userMessageContent = userInput
    if (selectedText && !userInput) {
      userMessageContent = `Tell me about this: ${selectedText}`
    } else if (selectedText && userInput) {
      userMessageContent = `${userInput}\n\nContext from PDF: ${selectedText}`
    }

    // Determine context to send: prioritize selected text, then PDF text if enabled
    let contextToSend: string | undefined
    if (selectedText && !userInput) {
      contextToSend = selectedText
    } else if (usePdfContext && pdfText && pdfText.trim().length > 0) {
      contextToSend = pdfText
    } else if (selectedText && userInput) {
      contextToSend = selectedText
    }

    const userMessage: ChatMessage & { id: string; selectedTextAtSend?: string } = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessageContent,
      selectedTextAtSend: selectedText || undefined, // Store the selected text at the time of sending
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    // Reset textarea height after clearing input
    setTimeout(() => {
      adjustTextareaHeight()
    }, 0)
    setIsLoading(true)
    setError(null)

    const assistantMessageId = (Date.now() + 1).toString()
    // Find the selected text from the user message that triggered this response
    const userMessageSelectedText = userMessage.selectedTextAtSend
    const assistantMessage: ChatMessage & { id: string; selectedTextAtSend?: string } = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      selectedTextAtSend: userMessageSelectedText, // Inherit the selected text from the user's message
    }
    setMessages((prev) => [...prev, assistantMessage])

    try {
      const conversationHistory: ChatMessage[] = messages
        .slice(-10)
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }))

      let fullResponse = ''

      // Add mode-specific instructions to the user message
      let finalUserMessage = { ...userMessage }
      if (responseMode === 'quick') {
        finalUserMessage.content = `${userMessageContent}\n\n[IMPORTANT: Please provide a concise and direct response. Be brief and to the point, avoiding unnecessary elaboration.]`
      } else if (responseMode === 'thinking') {
        finalUserMessage.content = `${userMessageContent}\n\n[IMPORTANT: Please think step by step. Show your reasoning process, break down the problem, and explain your thought process before providing the final answer.]`
      }

      const messagePromise = sendChatMessage(
        [...conversationHistory, finalUserMessage],
        contextToSend,
        (chunk: string) => {
          // Check if aborted before processing chunk
          if (abortControllerRef.current?.signal.aborted) {
            return
          }
          fullResponse += chunk
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: fullResponse }
                : msg
            )
          )
          scrollToBottom()
        },
        selectedModel,
        abortControllerRef.current?.signal
      )

      // Handle the promise to prevent unhandled rejections
      messagePromise.catch((error) => {
        // Silently handle abort errors - they're expected when user pauses
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Keep the partial response, just stop loading
          return
        }
        // Re-throw other errors to be handled by the outer catch
        throw error
      })

      await messagePromise
    } catch (error) {
      // Don't show error if it was aborted by user
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Keep the partial response, just stop loading
      } else {
      console.error('Error sending message:', error)
      setError(error instanceof Error ? error.message : 'Failed to send message')
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId))
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
      inputRef.current?.focus()
    }
  }

  const handlePause = () => {
    if (abortControllerRef.current) {
      // Abort the request - this will cause the promise to reject with AbortError
      // The error is already handled in the catch block of handleSend
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleUseSelectedText = () => {
    if (selectedText) {
      setInput(`Tell me about this: ${selectedText}`)
      inputRef.current?.focus()
    }
  }

  const handleClearChat = () => {
    setMessages([])
    setError(null)
  }

  return (
    <div className="chatgpt-wrapper">
      {!authLoading && !isAuthenticated && layout === 'floating' && (
        <div className="api-key-warning-outer">
          <span>🔐 Please sign in to use the chat feature</span>
          <span className="warning-hint">
            Click "Sign in with Google" in the navigation bar
          </span>
        </div>
      )}
      {!authLoading && isAuthenticated && apiKeyMissing && layout === 'floating' && (
        <div className="api-key-warning-outer">
          <span>⚠️ OpenRouter API key not configured</span>
          <span className="warning-hint">
            {user?.role === 'admin' 
              ? 'Admin API key not configured on server'
              : 'Add your API key in Settings (click the gear icon)'}
          </span>
        </div>
      )}
      
      {layout === 'floating' && (
        <div className={`model-selector-bar ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
        <div className="model-selector-wrapper" ref={modelSelectorRef}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const newState = !showModelSelector
              setShowModelSelector(newState)
              if (!newState) {
                setDropdownPosition(null)
              }
            }}
            className="model-selector-button"
            title="Select AI model"
            disabled={apiKeyMissing}
          >
            <span className="model-selector-text">{getSelectedModelName()}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ 
                transform: showModelSelector ? 'rotate(180deg)' : 'rotate(0deg)', 
                transition: 'transform 0.3s' 
              }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showModelSelector && (
            <div 
              ref={dropdownRef}
              className="model-selector-dropdown"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={dropdownPosition ? {
                width: `${dropdownPosition.width}px`,
              } : undefined}
            >
              {OPENROUTER_MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleModelSelect(model.id)
                  }}
                  className={`model-option ${selectedModel === model.id ? 'selected' : ''}`}
                >
                  <div className="model-option-content">
                    <span className="model-option-name">{model.name}</span>
                    <span className="model-option-provider">{model.provider}</span>
                  </div>
                  {selectedModel === model.id && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setResponseMode(prev => prev === 'quick' ? 'thinking' : 'quick')
            }}
            className="response-mode-button"
            title={responseMode === 'quick' ? 'Switch to thinking mode' : 'Switch to quick mode'}
            disabled={apiKeyMissing}
          >
            <span className="response-mode-text">
              {responseMode === 'quick' ? '⚡ Quick' : '🧠 Thinking'}
            </span>
          </button>
        </div>
        <div className="header-actions">
        {messages.length > 0 && (
          <button onClick={handleClearChat} className="clear-button" title="Clear chat">
            Clear
          </button>
        )}
          {layout === 'floating' && (
            <>
        <button
          onClick={onToggleLayout}
          className="layout-toggle-button"
          title={layout === 'floating' ? 'Switch to split layout' : 'Switch to floating layout'}
          aria-label={layout === 'floating' ? 'Switch to split layout' : 'Switch to floating layout'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {layout === 'floating' ? (
              <>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <line x1="10" y1="3" x2="10" y2="10" />
                <line x1="3" y1="10" x2="10" y2="10" />
              </>
            ) : (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </>
            )}
          </svg>
        </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="collapse-button"
            title={isCollapsed ? 'Expand chat' : 'Collapse chat'}
            aria-label={isCollapsed ? 'Expand chat' : 'Collapse chat'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
            </>
        )}
        </div>
      </div>
      )}

      <div className={`chatgpt-inner ${theme === 'dark' ? 'theme-dark' : 'theme-light'} ${isCollapsed && layout === 'floating' ? 'collapsed' : ''}`}>
        {selectedText && (
          <div className="selected-text-banner">
            <span className="banner-text">Selected text available</span>
            <button onClick={handleUseSelectedText} className="use-text-button">
              Use in chat
            </button>
          </div>
        )}

      {(!isCollapsed || layout === 'split') && (
        <div className="chatgpt-messages">
          {messages.length === 0 && (
            <div className="welcome-screen">
              <div className="welcome-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
                    fill="#10a37f"
                    opacity="0.1"
                  />
                  <path
                    d="M6 9H18M6 13H14"
                    stroke="#10a37f"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3>How can I help you today?</h3>
              <p>Ask me anything about your PDF, or select text to get context-specific answers.</p>
            </div>
          )}

        {messages.map((message, index) => {
          // Check if this is the last assistant message
          const isLastAssistantMessage = message.role === 'assistant' && 
            index === messages.length - 1
          
          return (
          <div
            key={message.id}
            className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
          >
            <div className="message-avatar">
              {message.role === 'user' ? (
                <div className="avatar-user">
                  {user?.picture ? (
                    <img 
                      src={user.picture} 
                      alt={user.name || user.email}
                      crossOrigin="anonymous"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        // If image fails to load, show fallback
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        const parent = target.parentElement
                        if (parent) {
                          // Remove any existing span
                          const existingSpan = parent.querySelector('span.avatar-fallback')
                          if (existingSpan) {
                            existingSpan.remove()
                          }
                          // Add fallback
                          const fallback = document.createElement('span')
                          fallback.className = 'avatar-fallback'
                          fallback.textContent = user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()
                          parent.appendChild(fallback)
                        }
                      }}
                    />
                  ) : (
                    <span className="avatar-fallback">
                      {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  )}
                </div>
              ) : (
                <div className="avatar-assistant">
                  <img 
                    src="/chatnote-icon.svg" 
                    alt="ChatNote"
                    className="assistant-avatar-img"
                    onError={(e) => {
                      // If image fails to load, show fallback SVG
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      const parent = target.parentElement
                      if (parent) {
                        // Remove any existing fallback
                        const existingFallback = parent.querySelector('svg.avatar-fallback-svg')
                        if (existingFallback) {
                          existingFallback.remove()
                        }
                        // Add fallback SVG
                        const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
                        fallback.setAttribute('width', '32')
                        fallback.setAttribute('height', '32')
                        fallback.setAttribute('viewBox', '0 0 24 24')
                        fallback.setAttribute('fill', 'none')
                        fallback.setAttribute('class', 'avatar-fallback-svg')
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                        path.setAttribute('d', 'M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z')
                        path.setAttribute('fill', 'currentColor')
                        fallback.appendChild(path)
                        parent.appendChild(fallback)
                      }
                    }}
                  />
                </div>
              )}
            </div>
            <div className="message-content-wrapper">
              <div className="message-content">
                {message.role === 'assistant' && isLoading && !message.content && isLastAssistantMessage ? (
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : message.role === 'assistant' && message.content ? (
                  <div className="markdown-content">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        table: ({ children, ...props }) => (
                          <div className="table-scroll-wrapper">
                            <table {...props}>{children}</table>
                          </div>
                        ),
                        // Wrap math blocks in scrollable containers
                        div: ({ children, className, ...props }) => {
                          // Check if this is a math block (KaTeX renders block math in divs with katex-display)
                          if (className && (className.includes('katex-display') || className.includes('math-display'))) {
                            return (
                              <div className={`math-scroll-wrapper ${className}`} {...props}>
                                {children}
                              </div>
                            )
                          }
                          return <div {...props} className={className}>{children}</div>
                        },
                        // Ensure pre/code blocks can scroll (they already have overflow-x: auto, but let's make sure)
                        pre: ({ children, ...props }) => (
                          <pre className="code-scroll-wrapper" {...props}>
                            {children}
                          </pre>
                        ),
                      }}
                    >
                      {preprocessMathContent(message.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="markdown-content">{message.content}</div>
                )}
              </div>
              {message.role === 'assistant' && message.content && (
                <div className="message-actions">
                  <button
                    className="message-action-button copy-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(message.content)
                        // You could add a toast notification here
                      } catch (err) {
                        console.error('Failed to copy:', err)
                      }
                    }}
                    title="Copy to clipboard"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </button>
                  <button
                    className="message-action-button knowledge-note-button"
                    onClick={() => {
                      if (onCreateKnowledgeNote) {
                        // Use the selected text that was stored when the message was sent,
                        // not the current selectedText prop which might have changed
                        const linkedText = message.selectedTextAtSend || selectedText || undefined
                        onCreateKnowledgeNote(
                          message.content,
                          linkedText,
                          currentPageNumber,
                          message.id
                        )
                      }
                    }}
                    title="Create knowledge note"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    Save Note
                  </button>
            </div>
              )}
          </div>
          </div>
        )})}

        {error && (
          <div className="error-message">
            <div className="error-icon">⚠️</div>
            <div className="error-text">{error}</div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>
      )}

          {/* Split layout: Warning bar above model selector */}
          {!authLoading && !isAuthenticated && layout === 'split' && (
            <div className="api-key-warning-split-top">
              <span>🔐 Please sign in to use the chat feature</span>
              <span className="warning-hint">
                Click "Sign in with Google" in the navigation bar
              </span>
            </div>
          )}
          {!authLoading && isAuthenticated && apiKeyMissing && layout === 'split' && (
            <div className="api-key-warning-split-top">
              <span>⚠️ OpenRouter API key not configured</span>
              <span className="warning-hint">
                {user?.role === 'admin' 
                  ? 'Admin API key not configured on server'
                  : 'Add your API key in Settings (click the gear icon)'}
              </span>
            </div>
          )}

          {/* Split layout: Model selector bar above input */}
          {layout === 'split' && (
            <>
              <div className={`model-selector-bar ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
                <div className="model-selector-wrapper" ref={modelSelectorRef}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const newState = !showModelSelector
                      setShowModelSelector(newState)
                      if (!newState) {
                        setDropdownPosition(null)
                      }
                    }}
                    className="model-selector-button"
                    title="Select AI model"
                    disabled={apiKeyMissing || !isAuthenticated}
                  >
                    <span className="model-selector-text">{getSelectedModelName()}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ 
                        transform: showModelSelector ? 'rotate(180deg)' : 'rotate(0deg)', 
                        transition: 'transform 0.3s' 
                      }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {showModelSelector && (
                    <div 
                      ref={dropdownRef}
                      className="model-selector-dropdown"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={dropdownPosition ? {
                        width: `${dropdownPosition.width}px`,
                      } : undefined}
                    >
                      {OPENROUTER_MODELS.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleModelSelect(model.id)
                          }}
                          className={`model-option ${selectedModel === model.id ? 'selected' : ''}`}
                        >
                          <div className="model-option-content">
                            <span className="model-option-name">{model.name}</span>
                            <span className="model-option-provider">{model.provider}</span>
                          </div>
                          {selectedModel === model.id && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setResponseMode(prev => prev === 'quick' ? 'thinking' : 'quick')
                    }}
                    className="response-mode-button"
                    title={responseMode === 'quick' ? 'Switch to thinking mode' : 'Switch to quick mode'}
                    disabled={apiKeyMissing || !isAuthenticated}
                  >
                    <span className="response-mode-text">
                      {responseMode === 'quick' ? '⚡ Quick' : '🧠 Thinking'}
                    </span>
                  </button>
                </div>
                {messages.length > 0 && (
                  <button onClick={handleClearChat} className="clear-button" title="Clear chat">
                    Clear
                  </button>
                )}
                <button
                  onClick={onToggleLayout}
                  className="layout-toggle-button"
                  title="Switch to floating layout"
                  aria-label="Switch to floating layout"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <line x1="10" y1="3" x2="10" y2="10" />
                    <line x1="3" y1="10" x2="10" y2="10" />
                  </svg>
                </button>
              </div>
            </>
          )}

          {/* PDF Context Toggle - positioned just above input */}
          {pdfText && pdfText.trim().length > 0 && (
            <div className={`pdf-context-toggle-container ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
              <button
                type="button"
                onClick={() => setUsePdfContext(!usePdfContext)}
                className={`pdf-context-toggle ${usePdfContext ? 'active' : ''}`}
                title={usePdfContext ? 'PDF context is enabled. Click to disable.' : 'PDF context is disabled. Click to enable.'}
              >
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span className="pdf-context-toggle-text">
                  {usePdfContext ? 'Using PDF context' : 'PDF context off'}
                </span>
                {isExtractingText && (
                  <span className="pdf-context-extracting">Extracting...</span>
                )}
              </button>
              </div>
          )}

          <div className="chatgpt-input-container">
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask a question..."
                rows={1}
                className="chatgpt-input"
                disabled={isLoading || apiKeyMissing || !isAuthenticated}
              />
              {isLoading ? (
                <button
                  onClick={handlePause}
                  className="send-button pause-button"
                  title="Pause/Stop response"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
                    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
                  </svg>
                </button>
              ) : (
              <button
                onClick={handleSend}
                  disabled={(!input.trim() && !selectedText) || apiKeyMissing || !isAuthenticated}
                className="send-button"
                title="Send message"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              )}
            </div>
          </div>

          {/* Disclaimer - positioned below input bar */}
          {layout === 'split' && (
            <div className={`footer-text-outer split-footer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
              <span className="footer-text">
                AI responses may contain errors. Please verify important information.
              </span>
          </div>
          )}
          
          {layout === 'floating' && (
            <div className={`footer-text-outer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
              <span className="footer-text">
                AI responses may contain errors. Please verify important information.
              </span>
            </div>
          )}
          </div>
        </div>
  )
}

export default ChatGPTEmbedded

