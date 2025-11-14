import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { checkApiKeyStatus, saveApiKey } from '../services/authService'
import './ApiKeySettings.css'

export default function ApiKeySettings() {
  const { user, isAdmin } = useAuth()
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (user && !isAdmin) {
      loadApiKeyStatus()
    } else if (isAdmin) {
      setHasApiKey(true)
    }
  }, [user, isAdmin])

  const loadApiKeyStatus = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      const status = await checkApiKeyStatus(token)
      setHasApiKey(status.hasApiKey)
    } catch (error) {
      console.error('Failed to load API key status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!user || !apiKey.trim()) return

    setSaving(true)
    setMessage(null)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        throw new Error('Not authenticated')
      }

      await saveApiKey(token, apiKey.trim())
      setMessage({ type: 'success', text: 'API key saved securely!' })
      setApiKey('')
      setHasApiKey(true)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save API key'
      })
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="api-key-settings">
        <p className="api-key-message">Please sign in to configure your API key.</p>
      </div>
    )
  }

  if (isAdmin) {
    return (
      <div className="api-key-settings">
        <div className="api-key-info admin">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <div>
            <p className="api-key-title">Admin Account</p>
            <p className="api-key-description">You're using the admin API key. No configuration needed.</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="api-key-settings">
        <p className="api-key-message">Loading...</p>
      </div>
    )
  }

  return (
    <div className="api-key-settings">
      <div className="api-key-header">
        <h3>OpenRouter API Key</h3>
        {hasApiKey && (
          <span className="api-key-status-badge">Configured</span>
        )}
      </div>

      <p className="api-key-description">
        {hasApiKey
          ? 'Your API key is securely stored and encrypted. You can update it below.'
          : 'Enter your OpenRouter API key to use the chat feature. Your key will be encrypted and stored securely.'}
      </p>

      <div className="api-key-input-group">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-v1-..."
          className="api-key-input"
          disabled={saving}
        />
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || saving}
          className="api-key-save-button"
        >
          {saving ? 'Saving...' : hasApiKey ? 'Update' : 'Save'}
        </button>
      </div>

      {message && (
        <div className={`api-key-message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="api-key-help">
        <p>
          <strong>Don't have an API key?</strong>
        </p>
        <ol>
          <li>Go to <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a></li>
          <li>Sign up or log in</li>
          <li>Create a new API key</li>
          <li>Copy and paste it here</li>
        </ol>
        <p className="api-key-security-note">
          🔒 Your API key is encrypted with AES-256 and stored securely. Only you can use it.
        </p>
      </div>
    </div>
  )
}

