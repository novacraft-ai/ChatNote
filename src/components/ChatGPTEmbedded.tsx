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
 * Preprocess markdown content to convert LaTeX wrapped in square brackets to proper math delimiters
 * Detects patterns like [\hat{y}...] and converts them to \[...\] for block math
 */
function preprocessMathContent(content: string): string {
  // Pattern to match LaTeX expressions wrapped in square brackets
  // This handles cases where LaTeX is wrapped in [ ] instead of proper math delimiters
  // Matches: [ followed by optional whitespace/newlines, content with LaTeX commands, optional whitespace/newlines, ]
  const latexInBracketsPattern = /\[\s*\n*\s*((?:[^[\]]*\\[a-zA-Z@]+[^[\]]*)+)\s*\n*\s*\]/g
  
  return content.replace(latexInBracketsPattern, (match, latexContent) => {
    // Check if it contains LaTeX commands (backslash followed by letters)
    // Common LaTeX commands: \hat, \pm, \text, \begin, \end, \frac, \sqrt, etc.
    const hasLatexCommands = /\\[a-zA-Z@]+/.test(latexContent)
    
    if (hasLatexCommands) {
      // Clean up the content:
      // - Trim leading/trailing whitespace
      // - Replace multiple consecutive newlines with single newline
      // - Preserve single newlines for multi-line LaTeX (like \begin{aligned}...\end{aligned})
      const cleaned = latexContent
        .trim()
        .replace(/\n\s*\n+/g, '\n')  // Multiple newlines -> single newline
        .replace(/^\s+|\s+$/gm, '')  // Trim each line
      
      // Convert to block math format \[...\]
      return `\\[${cleaned}\\]`
    }
    
    // If no LaTeX commands detected, return original (might be a regular link or reference)
    return match
  })
}

interface ChatGPTEmbeddedProps {
  selectedText: string
  onToggleLayout: () => void
  layout: 'floating' | 'split'
}

function ChatGPTEmbedded({ selectedText, onToggleLayout, layout }: ChatGPTEmbeddedProps) {
  const { theme } = useTheme()
  const { isAuthenticated, user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Array<ChatMessage & { id: string }>>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyMissing, setApiKeyMissing] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_OPENROUTER_MODEL)
  const [showModelSelector, setShowModelSelector] = useState(false)
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

    const userMessage: ChatMessage & { id: string } = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessageContent,
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
    const assistantMessage: ChatMessage & { id: string } = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
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

      await sendChatMessage(
        [...conversationHistory, userMessage],
        selectedText && !userInput ? selectedText : undefined,
        (chunk: string) => {
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
        selectedModel
      )
    } catch (error) {
      console.error('Error sending message:', error)
      setError(error instanceof Error ? error.message : 'Failed to send message')
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId))
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
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

        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
          >
            <div className="message-avatar">
              {message.role === 'user' ? (
                <div className="avatar-user">U</div>
              ) : (
                <div className="avatar-assistant">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
              )}
            </div>
            <div className="message-content-wrapper">
              <div className="message-content">
                {message.role === 'assistant' && isLoading && !message.content ? (
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
            </div>
          </div>
        ))}

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
              {/* Split layout: Disclaimer below model selector */}
              <div className={`footer-text-outer split-footer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
                <span className="footer-text">
                  AI responses may contain errors. Please verify important information.
                </span>
              </div>
            </>
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
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !selectedText) || isLoading || apiKeyMissing || !isAuthenticated}
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
            </div>
          </div>
          </div>
          
          {layout === 'floating' && (
            <div className={`footer-text-outer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
              <span className="footer-text">
                AI responses may contain errors. Please verify important information.
              </span>
            </div>
          )}
        </div>
  )
}

export default ChatGPTEmbedded

