import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { BACKEND_URL } from '../config'

export interface User {
  id: string
  email: string
  name?: string
  picture?: string
  role: 'admin' | 'user'
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (credential: string) => Promise<void>
  logout: () => Promise<void>
  isAuthenticated: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Load user from token on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      fetchUser(token)
    } else {
      setLoading(false)
    }
  }, [])

  const fetchUser = async (token: string, retryCount = 0) => {
    const MAX_RETRIES = 2
    let shouldSetLoading = false

    try {
      // Add timeout to prevent hanging
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        shouldSetLoading = true
      } else if (response.status === 401 || response.status === 403) {
        // Only remove token if it's actually invalid (401/403)
        // This means the token is expired or invalid
        console.warn('Token invalid, logging out')
        localStorage.removeItem('auth_token')
        setUser(null)
        shouldSetLoading = true
      } else {
        // Other errors (500, network issues, etc.) - retry if we haven't exceeded max retries
        if (retryCount < MAX_RETRIES) {
          console.warn(`Failed to fetch user (${response.status}), retrying... (${retryCount + 1}/${MAX_RETRIES})`)
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
          return fetchUser(token, retryCount + 1)
        } else {
          // After max retries, keep user logged in but log the error
          console.error('Failed to fetch user after retries, but keeping token:', response.status)
          // Keep the user logged in, they can try again
          // Don't remove the token on server errors
          shouldSetLoading = true
        }
      }
    } catch (error) {
      // Network errors, timeouts, etc. - retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        const errorName = error instanceof Error ? error.name : 'Unknown'
        console.warn(`Network error (${errorName}), retrying... (${retryCount + 1}/${MAX_RETRIES})`)
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
        return fetchUser(token, retryCount + 1)
      } else {
        // After max retries, keep user logged in
        if (error instanceof Error && error.name === 'AbortError') {
          console.warn('Request timeout after retries, but keeping user logged in')
        } else {
          console.error('Network error fetching user after retries, but keeping token:', error)
        }
        // Don't remove the token on network errors - keep user logged in
        // They can try refreshing or the backend might come back online
        shouldSetLoading = true
      }
    } finally {
      // Set loading to false after all retries are complete
      if (shouldSetLoading) {
        setLoading(false)
      }
    }
  }

  const login = async (credential: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ credential })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Authentication failed')
      }

      const data = await response.json()
      localStorage.setItem('auth_token', data.token)
      setUser(data.user)
    } catch (error) {
      console.error('Login error:', error)
      console.error('Failed URL:', `${BACKEND_URL}/api/auth/google`)
      throw error
    }
  }

  const logout = async () => {
    const token = localStorage.getItem('auth_token')

    // Revoke Drive authorization on backend if token exists
    if (token) {
      try {
        // Call backend to revoke Drive access
        await fetch(`${BACKEND_URL}/api/drive/revoke`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).catch(() => {
          // Ignore errors - user is logging out anyway
        })
      } catch (error) {
        // Ignore errors during logout
        console.warn('Error revoking Drive access during logout:', error)
      }
    }

    // Clear local storage
    localStorage.removeItem('auth_token')

    // Clear PDF history cache
    try {
      localStorage.removeItem('chatnote_pdf_history_cache')
    } catch (error) {
      console.warn('Failed to clear PDF history cache:', error)
    }

    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin'
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

