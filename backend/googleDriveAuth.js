/**
 * Google Drive OAuth Helper
 * Handles OAuth 2.0 flow for Google Drive API access
 */

import { google } from 'googleapis'

// Scopes for Drive access
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file' // Only access files created by app
]

/**
 * Get or create OAuth 2.0 client
 * Creates client lazily to ensure env vars are loaded
 */
function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not set in environment variables')
  }
  
  if (!clientSecret) {
    throw new Error('GOOGLE_CLIENT_SECRET is not set in environment variables')
  }
  
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  )
}

/**
 * Generate OAuth 2.0 authorization URL
 * User will be redirected here to grant Drive access
 */
export function getAuthUrl(state = null) {
  const oauth2Client = getOAuth2Client()
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Required to get refresh token
    scope: SCOPES,
    prompt: 'consent', // Force consent screen to get refresh token
    state: state || undefined,
    redirect_uri: redirectUri
  })
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<{accessToken, refreshToken, expiryDate}>}
 */
export async function getTokensFromCode(code) {
  try {
    const oauth2Client = getOAuth2Client()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
    
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: redirectUri
    })
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, // This is what we need!
      expiryDate: tokens.expiry_date,
      scope: tokens.scope
    }
  } catch (error) {
    console.error('Error getting tokens:', error)
    throw new Error('Failed to exchange authorization code for tokens')
  }
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Stored refresh token
 * @returns {Promise<{accessToken, expiryDate}>}
 */
export async function refreshAccessToken(refreshToken) {
  try {
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    })
    
    const { credentials } = await oauth2Client.refreshAccessToken()
    
    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date
    }
  } catch (error) {
    console.error('Error refreshing token:', error)
    // If Google returns invalid_grant, the refresh token is no longer valid
    if (error?.response?.data?.error === 'invalid_grant') {
      const err = new Error('Refresh token has been revoked or expired. User needs to re-authorize.')
      err.name = 'INVALID_GRANT'
      err.code = 'invalid_grant'
      throw err
    }
    throw new Error('Failed to refresh access token. User may need to re-authorize.')
  }
}

/**
 * Get authenticated Drive client
 * @param {string} refreshToken - Stored refresh token
 * @returns {Promise<Drive>} - Authenticated Google Drive client
 */
export async function getDriveClient(refreshToken) {
  const oauth2Client = getOAuth2Client()
  const { accessToken } = await refreshAccessToken(refreshToken)
  
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  })
  
  return google.drive({ version: 'v3', auth: oauth2Client })
}

/**
 * Revoke access token (for logout)
 * @param {string} refreshToken - Refresh token to revoke
 */
export async function revokeToken(refreshToken) {
  try {
    const oauth2Client = getOAuth2Client()
    
    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    })
    
    // First, try to get an access token from the refresh token
    try {
      const { credentials } = await oauth2Client.refreshAccessToken()
      
      // Update credentials with the new access token
      oauth2Client.setCredentials(credentials)
      
      // Revoke the token using the OAuth2 client's revokeToken method
      // This is the correct async method that doesn't require a callback
      await oauth2Client.revokeToken(credentials.access_token)
      
      return true
    } catch (refreshError) {
      // If refresh fails, try revoking the refresh token directly via HTTP
      console.warn('Could not refresh token for revocation, attempting direct revocation:', refreshError.message)
      
      try {
        // Make direct HTTP request to revoke endpoint
        const response = await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `token=${refreshToken}`
        })
        
        if (response.ok) {
          return true
        } else {
          console.warn('Token revocation returned non-OK status:', response.status)
          return false
        }
      } catch (revokeError) {
        // If both fail, log but don't throw - token might already be revoked
        console.warn('Could not revoke token (may already be revoked):', revokeError.message)
        return false
      }
    }
  } catch (error) {
    console.error('Error revoking token:', error)
    // Don't throw - token revocation failure shouldn't block logout
    return false
  }
}

