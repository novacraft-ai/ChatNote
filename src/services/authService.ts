import { BACKEND_URL } from '../config'

export interface ApiKeyStatus {
  hasApiKey: boolean
  isAdmin: boolean
  freeTrial?: {
    enabled: boolean
    used: number
    limit: number
    remaining: number
    quizGenerated?: number
    quizLimit?: number
  }
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

/**
 * Update free trial usage count
 */
export async function updateFreeTrialCount(token: string, usedCount: number): Promise<void> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/user/free-trial/update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ usedCount })
    })

    if (!response.ok) {
      console.error('Failed to update free trial count on backend')
    }
  } catch (error) {
    console.error('Error syncing free trial count:', error)
  }
}

