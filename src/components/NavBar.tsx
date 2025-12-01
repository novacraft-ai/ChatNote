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
  isGoogleDriveEligible?: boolean
}

function NavBar({ onOpenHistory, isSavingSession = false, currentMode, onResetMode, hasPdf = false, isGoogleDriveEligible = false }: NavBarProps) {
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
          {isGoogleDriveEligible && onOpenHistory && (
            <button
              className="history-toggle"
              onClick={onOpenHistory}
              title="PDF History"
              aria-label="Open PDF history"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <div className="navbar-title">
            {modeText && hasPdf && (
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
              {/* PDF history toggle moved to left side */}
              {/* Removed: PDF history toggle was here */}
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
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19.14 12.94
                       C19.18 12.64 19.2 12.32 19.2 12
                       C19.2 11.68 19.18 11.36 19.14 11.06
                       L20.74 9.88
                       C20.9 9.76 20.95 9.54 20.86 9.35
                       L19.26 6.35
                       C19.16 6.16 18.95 6.08 18.75 6.14
                       L16.82 6.76
                       C16.43 6.48 16.02 6.25 15.57 6.07
                       L15.3 4.06
                       C15.27 3.86 15.11 3.72 14.9 3.72
                       H9.1
                       C8.89 3.72 8.73 3.86 8.7 4.06
                       L8.43 6.07
                       C7.98 6.25 7.57 6.48 7.18 6.76
                       L5.25 6.14
                       C5.05 6.08 4.84 6.16 4.74 6.35
                       L3.14 9.35
                       C3.05 9.54 3.1 9.76 3.26 9.88
                       L4.86 11.06
                       C4.82 11.36 4.8 11.68 4.8 12
                       C4.8 12.32 4.82 12.64 4.86 12.94
                       L3.26 14.12
                       C3.1 14.24 3.05 14.46 3.14 14.65
                       L4.74 17.65
                       C4.84 17.84 5.05 17.92 5.25 17.86
                       L7.18 17.24
                       C7.57 17.52 7.98 17.75 8.43 17.93
                       L8.7 19.94
                       C8.73 20.14 8.89 20.28 9.1 20.28
                       H14.9
                       C15.11 20.28 15.27 20.14 15.3 19.94
                       L15.57 17.93
                       C16.02 17.75 16.43 17.52 16.82 17.24
                       L18.75 17.86
                       C18.95 17.92 19.16 17.84 19.26 17.65
                       L20.86 14.65
                       C20.95 14.46 20.9 14.24 20.74 14.12
                       L19.14 12.94Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
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
              {modeText && hasPdf && (
                <button
                  className="mobile-menu-item mobile-menu-mode"
                  onClick={() => {
                    onResetMode?.()
                    setShowMobileMenu(false)
                  }}
                  title="Change study mode"
                  aria-label="Change study mode"
                  type="button"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12h18" />
                    <polyline points="15 6 21 12 15 18" />
                  </svg>
                  <div className="mobile-mode-text">
                    <span className="mobile-mode-label">Mode</span>
                    <span className="mobile-mode-value">{modeText}</span>
                  </div>
                </button>
              )}
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
              {onOpenHistory && isGoogleDriveEligible && (
                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    onOpenHistory()
                    setShowMobileMenu(false)
                  }}
                  disabled={isSavingSession}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                  <span>PDF History</span>
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

