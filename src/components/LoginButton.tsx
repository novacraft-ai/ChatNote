import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSave } from '../contexts/SaveContext'
import { GOOGLE_CLIENT_ID } from '../config'
import './LoginButton.css'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void
          prompt: (callback?: (notification: any) => void) => void
          renderButton: (element: HTMLElement, config: any) => void
        }
      }
    }
  }
}

export default function LoginButton() {
  const { user, login, logout, loading: authLoading } = useAuth()
  const { hasUnsavedChanges, saveCurrentState, setIsSavingSession } = useSave()
  const [googleLoaded, setGoogleLoaded] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    // Check if there are unsaved changes
    if (hasUnsavedChanges) {
      const shouldSave = window.confirm(
        'You have unsaved changes to your PDF annotations and notes. Would you like to save them before logging out?'
      )
      
      if (shouldSave) {
        setLoggingOut(true)
        setIsSavingSession(true)
        try {
          await saveCurrentState()
          await logout()
        } catch (error) {
          console.error('Error saving or logging out:', error)
        } finally {
          setLoggingOut(false)
          setIsSavingSession(false)
        }
      } else {
        // User chose not to save, just logout
        await logout()
      }
    } else {
      // No unsaved changes, just logout
      if (window.confirm('Are you sure you want to log out?')) {
        await logout()
      }
    }
  }

  // Suppress expected Google OAuth console errors globally
  useEffect(() => {
    const originalError = console.error
    const originalWarn = console.warn

    console.error = (...args: any[]) => {
      const message = args.join(' ')
      // Suppress expected Google OAuth/FedCM errors
      if (
        message.includes('Not signed in with the identity provider') ||
        message.includes('AbortError') ||
        message.includes('signal is aborted') ||
        message.includes('FedCM get() rejects') ||
        message.includes('GSI_LOGGER') ||
        message.includes('Only one navigator.credentials.get request may be outstanding')
      ) {
        return // Suppress these expected errors
      }
      originalError.apply(console, args)
    }

    console.warn = (...args: any[]) => {
      const message = args.join(' ')
      if (
        message.includes('GSI_LOGGER') ||
        message.includes('Not signed in with the identity provider') ||
        message.includes('Only one navigator.credentials.get request may be outstanding')
      ) {
        return // Suppress these expected warnings
      }
      originalWarn.apply(console, args)
    }

    // Also suppress window.onerror for these messages
    const originalOnError = window.onerror
    window.onerror = (message, source, lineno, colno, error) => {
      if (
        typeof message === 'string' && (
          message.includes('Not signed in with the identity provider') ||
          message.includes('Only one navigator.credentials.get request may be outstanding') ||
          message.includes('AbortError') ||
          source?.includes('accounts.google.com')
        )
      ) {
        return true // Suppress
      }
      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error)
      }
      return false
    }

    return () => {
      console.error = originalError
      console.warn = originalWarn
      window.onerror = originalOnError
    }
  }, [])

  // Define callback before useEffect to avoid stale closure
  const handleCredentialResponse = useCallback(async (response: { credential: string }) => {
    try {
      await login(response.credential)
      // Remove the fallback button after successful login
      const button = document.getElementById('google-signin-button')
      if (button) {
        button.remove()
      }
    } catch (error) {
      console.error('Login failed:', error)
      alert(error instanceof Error ? error.message : 'Login failed. Please try again.')
    }
  }, [login])

  useEffect(() => {
    // Don't initialize if user is already logged in
    if (user) {
      return
    }

    // Check if GOOGLE_CLIENT_ID is configured
    if (!GOOGLE_CLIENT_ID) {
      console.warn('GOOGLE_CLIENT_ID is not configured. Please set VITE_GOOGLE_CLIENT_ID environment variable.')
      setScriptError('Google OAuth not configured')
      setGoogleLoaded(false)
      return
    }

    // If Google is already loaded, initialize it
    if (window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse
        })
        setGoogleLoaded(true)
        // Don't auto-prompt if user is already logged in
        // The prompt will be shown when user clicks the login button
      } catch (error) {
        console.error('Failed to initialize Google OAuth:', error)
        setScriptError('Failed to initialize Google OAuth')
      }
      return
    }

    // Load Google Identity Services script
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true

    script.onload = () => {
      if (window.google) {
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            // Opt-in to FedCM to reduce warnings
            use_fedcm_for_prompt: true
          })
          setGoogleLoaded(true)
          setScriptError(null) // Clear any previous errors
          // Don't auto-prompt if user is already logged in
          // The prompt will be shown when user clicks the login button
        } catch (error) {
          console.error('Failed to initialize Google OAuth:', error)
          setScriptError('Failed to initialize Google OAuth')
        }
      } else {
        console.error('Google script loaded but window.google is not available')
        setScriptError('Google script failed to load')
      }
    }

    script.onerror = (error) => {
      console.error('Failed to load Google Identity Services script:', error)
      setScriptError('Failed to load Google Sign-In script. Please check your internet connection and try again.')
      setGoogleLoaded(false)
    }

    // Add timeout to detect if script takes too long
    const timeout = setTimeout(() => {
      if (!window.google && !scriptError) {
        console.error('Google script loading timeout')
        setScriptError('Google Sign-In is taking too long to load. Please check your internet connection or try again later.')
        setGoogleLoaded(false)
      }
    }, 15000) // 15 second timeout (increased from 10s)

    document.head.appendChild(script)

    return () => {
      clearTimeout(timeout)
      // Don't remove script on cleanup as it might be used elsewhere
    }
  }, [handleCredentialResponse, user])

  // Remove fallback button and backdrop when user logs in
  useEffect(() => {
    if (user) {
      const backdrop = document.getElementById('google-login-backdrop')
      const button = document.getElementById('google-signin-button')
      if (backdrop) backdrop.remove()
      if (button) button.remove()
    }
  }, [user])

  const showFallbackButton = () => {
    // Remove any existing login popup
    const existingBackdrop = document.getElementById('google-login-backdrop')
    const existingButton = document.getElementById('google-signin-button')
    if (existingBackdrop) existingBackdrop.remove()
    if (existingButton) existingButton.remove()

    // Create backdrop (clickable overlay to close)
    const backdrop = document.createElement('div')
    backdrop.id = 'google-login-backdrop'
    backdrop.style.position = 'fixed'
    backdrop.style.top = '0'
    backdrop.style.left = '0'
    backdrop.style.width = '100%'
    backdrop.style.height = '100%'
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
    backdrop.style.zIndex = '9999'
    backdrop.style.display = 'flex'
    backdrop.style.alignItems = 'center'
    backdrop.style.justifyContent = 'center'

    // Close function
    const closeLogin = () => {
      backdrop.remove()
      button.remove()
      document.removeEventListener('keydown', escapeHandler)
    }

    // Click backdrop to close
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeLogin()
      }
    })

    // Escape key to close
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLogin()
      }
    }
    document.addEventListener('keydown', escapeHandler)

    // Create button container
    const button = document.createElement('div')
    button.id = 'google-signin-button'
    button.style.position = 'relative'
    button.style.background = 'white'
    button.style.padding = '20px'
    button.style.borderRadius = '8px'
    button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
    button.style.zIndex = '10000'

    // Prevent clicks on button from closing the popup
    button.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    backdrop.appendChild(button)
    document.body.appendChild(backdrop)

    try {
      window.google!.accounts.id.renderButton(button, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 250
      })
    } catch (renderError) {
      console.warn('Could not render Google button, showing manual login option:', renderError)
      button.innerHTML = `
                <p style="margin: 0 0 10px 0; text-align: center;">Sign in with Google</p>
                <button onclick="window.location.href='https://accounts.google.com/signin'" 
                        style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                  Continue with Google
                </button>
                <button onclick="document.getElementById('google-login-backdrop')?.remove(); document.getElementById('google-signin-button')?.remove();" 
                        style="margin-top: 10px; padding: 5px 10px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                  Cancel
                </button>
              `
      const cancelBtn = button.querySelector('button:last-child')
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          document.removeEventListener('keydown', escapeHandler)
        })
      }
    }
  }

  const handleLogin = () => {
    if (!GOOGLE_CLIENT_ID) {
      alert('Google OAuth is not configured. Please set VITE_GOOGLE_CLIENT_ID environment variable.')
      return
    }

    if (scriptError) {
      alert(`Google Sign-In error: ${scriptError}. Please check the browser console.`)
      return
    }

    if (window.google && googleLoaded) {
      try {
        // Try to show the One Tap prompt first
        window.google.accounts.id.prompt((notification: any) => {
          // Check if prompt was not displayed, skipped, or dismissed
          const notDisplayedReason = notification.getNotDisplayedReason?.()
          const skippedReason = notification.getSkippedReason?.()
          const dismissedReason = notification.getDismissedReason?.()
          const isNotDisplayed = notification.isNotDisplayed?.()
          const isSkipped = notification.isSkippedMoment?.()
          const isDismissed = notification.isDismissedMoment?.()

          // If prompt didn't show, immediately show fallback button
          if (notDisplayedReason || skippedReason || dismissedReason ||
            isNotDisplayed || isSkipped || isDismissed) {
            showFallbackButton()
          }
        })

        // Also show fallback button immediately as a backup
        // This ensures the user can always sign in on first click
        // The prompt might work, but if it doesn't, the button is already there
        setTimeout(() => {
          // Only show fallback if prompt didn't work (check if backdrop doesn't exist)
          if (!document.getElementById('google-login-backdrop')) {
            showFallbackButton()
          }
        }, 500)
      } catch (error) {
        console.error('Error showing Google sign-in:', error)
        // If prompt fails, show fallback button immediately
        showFallbackButton()
      }
    } else {
      alert('Google Sign-In is still loading. Please wait a moment and try again.')
    }
  }

  // Show loading only if auth is loading AND we don't have a user
  if (authLoading && !user) {
    return (
      <div className="login-button loading">
        <span>Loading...</span>
      </div>
    )
  }

  if (user) {
    return (
      <div className="login-button user-info">
        <div className="user-avatar">
          {user.picture ? (
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
                  const existingSpan = parent.querySelector('span')
                  if (existingSpan) {
                    existingSpan.remove()
                  }
                  // Add fallback
                  const fallback = document.createElement('span')
                  fallback.textContent = user.name?.[0] || user.email[0].toUpperCase()
                  parent.appendChild(fallback)
                }
              }}
            />
          ) : (
            <span>{user.name?.[0] || user.email[0].toUpperCase()}</span>
          )}
        </div>
        <div className="user-details">
          <span className="user-name">{user.name || user.email}</span>
          {user.role === 'admin' && <span className="user-role">Admin</span>}
        </div>
        <button
          onClick={handleLogout}
          className="logout-button"
          title={loggingOut ? 'Saving changes...' : 'Logout'}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </path>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          )}
        </button>
      </div>
    )
  }

  // Show error state if script failed to load
  if (scriptError && !googleLoaded) {
    return (
      <div className="login-button-group">
        <button
          onClick={handleLogin}
          className="login-button sign-in error"
          title={scriptError}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Sign in (Error)
        </button>
        <button
          onClick={() => {
            setScriptError(null)
            setGoogleLoaded(false)
            window.location.reload()
          }}
          className="login-button retry"
          title="Retry loading Google Sign-In"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Retry
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleLogin}
      className="login-button sign-in"
      disabled={!googleLoaded}
      title={!googleLoaded ? 'Loading Google Sign-In...' : 'Sign in with Google'}
    >
      {googleLoaded ? (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
            <path d="M3 20a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v1H3v-1Z" />
          </svg>
          <span>Sign in</span>
        </>
      ) : (
        <span>Loading Google Sign-In...</span>
      )}
    </button>
  )
}

