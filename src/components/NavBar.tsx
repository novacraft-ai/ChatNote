import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { useChatVisibility } from '../contexts/ChatVisibilityContext'
import { useAuth } from '../contexts/AuthContext'
import LoginButton from './LoginButton'
import ApiKeySettings from './ApiKeySettings'
import uclaLogo from '../assets/ucla-logo.svg'
import './NavBar.css'

interface NavBarProps {
  onOpenHistory?: () => void
  isSavingSession?: boolean
  currentMode?: 'guide-me-learn' | 'quiz-me' | null
  onResetMode?: () => void
  hasPdf?: boolean
}

function NavBar({ onOpenHistory, isSavingSession = false, currentMode, onResetMode, hasPdf = false }: NavBarProps) {
  const { theme, toggleTheme } = useTheme()
  const { isChatVisible, toggleChatVisibility } = useChatVisibility()
  const { user } = useAuth()
  const [showSettings, setShowSettings] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const titleForRef = useRef<HTMLSpanElement>(null)
  const logoRef = useRef<HTMLImageElement>(null)

  // Check if user is from UCLA (g.ucla.edu domain)
  const isUCLAUser = user?.email?.endsWith('@g.ucla.edu') ?? false

  // Get mode display text
  const getModeText = () => {
    if (currentMode === 'quiz-me') return 'Quiz Mode'
    if (currentMode === 'guide-me-learn') return 'Learn Mode'
    return null
  }

  const modeText = getModeText()

  useEffect(() => {
    // Remove animation after 3 complete loops (4.5s * 3 = 13.5s)
    const timer = setTimeout(() => {
      if (titleTextRef.current) titleTextRef.current.classList.add('animation-complete')
      if (titleForRef.current) titleForRef.current.classList.add('animation-complete')
      if (logoRef.current) logoRef.current.classList.add('animation-complete')
    }, 13500)

    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      <nav className="navbar">
        <div className="navbar-content">
          {onOpenHistory && (
            <button
              className="history-toggle"
              onClick={onOpenHistory}
              title="PDF History"
              aria-label="Open PDF history"
              disabled={isSavingSession}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <div className="navbar-title">
            {modeText && (
              <>
                <button className="mode-indicator" onClick={onResetMode} title="Click to change mode">
                  <span className="mode-text">{modeText}</span>
                  <svg className="mode-change-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span className="mode-separator">•</span>
              </>
            )}
            <span ref={titleTextRef} className="title-text">ChatNote</span>
            {isUCLAUser && (
              <>
                <span ref={titleForRef} className="title-for">for</span>
                <img ref={logoRef} src={uclaLogo} alt="UCLA" className="ucla-logo" />
              </>
            )}
          </div>
          <div className="navbar-actions">
            <LoginButton />
            <div className="navbar-actions-desktop">
              {hasPdf && (
                <>
                  <button
                    className="history-toggle"
                    onClick={() => window.dispatchEvent(new CustomEvent('pdf-new-session'))}
                    title="New Session"
                    aria-label="New Session"
                    disabled={isSavingSession}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </button>
                  <button
                    className="history-toggle"
                    onClick={() => window.dispatchEvent(new CustomEvent('pdf-download'))}
                    title="Download"
                    aria-label="Download PDF"
                    disabled={isSavingSession}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </>
              )}
              <button 
                className="settings-toggle"
                onClick={() => setShowSettings(!showSettings)}
                title="Settings"
                aria-label="Settings"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
                </svg>
              </button>
              {hasPdf && (
              <button 
                className="chat-toggle"
                onClick={toggleChatVisibility}
                title={isChatVisible ? 'Hide chat' : 'Show chat'}
                aria-label={isChatVisible ? 'Hide chat' : 'Show chat'}
                disabled={isSavingSession}
              >
                {isChatVisible ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="9" y1="9" x2="15" y2="9" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2.5" />
                  </svg>
                )}
              </button>
              )}
              <button 
                className="theme-toggle"
                onClick={toggleTheme}
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                )}
              </button>
            </div>
            <button 
              className="mobile-menu-toggle"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              title="More options"
              aria-label="Toggle menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>
          </div>
          {showMobileMenu && (
            <div className="mobile-menu">
              <button 
                className="mobile-menu-item"
                onClick={() => {
                  setShowSettings(!showSettings)
                  setShowMobileMenu(false)
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
                </svg>
                <span>Settings</span>
              </button>
              {hasPdf && (
              <button 
                className="mobile-menu-item"
                onClick={() => {
                  toggleChatVisibility()
                  setShowMobileMenu(false)
                }}
                disabled={isSavingSession}
              >
                {isChatVisible ? (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <line x1="9" y1="9" x2="15" y2="9" />
                    </svg>
                    <span>Hide Chat</span>
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2.5" />
                    </svg>
                    <span>Show Chat</span>
                  </>
                )}
              </button>
              )}
              {hasPdf && (
                <>
                  <button
                    className="mobile-menu-item"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('pdf-new-session'))
                      setShowMobileMenu(false)
                    }}
                    disabled={isSavingSession}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    <span>New Session</span>
                  </button>
                  <button
                    className="mobile-menu-item"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('pdf-download'))
                      setShowMobileMenu(false)
                    }}
                    disabled={isSavingSession}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download</span>
                  </button>
                </>
              )}
              <button 
                className="mobile-menu-item"
                onClick={() => {
                  toggleTheme()
                  setShowMobileMenu(false)
                }}
              >
                {theme === 'light' ? (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    <span>Dark Mode</span>
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                    <span>Light Mode</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </nav>
      {showSettings && (
        <div className="settings-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h2>Settings</h2>
              <button 
                className="settings-modal-close"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="settings-modal-content">
              <ApiKeySettings />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default NavBar
export type { NavBarProps }

