import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
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
  const [googleLoaded, setGoogleLoaded] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)

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
        } catch (error) {
          console.error('Failed to initialize Google OAuth:', error)
          setScriptError('Failed to initialize Google OAuth')
        }
      } else {
        console.error('Google script loaded but window.google is not available')
        setScriptError('Google script failed to load')
      }
    }

    script.onerror = () => {
      console.error('Failed to load Google Identity Services script')
      setScriptError('Failed to load Google Sign-In script')
      setGoogleLoaded(false)
    }

    // Add timeout to detect if script takes too long
    const timeout = setTimeout(() => {
      if (!window.google) {
        console.error('Google script loading timeout')
        setScriptError('Google Sign-In is taking too long to load')
        setGoogleLoaded(false)
      }
    }, 10000) // 10 second timeout

    document.head.appendChild(script)

    return () => {
      clearTimeout(timeout)
      // Don't remove script on cleanup as it might be used elsewhere
    }
  }, [handleCredentialResponse])

  // Remove fallback button when user logs in
  useEffect(() => {
    if (user) {
      const button = document.getElementById('google-signin-button')
      if (button) {
        button.remove()
      }
    }
  }, [user])

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
        // Suppress console errors for non-critical issues
        const originalConsoleError = console.error
        const originalConsoleWarn = console.warn
        
        // Temporarily suppress FedCM abort errors and 403 errors (they're non-critical)
        console.error = (...args: any[]) => {
          const message = args.join(' ')
          if (
            message.includes('AbortError') ||
            message.includes('signal is aborted') ||
            message.includes('FedCM get() rejects') ||
            message.includes('The request has been aborted') ||
            message.includes('403') ||
            message.includes('credential_button_library') ||
            message.includes('The given origin is not allowed') ||
            message.includes('GSI_LOGGER') ||
            (typeof args[0] === 'string' && args[0].includes('403'))
          ) {
            // Suppress these non-critical errors
            return
          }
          originalConsoleError.apply(console, args)
        }
        
        console.warn = (...args: any[]) => {
          const message = args.join(' ')
          if (
            message.includes('Cross-Origin-Opener-Policy') ||
            message.includes('window.postMessage') ||
            message.includes('GSI_LOGGER')
          ) {
            // Suppress these non-critical warnings
            return
          }
          originalConsoleWarn.apply(console, args)
        }
        
        // Also suppress network errors for Google button iframe
        const originalErrorHandler = window.onerror
        window.onerror = (message, source, lineno, colno, error) => {
          if (
            typeof message === 'string' && (
              message.includes('403') ||
              message.includes('credential_button_library') ||
              message.includes('accounts.google.com') ||
              source?.includes('accounts.google.com')
            )
          ) {
            return true // Suppress
          }
          if (originalErrorHandler) {
            return originalErrorHandler(message, source, lineno, colno, error)
          }
          return false
        }
        
        // Restore console after a delay
        setTimeout(() => {
          console.error = originalConsoleError
          console.warn = originalConsoleWarn
          window.onerror = originalErrorHandler
        }, 5000)
        
        // Use One Tap prompt with FedCM-compatible handlers
        window.google.accounts.id.prompt((notification: any) => {
          // FedCM-compatible: Check for getNotDisplayedReason() instead of isNotDisplayed()
          const notDisplayedReason = notification.getNotDisplayedReason?.()
          const skippedReason = notification.getSkippedReason?.()
          const dismissedReason = notification.getDismissedReason?.()
          
          // Legacy support: also check old methods for backward compatibility
          const isNotDisplayed = notification.isNotDisplayed?.()
          const isSkipped = notification.isSkippedMoment?.()
          const isDismissed = notification.isDismissedMoment?.()
          
          // If prompt is not displayed, skipped, or dismissed, show fallback button
          if (notDisplayedReason || skippedReason || dismissedReason || 
              isNotDisplayed || isSkipped || isDismissed) {
            // Fallback: create a popup button
            const existingButton = document.getElementById('google-signin-button')
            if (existingButton) {
              existingButton.remove()
            }
            
            const button = document.createElement('div')
            button.id = 'google-signin-button'
            button.style.position = 'fixed'
            button.style.top = '50%'
            button.style.left = '50%'
            button.style.transform = 'translate(-50%, -50%)'
            button.style.zIndex = '10000'
            button.style.background = 'white'
            button.style.padding = '20px'
            button.style.borderRadius = '8px'
            button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
            document.body.appendChild(button)
            
            try {
              window.google!.accounts.id.renderButton(button, {
                theme: 'outline',
                size: 'large',
                text: 'signin_with',
                width: 250
              })
            } catch (renderError) {
              // If button rendering fails (e.g., origin not allowed), show manual login
              console.warn('Could not render Google button, showing manual login option:', renderError)
              button.innerHTML = `
                <p style="margin: 0 0 10px 0; text-align: center;">Sign in with Google</p>
                <button onclick="window.location.href='https://accounts.google.com/signin'" 
                        style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                  Continue with Google
                </button>
                <button onclick="document.getElementById('google-signin-button').remove()" 
                        style="margin-top: 10px; padding: 5px 10px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                  Cancel
                </button>
              `
            }
          }
        })
      } catch (error) {
        console.error('Error showing Google sign-in:', error)
        // Fallback: directly trigger the credential flow
        try {
          window.google!.accounts.id.prompt()
        } catch (fallbackError) {
          console.error('Fallback prompt also failed:', fallbackError)
          alert('Failed to show Google Sign-In. Please try refreshing the page.')
        }
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
            <img src={user.picture} alt={user.name || user.email} />
          ) : (
            <span>{user.name?.[0] || user.email[0].toUpperCase()}</span>
          )}
        </div>
        <div className="user-details">
          <span className="user-name">{user.name || user.email}</span>
          {user.role === 'admin' && <span className="user-role">Admin</span>}
        </div>
        <button onClick={logout} className="logout-button" title="Logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    )
  }

  // Show error state if script failed to load
  if (scriptError && !googleLoaded) {
    return (
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
    )
  }

  return (
    <button 
      onClick={handleLogin} 
      className="login-button sign-in" 
      disabled={!googleLoaded && !scriptError}
      title={!googleLoaded ? 'Loading Google Sign-In...' : 'Sign in with Google'}
    >
      {googleLoaded ? (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
            <path d="M3 20a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v1H3v-1Z" />
          </svg>
          Sign in with Google
        </>
      ) : (
        <span>Loading Google Sign-In...</span>
      )}
    </button>
  )
}

