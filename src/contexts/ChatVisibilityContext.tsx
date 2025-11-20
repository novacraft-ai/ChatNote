import { createContext, useContext, useState, ReactNode, useEffect } from 'react'

interface ChatVisibilityContextType {
  isChatVisible: boolean
  toggleChatVisibility: () => void
  setChatVisible: (visible: boolean) => void
}

const ChatVisibilityContext = createContext<ChatVisibilityContextType | undefined>(undefined)

export function ChatVisibilityProvider({ children }: { children: ReactNode }) {
  // Get initial visibility from localStorage or default to true
  const [isChatVisible, setIsChatVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem('chatVisible')
    return saved !== null ? saved === 'true' : true
  })

  // Save to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('chatVisible', String(isChatVisible))
  }, [isChatVisible])

  const toggleChatVisibility = () => {
    setIsChatVisible((prev) => !prev)
  }

  const setChatVisible = (visible: boolean) => {
    setIsChatVisible(visible)
  }

  return (
    <ChatVisibilityContext.Provider value={{ isChatVisible, toggleChatVisibility, setChatVisible }}>
      {children}
    </ChatVisibilityContext.Provider>
  )
}

export function useChatVisibility() {
  const context = useContext(ChatVisibilityContext)
  if (context === undefined) {
    throw new Error('useChatVisibility must be used within a ChatVisibilityProvider')
  }
  return context
}

