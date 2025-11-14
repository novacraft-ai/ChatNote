import { BACKEND_URL } from '../config'

export interface ApiKeyStatus {
  hasApiKey: boolean
  isAdmin: boolean
}

/**
 * Check if user has API key configured
 */
export async function checkApiKeyStatus(token: string): Promise<ApiKeyStatus> {
  const response = await fetch(`${BACKEND_URL}/api/user/api-key/status`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })

  if (!response.ok) {
    throw new Error('Failed to check API key status')
  }

  return response.json()
}

/**
 * Save user's API key (encrypted on backend)
 */
export async function saveApiKey(token: string, apiKey: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/user/api-key`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ apiKey })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to save API key')
  }
}

