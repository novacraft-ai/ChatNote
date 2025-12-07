import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import { MongoClient, ObjectId } from 'mongodb'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getAuthUrl, getTokensFromCode, refreshAccessToken } from './googleDriveAuth.js'
import {
  findOrCreateChatNoteFolders,
  uploadFileToDrive,
  downloadFileFromDrive,
  downloadJsonFromDrive,
  loadIndexFile,
  updateIndexFileEntry,
  getPdfHistory,
  truncateFileName,
  generatePdfId,
  findFileByName,
  deleteFilesFromDrive,
  removePdfFromIndex
} from './googleDriveService.js'
import { supabase } from './supabaseClient.js'

dotenv.config()

if (!process.env.FREE_TRIAL_GROQ_API_KEY) {
  console.warn('[config] FREE_TRIAL_GROQ_API_KEY is missing or empty. Free trial chat requests will fail.')
} else {
  console.log('[config] FREE_TRIAL_GROQ_API_KEY detected.')
}

const app = express()
const PORT = process.env.PORT || 3000

// Trust proxy - required when running behind a reverse proxy
// This allows express-rate-limit to correctly identify users by their real IP
app.set('trust proxy', 1)

// Middleware
// CORS configuration - use FRONTEND_URL from environment
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)

    // Get base URL from FRONTEND_URL (remove trailing slash and path if present)
    const frontendUrl = process.env.FRONTEND_URL
    if (frontendUrl) {
      // Normalize the URL (remove trailing slash)
      const normalizedUrl = frontendUrl.replace(/\/$/, '')
      // Extract base domain
      const urlObj = new URL(normalizedUrl)
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`

      // Allow exact match
      if (origin === normalizedUrl) {
        return callback(null, true)
      }

      // Allow base domain (without path)
      if (origin === baseUrl) {
        return callback(null, true)
      }

      // Allow any subpath under the base domain
      if (origin.startsWith(baseUrl + '/')) {
        return callback(null, true)
      }
    }

    // For development, allow localhost and 127.0.0.1 variations
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true)
    }

    // Reject all other origins
    console.warn('CORS blocked origin:', origin, '(Expected:', process.env.FRONTEND_URL || 'localhost', ')')
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))
// Increase JSON body parser limit to handle base64-encoded images (50MB)
app.use(express.json({ limit: '200mb' }))
// Add raw body parser for PDF uploads
app.use(express.raw({ type: 'application/pdf', limit: '100mb' }))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
})

// More lenient rate limiter for API key status checks
const apiKeyStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (allows frequent checks)
  message: 'Too many API key status checks, please slow down.'
})

// Apply general rate limiting to most API routes
app.use('/api/', (req, res, next) => {
  // Exclude API key status endpoint from general limiter
  if (req.path === '/user/api-key/status') {
    return apiKeyStatusLimiter(req, res, next)
  }
  return limiter(req, res, next)
})

// Chat endpoint rate limiting (stricter)
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: 'Too many chat requests, please slow down.'
})

// MongoDB connection
let db
const connectDB = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI)
    await client.connect()
    // Use database from connection string, or default to 'chatnote' if not specified
    // Connection string format: mongodb+srv://...@cluster.net/database?options
    const uri = process.env.MONGODB_URI
    const dbNameMatch = uri.match(/mongodb\+srv:\/\/[^/]+\/([^?]+)/)
    const dbName = dbNameMatch ? dbNameMatch[1] : 'chatnote'
    db = client.db(dbName)
    console.log(`✅ Connected to MongoDB Atlas (database: ${db.databaseName})`)
  } catch (error) {
    console.error('❌ MongoDB connection error:', error)
    process.exit(1)
  }
}

// Encryption utilities for API keys
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 64
const TAG_LENGTH = 16

function encrypt(text, key) {
  const keyBuffer = Buffer.from(key, 'hex')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv)

  let encrypted = cipher.update(text, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(encryptedData, key) {
  const keyBuffer = Buffer.from(key, 'hex')
  const data = Buffer.from(encryptedData, 'base64')

  const iv = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])

  return decrypted.toString('utf8')
}



// JWT middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Get fresh user data from database
    const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.userId) })
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      googleId: user.googleId
    }
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Google OAuth verification and JWT issuance
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body

    if (!credential) {
      return res.status(400).json({ error: 'Google credential required' })
    }

    // Verify Google token (simplified - in production, verify with Google's API)
    // For now, we'll decode the JWT to get user info
    // In production, use: https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=CREDENTIAL
    let decoded
    try {
      // Decode without verification (Google's public keys should be used in production)
      const parts = credential.split('.')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      decoded = payload
    } catch (error) {
      return res.status(401).json({ error: 'Invalid Google token' })
    }

    const { sub: googleId, email, name, picture } = decoded

    if (!email || !googleId) {
      return res.status(400).json({ error: 'Invalid Google token data' })
    }

    // Check if user exists
    let user = await db.collection('users').findOne({ googleId })

    // Check admin status
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim())
    const isAdmin = adminEmails.includes(email.toLowerCase())

    if (!user) {
      // Create new user with name and picture
      const newUser = {
        googleId,
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        picture: picture || null,
        role: isAdmin ? 'admin' : 'user',
        googleDriveEligible: isAdmin ? true : false, // Add Google Drive eligibility - admins always eligible
        createdAt: new Date()
      }
      
      // Add free trial settings ONLY for non-admin users
      if (!isAdmin) {
        newUser.freeTrialEnabled = true
        newUser.freeTrialStartedAt = new Date()
        newUser.freeTrialLimit = 10
        newUser.freeTrialUsed = 0
        newUser.freeTrialEndsAt = null
        newUser.freeTrialQuizGenerated = 0  // Track count of quizzes generated by free trial user
        newUser.freeTrialQuizLimit = 1  // Limit for quiz generation during free trial
      }
      
      const result = await db.collection('users').insertOne(newUser)
      user = { ...newUser, _id: result.insertedId }
    } else {
      // Update user info (name, picture, and role if needed)
      const updateData = {
        name: name || user.name || email.split('@')[0],
        picture: picture || user.picture || null
      }

      // Update role if email is in admin list (allows promoting users)
      if (isAdmin && user.role !== 'admin') {
        updateData.role = 'admin'
      }
      
      // BACKFILL: Add googleDriveEligible field to existing users who don't have it
      // This runs automatically when existing users log in
      if (user.googleDriveEligible === undefined) {
        updateData.googleDriveEligible = user.role === 'admin' ? true : false
      }

      // BACKFILL: Add free trial fields to existing users who don't have them
      // This runs automatically when existing users log in
      if (user.role === 'user' && !user.freeTrialStartedAt) {
        updateData.freeTrialEnabled = true
        updateData.freeTrialStartedAt = new Date()
        updateData.freeTrialLimit = 10
        updateData.freeTrialUsed = 0
        updateData.freeTrialEndsAt = null
        updateData.freeTrialQuizGenerated = 0  // Track count of quizzes generated by free trial user
        updateData.freeTrialQuizLimit = 1  // Limit for quiz generation during free trial
      }
      
      // BACKFILL: Add quiz generation fields to existing users who don't have them
      // This runs automatically when existing users log in
      if (user.role === 'user' && user.freeTrialStartedAt && (user.freeTrialQuizGenerated === undefined || user.freeTrialQuizLimit === undefined)) {
        if (user.freeTrialQuizGenerated === undefined) {
          updateData.freeTrialQuizGenerated = 0;  // Default to not having generated any quizzes (counter)
        }
        if (user.freeTrialQuizLimit === undefined) {
          updateData.freeTrialQuizLimit = 1;  // Default limit of 1 quiz
        }
      }

      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: updateData }
      )

      // Update local user object
      user.name = updateData.name
      user.picture = updateData.picture
      if (updateData.role) {
        user.role = updateData.role
      }
      // Update googleDriveEligible in local object if backfilled
      if (updateData.googleDriveEligible !== undefined) {
        user.googleDriveEligible = updateData.googleDriveEligible
      }
      // Update free trial fields in local object if backfilled
      if (updateData.freeTrialEnabled !== undefined) {
        user.freeTrialEnabled = updateData.freeTrialEnabled
        user.freeTrialStartedAt = updateData.freeTrialStartedAt
        user.freeTrialLimit = updateData.freeTrialLimit
        user.freeTrialUsed = updateData.freeTrialUsed
        user.freeTrialEndsAt = updateData.freeTrialEndsAt
      }
      // Update quiz generation fields in local object if backfilled
      if (updateData.freeTrialQuizGenerated !== undefined) {
        user.freeTrialQuizGenerated = updateData.freeTrialQuizGenerated;
      }
      if (updateData.freeTrialQuizLimit !== undefined) {
        user.freeTrialQuizLimit = updateData.freeTrialQuizLimit;
      }
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name || email.split('@')[0],
        picture: user.picture || null,
        role: user.role,
        googleDriveEligible: user.googleDriveEligible || false,
        privacyConsent: !!user.privacyConsent
      }
    })
  } catch (error) {
    console.error('Auth error:', error)
    res.status(500).json({ error: 'Authentication failed' })
  }
})

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    // Get fresh user data from database to include name and picture
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name || user.email.split('@')[0],
        picture: user.picture || null,
        role: user.role,
        googleDriveEligible: user.googleDriveEligible || false,
        privacyConsent: !!user.privacyConsent
      }
    })
  } catch (error) {
    console.error('Error fetching user:', error)
    res.status(500).json({ error: 'Failed to fetch user data' })
  }
})

// Save/Update user's API key (non-admin only)
app.post('/api/user/api-key', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admins use predefined API key' })
    }

    const { apiKey } = req.body
    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'API key required' })
    }

    // Validate API key format (Groq keys start with gsk_)
    if (!apiKey.startsWith('gsk_') && !apiKey.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid API key format' })
    }

    // Encrypt API key
    const encryptedKey = encrypt(apiKey, process.env.ENCRYPTION_KEY)

    // Upsert API key
    await db.collection('apiKeys').updateOne(
      { userId: new ObjectId(req.user.id) },
      {
        $set: {
          encryptedKey,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    )

    res.json({ success: true, message: 'API key saved securely' })
  } catch (error) {
    console.error('API key save error:', error)
    res.status(500).json({ error: 'Failed to save API key' })
  }
})

// Check if user has API key configured
app.get('/api/user/api-key/status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.json({ hasApiKey: true, isAdmin: true })
    }

    const apiKeyDoc = await db.collection('apiKeys').findOne({
      userId: new ObjectId(req.user.id)
    })
    
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })
    
    // Get free trial information
    const freeTrialEnabled = user?.freeTrialEnabled || false
    const freeTrialUsed = user?.freeTrialUsed || 0
    const freeTrialLimit = user?.freeTrialLimit || 10
    const canUseFreeTrialRemaining = freeTrialLimit - freeTrialUsed
    const freeTrialQuizGenerated = user?.freeTrialQuizGenerated || 0
    const freeTrialQuizLimit = user?.freeTrialQuizLimit || 1
    
    const response = { 
      hasApiKey: !!apiKeyDoc, 
      isAdmin: false,
      freeTrial: {
        enabled: freeTrialEnabled && canUseFreeTrialRemaining > 0,
        used: freeTrialUsed,
        limit: freeTrialLimit,
        remaining: canUseFreeTrialRemaining,
        quizGenerated: freeTrialQuizGenerated,
        quizLimit: freeTrialQuizLimit
      }
    }
    
    res.json(response)
  } catch (error) {
    console.error('API key status error:', error)
    res.status(500).json({ error: 'Failed to check API key status' })
  }
})

// ============================================
// Google Drive OAuth Endpoints
// ============================================

async function clearDriveAuthorization(userId) {
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        googleDriveRefreshToken: null,
        googleDriveAccessToken: null,
        googleDriveTokenExpiry: null,
        googleDriveAuthorizedAt: null
      }
    }
  )
}

// Initiate Google Drive OAuth flow
// User must be authenticated first
app.get('/api/drive/auth', authenticateToken, async (req, res) => {
  try {
    // Validate environment variables
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        error: 'GOOGLE_CLIENT_ID is not configured. Please set it in backend/.env file.'
      })
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'GOOGLE_CLIENT_SECRET is not configured. Please set it in backend/.env file.'
      })
    }

    // Check if user already has Drive access
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })

    if (user?.googleDriveRefreshToken) {
      // User already authorized - return success
      return res.json({
        authorized: true,
        message: 'Drive access already authorized'
      })
    }

    // Generate OAuth URL with user ID as state
    const authUrl = getAuthUrl(req.user.id)

    res.json({
      authorized: false,
      authUrl: authUrl
    })
  } catch (error) {
    console.error('Drive auth error:', error)
    if (error.message.includes('not set')) {
      return res.status(500).json({
        error: error.message + ' Please check your backend/.env file.'
      })
    }
    res.status(500).json({ error: 'Failed to initiate Drive authorization: ' + error.message })
  }
})

// OAuth callback - receives authorization code
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query

    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?drive_auth_error=${error}`)
    }

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?drive_auth_error=no_code`)
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code)

    // Get user ID from state (or extract from token)
    const userId = state

    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?drive_auth_error=invalid_state`)
    }

    // Store refresh token securely in database
    // Encrypt it like we do with API keys
    const encryptedRefreshToken = encrypt(tokens.refreshToken, process.env.ENCRYPTION_KEY)

    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          googleDriveRefreshToken: encryptedRefreshToken,
          googleDriveAccessToken: tokens.accessToken, // Temporary - will refresh
          googleDriveTokenExpiry: tokens.expiryDate,
          googleDriveAuthorizedAt: new Date()
        }
      }
    )

    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?drive_auth_success=true`)
  } catch (error) {
    console.error('OAuth callback error:', error)
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?drive_auth_error=callback_failed`)
  }
})

// Revoke Drive authorization (called on logout)
app.post('/api/drive/revoke', authenticateToken, async (req, res) => {
  try {
    // NOTE: This endpoint should only be called when the user explicitly wants to disconnect from Google Drive
    // It should NOT be called during regular logout to preserve the user's Google Drive authorization
    
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })

    if (user?.googleDriveRefreshToken) {
      try {
        // Decrypt and revoke the refresh token
        const refreshToken = decrypt(user.googleDriveRefreshToken, process.env.ENCRYPTION_KEY)
        const { revokeToken } = await import('./googleDriveAuth.js')
        await revokeToken(refreshToken)
      } catch (error) {
        console.warn('Error revoking Drive token:', error)
        // Continue to clear from database even if revocation fails
      }

      // Clear Drive tokens from database
      await db.collection('users').updateOne(
        { _id: new ObjectId(req.user.id) },
        {
          $set: {
            googleDriveRefreshToken: null,
            googleDriveAccessToken: null,
            googleDriveTokenExpiry: null,
            googleDriveAuthorizedAt: null
          }
        }
      )
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Revoke Drive error:', error)
    res.status(500).json({ error: 'Failed to revoke Drive access' })
  }
})

// Check Drive authorization status
app.get('/api/drive/status', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })

    if (!user?.googleDriveRefreshToken) {
      return res.json({ authorized: false })
    }

    // Check if token is expired (or will expire soon)
    const now = Date.now()
    const expiryTime = user.googleDriveTokenExpiry || 0
    const isExpired = expiryTime < now + (5 * 60 * 1000) // 5 minutes buffer

    res.json({
      authorized: true,
      tokenExpired: isExpired,
      authorizedAt: user.googleDriveAuthorizedAt
    })
  } catch (error) {
    console.error('Drive status error:', error)
    res.status(500).json({ error: 'Failed to check Drive status' })
  }
})

// ============================================
// Google Drive API Endpoints
// ============================================

// Helper: Get user's refresh token (decrypted)
async function getUserRefreshToken(userId) {
  const user = await db.collection('users').findOne({ _id: new ObjectId(userId) })
  if (!user?.googleDriveRefreshToken) {
    throw new Error('Drive not authorized')
  }
  return decrypt(user.googleDriveRefreshToken, process.env.ENCRYPTION_KEY)
}

// Get PDF history
app.get('/api/drive/history', authenticateToken, async (req, res) => {
  try {
    const refreshToken = await getUserRefreshToken(req.user.id)
    const pdfs = await getPdfHistory(refreshToken)
    res.json({ pdfs })
  } catch (error) {
    console.error('Get history error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized. Please authorize Drive access first.' })
    }
    res.status(500).json({ error: 'Failed to get PDF history' })
  }
})

// Upload PDF to Drive
// Note: This endpoint expects PDF as base64 string in JSON body
// Frontend should send: { pdfBase64: string, fileName: string }
app.post('/api/drive/upload-pdf', authenticateToken, express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const { pdfBase64, fileName, displayName } = req.body

    if (!pdfBase64) {
      return res.status(400).json({ error: 'PDF file required (as base64)' })
    }

    // Convert base64 to buffer
    let pdfBuffer
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64')
      if (pdfBuffer.length === 0) {
        throw new Error('Invalid base64: resulted in empty buffer')
      }
    } catch (bufferError) {
      console.error('Base64 conversion error:', bufferError)
      return res.status(400).json({ error: 'Invalid base64 data', details: bufferError.message })
    }

    const finalFileName = fileName || 'document.pdf'
    

    const refreshToken = await getUserRefreshToken(req.user.id)

    const folders = await findOrCreateChatNoteFolders(refreshToken)

    // Generate PDF ID
    const pdfId = generatePdfId()

    // Upload original PDF
    const originalPdfFileId = await uploadFileToDrive(
      folders.pdfsFolderId,
      `${pdfId}-original.pdf`,
      pdfBuffer,
      'application/pdf',
      refreshToken
    )

    // Create metadata
    const metadata = {
      pdfId,
      originalFileName: finalFileName,
      displayName: displayName || truncateFileName(finalFileName),
      uploadedAt: Date.now(),
      lastModifiedAt: Date.now(),
      pageCount: 0, // Will be updated when PDF is loaded
      hasAnnotations: false,
      hasNotes: false,
      fileIds: {
        original: originalPdfFileId,
        metadata: null,
        annotations: null,
        notes: null
      }
    }

    // Upload metadata file
    const metadataFileId = await uploadFileToDrive(
      folders.metadataFolderId,
      `${pdfId}-metadata.json`,
      JSON.stringify(metadata),
      'application/json',
      refreshToken
    )
    metadata.fileIds.metadata = metadataFileId

    // Update index.json
    await updateIndexFileEntry(folders.chatNoteFolderId, {
      pdfId: metadata.pdfId,
      originalFileName: metadata.originalFileName,
      displayName: metadata.displayName,
      uploadedAt: metadata.uploadedAt,
      lastModifiedAt: metadata.lastModifiedAt,
      pageCount: metadata.pageCount,
      hasAnnotations: false,
      hasNotes: false,
      fileIds: metadata.fileIds
    }, refreshToken)

    res.json({
      pdfId: metadata.pdfId,
      displayName: metadata.displayName,
      fileIds: metadata.fileIds
    })
  } catch (error) {
    console.error('Upload PDF error:', error)
    console.error('Error stack:', error.stack)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({
      error: 'Failed to upload PDF',
      details: error.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

// Load PDF from history (with annotations and notes)
app.get('/api/drive/load-pdf/:pdfId', authenticateToken, async (req, res) => {
  try {
    const { pdfId } = req.params
    const refreshToken = await getUserRefreshToken(req.user.id)

    // Load metadata
    const folders = await findOrCreateChatNoteFolders(refreshToken)
    const metadataFile = await findFileByName(`${pdfId}-metadata.json`, folders.metadataFolderId, refreshToken)

    if (!metadataFile) {
      return res.status(404).json({ error: 'PDF not found' })
    }

    const metadata = await downloadJsonFromDrive(metadataFile.id, refreshToken)

    // Download PDF (use annotated if exists, otherwise original)
    const pdfFileId = metadata.fileIds.annotated || metadata.fileIds.original
    const pdfBuffer = await downloadFileFromDrive(pdfFileId, refreshToken)
    const pdfBase64 = pdfBuffer.toString('base64')

    // Load annotations (if exists)
    let annotations = []
    if (metadata.fileIds.annotations) {
      try {
        const annotationsData = await downloadJsonFromDrive(metadata.fileIds.annotations, refreshToken)
        annotations = annotationsData.annotations || []
      } catch (error) {
        console.warn('Failed to load annotations:', error)
      }
    }

    // Load knowledge notes (if exists)
    let knowledgeNotes = []
    if (metadata.fileIds.notes) {
      try {
        const notesData = await downloadJsonFromDrive(metadata.fileIds.notes, refreshToken)
        knowledgeNotes = notesData.notes || []
      } catch (error) {
        console.warn('Failed to load notes:', error)
      }
    }

    res.json({
      pdfBlob: pdfBase64,
      annotations,
      knowledgeNotes,
      metadata: {
        pdfId: metadata.pdfId,
        originalFileName: metadata.originalFileName,
        pageCount: metadata.pageCount,
        uploadedAt: metadata.uploadedAt,
        lastModifiedAt: metadata.lastModifiedAt
      }
    })
  } catch (error) {
    console.error('Load PDF error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to load PDF' })
  }
})

// Delete PDF from Drive and history
app.delete('/api/drive/history/:pdfId', authenticateToken, async (req, res) => {
  try {
    const { pdfId } = req.params
    if (!pdfId) {
      return res.status(400).json({ error: 'PDF ID is required' })
    }

    const refreshToken = await getUserRefreshToken(req.user.id)
    const folders = await findOrCreateChatNoteFolders(refreshToken)

    // Attempt to load metadata for comprehensive file IDs
    let metadata = null
    const metadataFile = await findFileByName(`${pdfId}-metadata.json`, folders.metadataFolderId, refreshToken)
    if (metadataFile) {
      try {
        metadata = await downloadJsonFromDrive(metadataFile.id, refreshToken)
      } catch (error) {
        console.warn('Failed to read metadata for deletion:', error.message)
      }
    }

    // Remove from index (returns entry if it existed)
    const removedEntry = await removePdfFromIndex(folders.chatNoteFolderId, pdfId, refreshToken)
    if (!removedEntry && !metadata) {
      return res.status(404).json({ error: 'PDF not found' })
    }

    // Collect file IDs to delete
    const fileIds = new Set()
    const collectFileIds = (fileMap) => {
      if (!fileMap) return
      Object.values(fileMap).forEach(id => {
        if (id) fileIds.add(id)
      })
    }

    collectFileIds(metadata?.fileIds)
    collectFileIds(removedEntry?.fileIds)
    if (metadataFile?.id) {
      fileIds.add(metadataFile.id)
    }

    if (fileIds.size > 0) {
      await deleteFilesFromDrive(Array.from(fileIds), refreshToken)
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Delete PDF error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to delete PDF' })
  }
})

// Save annotations
app.post('/api/drive/save-annotations/:pdfId', authenticateToken, async (req, res) => {
  try {
    const { pdfId } = req.params
    const { annotations } = req.body
    const refreshToken = await getUserRefreshToken(req.user.id)

    // Load metadata
    const folders = await findOrCreateChatNoteFolders(refreshToken)
    const metadataFile = await findFileByName(`${pdfId}-metadata.json`, folders.metadataFolderId, refreshToken)

    if (!metadataFile) {
      return res.status(404).json({ error: 'PDF not found' })
    }

    const metadata = await downloadJsonFromDrive(metadataFile.id, refreshToken)

    // Create/update annotations file
    const annotationsData = {
      pdfId,
      version: 1,
      lastModified: Date.now(),
      annotations: annotations || []
    }

    if (metadata.fileIds.annotations) {
      await uploadFileToDrive(
        folders.metadataFolderId,
        `${pdfId}-annotations.json`,
        JSON.stringify(annotationsData),
        'application/json',
        refreshToken
      )
    } else {
      const annotationsFileId = await uploadFileToDrive(
        folders.metadataFolderId,
        `${pdfId}-annotations.json`,
        JSON.stringify(annotationsData),
        'application/json',
        refreshToken
      )
      metadata.fileIds.annotations = annotationsFileId
    }

    // Update metadata
    metadata.hasAnnotations = annotations && annotations.length > 0
    metadata.lastModifiedAt = Date.now()
    await uploadFileToDrive(
      folders.metadataFolderId,
      `${pdfId}-metadata.json`,
      JSON.stringify(metadata),
      'application/json',
      refreshToken
    )

    // Update index
    await updateIndexFileEntry(folders.chatNoteFolderId, {
      pdfId,
      hasAnnotations: metadata.hasAnnotations,
      lastModifiedAt: metadata.lastModifiedAt,
      fileIds: metadata.fileIds
    }, refreshToken)

    res.json({ success: true })
  } catch (error) {
    console.error('Save annotations error:', error)
    // Check for invalid_grant error from Google OAuth
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to save annotations' })
  }
})

// Save knowledge notes
app.post('/api/drive/save-notes/:pdfId', authenticateToken, async (req, res) => {
  try {
    const { pdfId } = req.params
    const { notes } = req.body
    const refreshToken = await getUserRefreshToken(req.user.id)

    // Load metadata
    const folders = await findOrCreateChatNoteFolders(refreshToken)
    const metadataFile = await findFileByName(`${pdfId}-metadata.json`, folders.metadataFolderId, refreshToken)

    if (!metadataFile) {
      return res.status(404).json({ error: 'PDF not found' })
    }

    const metadata = await downloadJsonFromDrive(metadataFile.id, refreshToken)

    // Create/update notes file
    const notesData = {
      pdfId,
      version: 1,
      lastModified: Date.now(),
      notes: notes || []
    }

    if (metadata.fileIds.notes) {
      await uploadFileToDrive(
        folders.metadataFolderId,
        `${pdfId}-notes.json`,
        JSON.stringify(notesData),
        'application/json',
        refreshToken
      )
    } else {
      const notesFileId = await uploadFileToDrive(
        folders.metadataFolderId,
        `${pdfId}-notes.json`,
        JSON.stringify(notesData),
        'application/json',
        refreshToken
      )
      metadata.fileIds.notes = notesFileId
    }

    // Update metadata
    metadata.hasNotes = notes && notes.length > 0
    metadata.lastModifiedAt = Date.now()
    await uploadFileToDrive(
      folders.metadataFolderId,
      `${pdfId}-metadata.json`,
      JSON.stringify(metadata),
      'application/json',
      refreshToken
    )

    // Update index
    await updateIndexFileEntry(folders.chatNoteFolderId, {
      pdfId,
      hasNotes: metadata.hasNotes,
      lastModifiedAt: metadata.lastModifiedAt,
      fileIds: metadata.fileIds
    }, refreshToken)

    res.json({ success: true })
  } catch (error) {
    console.error('Save notes error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to save notes' })
  }
})

// Save quiz history
app.post('/api/drive/save-quiz', authenticateToken, async (req, res) => {
  try {
    const { pdfId, quiz } = req.body
    const refreshToken = await getUserRefreshToken(req.user.id)

    // Load or create folders
    const folders = await findOrCreateChatNoteFolders(refreshToken)
    
    // Create quizzes folder if it doesn't exist
    const quizzesFolderId = folders.quizzesFolderId || await uploadFileToDrive(
      folders.chatNoteFolderId,
      'quizzes',
      '',
      'application/vnd.google-apps.folder',
      refreshToken
    )

    // Generate quiz ID if not provided
    const quizId = quiz.id || `quiz-${Date.now()}`
    
    // Save quiz data
    const quizData = {
      ...quiz,
      id: quizId,
      pdfId,
      version: 1,
      lastModified: Date.now()
    }

    await uploadFileToDrive(
      quizzesFolderId,
      `${quizId}.json`,
      JSON.stringify(quizData),
      'application/json',
      refreshToken
    )

    res.json({ success: true, quizId })
  } catch (error) {
    console.error('Save quiz error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to save quiz' })
  }
})

// Get quiz history
app.get('/api/drive/quiz-history', authenticateToken, async (req, res) => {
  try {
    const { pdfId } = req.query
    const refreshToken = await getUserRefreshToken(req.user.id)

    const folders = await findOrCreateChatNoteFolders(refreshToken)
    
    // Return empty if quizzes folder doesn0t exist yet
    if (!folders.quizzesFolderId) {
      return res.json({ quizzes: [] })
    }

    // List all quiz files
    const { google } = await import('googleapis')
    const drive = google.drive('v3')
    
    // Get fresh access token
    const { access_token } = await refreshAccessToken(refreshToken)
    
    let query = `'${folders.quizzesFolderId}' in parents and mimeType='application/json' and trashed=false`
    
    // Filter by PDF if provided
    if (pdfId) {
      query += ` and name contains '${pdfId}'`
    }

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc',
      access_token
    })

    const quizzes = []
    for (const file of response.data.files || []) {
      try {
        const quizData = await downloadJsonFromDrive(file.id, refreshToken)
        quizzes.push(quizData)
      } catch (err) {
        console.warn(`Failed to load quiz ${file.name}:`, err)
      }
    }

    res.json({ quizzes })
  } catch (error) {
    console.error('Get quiz history error:', error)
    if ((error.response?.data?.error === 'invalid_grant' || 
        error.code === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message === 'INVALID_GRANT' ||
        error.message?.includes('INVALID_GRANT') ||
        error.name === 'INVALID_GRANT') &&
        // Only clear authorization if we're sure it's permanently invalid
        !error.message?.includes('Token has been expired or revoked')) {
      await clearDriveAuthorization(req.user.id)
      return res.status(403).json({ error: 'Drive authorization expired. Please authorize again.' })
    }
    if (error.message === 'Drive not authorized') {
      return res.status(403).json({ error: 'Drive not authorized' })
    }
    res.status(500).json({ error: 'Failed to get quiz history' })
  }
})


// Chat proxy endpoint
// Embedding endpoint for RAG (proxies to Hugging Face, Cohere, or OpenAI)
// No authentication required for embedding requests (they're free and rate-limited)
app.post('/api/embedding', async (req, res) => {
  try {
    const { text, provider, apiKey } = req.body

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' })
    }

    const textToEmbed = text.slice(0, 512) // Limit text length

    // Provider: 'huggingface' (model: 'all-MiniLM-L6-v2' or 'bge-small-en-v1.5'), 'cohere', or 'openai'
    if (provider === 'huggingface') {
      const model = req.body.model || 'sentence-transformers/all-MiniLM-L6-v2'
      // Use new Hugging Face router endpoint
      const hfUrl = `https://router.huggingface.co/hf-inference/${model}`

      try {
        const hfResponse = await fetch(hfUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: textToEmbed,
            options: { wait_for_model: true }
          })
        })

        if (hfResponse.ok) {
          const embedding = await hfResponse.json()
          if (Array.isArray(embedding)) {
            const flatEmbedding = embedding.flat()
            if (flatEmbedding.length > 0 && typeof flatEmbedding[0] === 'number') {
              return res.json({ embedding: flatEmbedding })
            }
          }
        }
        // If response not ok, fall through to error
        const errorText = await hfResponse.text()
        console.error('[Embedding] Hugging Face error:', hfResponse.status, errorText)
        return res.status(hfResponse.status).json({ error: 'Hugging Face API error' })
      } catch (error) {
        console.error('[Embedding] Hugging Face request failed:', error)
        return res.status(500).json({ error: 'Hugging Face request failed' })
      }
    } else if (provider === 'cohere') {
      if (!apiKey) {
        return res.status(400).json({ error: 'API key required for Cohere' })
      }

      try {
        const cohereResponse = await fetch('https://api.cohere.ai/v1/embed', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'embed-english-v3.0',
            texts: [textToEmbed],
            input_type: 'search_document'
          })
        })

        if (cohereResponse.ok) {
          const data = await cohereResponse.json()
          if (data.embeddings && data.embeddings[0]) {
            return res.json({ embedding: data.embeddings[0] })
          }
        }
        const errorText = await cohereResponse.text()
        console.error('[Embedding] Cohere error:', cohereResponse.status, errorText)
        return res.status(cohereResponse.status).json({ error: 'Cohere API error' })
      } catch (error) {
        console.error('[Embedding] Cohere request failed:', error)
        return res.status(500).json({ error: 'Cohere request failed' })
      }
    } else if (provider === 'openai') {
      if (!apiKey) {
        return res.status(400).json({ error: 'API key required for OpenAI' })
      }

      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: textToEmbed
          })
        })

        if (response.ok) {
          const data = await response.json()
          if (data.data && data.data[0]?.embedding) {
            return res.json({ embedding: data.data[0].embedding })
          }
        }
        const errorText = await response.text()
        console.error('[Embedding] OpenAI error:', response.status, errorText)
        return res.status(response.status).json({ error: 'OpenAI API error' })
      } catch (error) {
        console.error('[Embedding] OpenAI request failed:', error)
        return res.status(500).json({ error: 'OpenAI request failed' })
      }
    } else {
      return res.status(400).json({ error: 'Invalid provider. Use: huggingface, cohere, or openai' })
    }
  } catch (error) {
    console.error('[Embedding] Server error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/chat', chatLimiter, authenticateToken, async (req, res) => {
  try {
    const { messages, context, model, temperature, maxTokens, stream, reasoning_format, include_reasoning, response_format } = req.body

    // Validate input
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    // Determine which API key to use
    let apiKey
    let isFreeTrialUser = false
    if (req.user.role === 'admin') {
      // Admin uses predefined key
      apiKey = process.env.ADMIN_GROQ_API_KEY
      if (!apiKey) {
        return res.status(500).json({ error: 'Admin API key not configured' })
      }
    } else {
      // User uses their own key
      const apiKeyDoc = await db.collection('apiKeys').findOne({
        userId: new ObjectId(req.user.id)
      })

      if (!apiKeyDoc) {
        // BACKEND VALIDATION: Check free trial eligibility and enforce limit
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) })
        const freeTrialEnabled = user?.freeTrialEnabled || false
        const freeTrialUsed = user?.freeTrialUsed || 0
        const freeTrialLimit = user?.freeTrialLimit || 10
        
        // CRITICAL: Backend enforces the limit (prevents frontend hacks)
        // Use <= to allow the last question (frontend increments before sending)
        // Example: user has 1 left, sends question, frontend sets used=10, limit=10
        // Backend receives request with used=10, should allow it since it's the 10th question
        if (freeTrialEnabled && freeTrialUsed <= freeTrialLimit) {
          // Use free trial API key
          apiKey = process.env.FREE_TRIAL_GROQ_API_KEY
          if (!apiKey) {
            return res.status(500).json({ 
              error: 'Free trial API key not configured on server. Please contact administrator.' 
            })
          }
          isFreeTrialUser = true
          
          // If this is the user's last free trial question, set the end timestamp
          if (freeTrialUsed === freeTrialLimit) {
            await db.collection('users').updateOne(
              { _id: new ObjectId(req.user.id) },
              { $set: { freeTrialEndsAt: new Date() } }
            )
          }
        } else {
          // No API key and no free trial available
          const remainingTrials = Math.max(0, freeTrialLimit - freeTrialUsed)
          if (freeTrialEnabled && remainingTrials === 0) {
            return res.status(400).json({
              error: `Free trial limit reached (${freeTrialUsed}/${freeTrialLimit} used). Please add your own Groq API key in settings to continue.`
            })
          } else {
            return res.status(400).json({
              error: 'API key not configured. Please add your Groq API key in settings.'
            })
          }
        }
      } else {
        try {
          apiKey = decrypt(apiKeyDoc.encryptedKey, process.env.ENCRYPTION_KEY)
        } catch (error) {
          console.error('Decryption error:', error)
          return res.status(500).json({ error: 'Failed to decrypt API key' })
        }
      }
    }

    // Build system message
    const systemMessage = {
      role: 'system',
      content: context
        ? `You are a helpful assistant helping a student understand their PDF document.
Context from the PDF: "${context}"
Use this context to provide relevant and accurate answers. If the context doesn't contain relevant information, you can still help with general questions.`
        : 'You are a helpful assistant helping students learn and understand their study materials.'
    }

    // Clean messages to remove unsupported properties (like 'id') that Groq doesn't accept
    // Groq only supports 'role' and 'content' properties
    const cleanedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))

    const allMessages = [systemMessage, ...cleanedMessages]

    // Prepare request to Groq
    const requestBody = {
      model: model || 'llama-3.1-70b-versatile',
      messages: allMessages,
      temperature: temperature || 0.7,
      max_tokens: maxTokens || 3000,
      stream: stream || false
    }

    // Add reasoning parameters if provided
    // Note: reasoning_format and include_reasoning are mutually exclusive
    // GPT-OSS models use include_reasoning, Qwen models use reasoning_format
    if (req.body.reasoning_format) {
      requestBody.reasoning_format = req.body.reasoning_format
    }
    if (req.body.include_reasoning !== undefined) {
      requestBody.include_reasoning = req.body.include_reasoning
    }

    // Add response_format for structured outputs (JSON schema) if provided
    if (req.body.response_format) {
      requestBody.response_format = req.body.response_format
    }

    // Make request to Groq
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      let error
      try {
        error = JSON.parse(errorText)
      } catch {
        error = { error: { message: errorText || 'Unknown error' } }
      }

      console.error('Groq API error:', {
        status: response.status,
        statusText: response.statusText,
        error: error.error || error,
        model: requestBody.model,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'missing'
      })

      // Sanitize error message before sending to client
      let userMessage = 'An error occurred while processing your request.'

      if (response.status === 429) {
        userMessage = 'Rate limit reached. Please wait a moment and try again.'
      } else if (response.status === 401) {
        userMessage = 'Authentication failed. Please check your API key.'
      } else if (response.status === 400) {
        const errorMsg = error.error?.message || error.message || ''
        if (errorMsg.includes('API key not configured')) {
          userMessage = 'API key not configured. Please add your API key in settings.'
        } else if (errorMsg.includes('model') || errorMsg.includes('invalid')) {
          userMessage = 'Invalid request. Please try again or select a different model.'
        } else {
          userMessage = 'Invalid request. Please check your input and try again.'
        }
      } else if (response.status === 403) {
        userMessage = 'Access denied. Please check your API key permissions.'
      } else if (response.status === 404) {
        userMessage = 'Model not found. Please select a different model.'
      } else if (response.status >= 500 && response.status < 600) {
        userMessage = 'Service temporarily unavailable. Please try again in a moment.'
      }

      return res.status(response.status).json({
        error: userMessage
      })
    }

    // Handle streaming response
    if (stream && response.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          res.write(chunk)
        }
        res.end()
      } catch (error) {
        console.error('Streaming error:', error)
        res.end()
      }
    } else {
      // Non-streaming response
      const data = await response.json()
      res.json(data)
    }
  } catch (error) {
    console.error('Chat proxy error:', error)
    res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

// Add privacyConsent attribute to user schema
const updateUserConsent = async (userId, consentStatus) => {
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $set: { privacyConsent: consentStatus } }
  );
};

// Endpoint to update privacy consent
app.post('/api/user/privacy-consent', authenticateToken, async (req, res) => {
  try {
    const { consent } = req.body;
    if (typeof consent !== 'boolean') {
      return res.status(400).json({ error: 'Invalid consent value' });
    }

    await updateUserConsent(req.user.id, consent);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating privacy consent:', error);
    res.status(500).json({ error: 'Failed to update privacy consent' });
  }
});

// Update free trial usage count (called from frontend)
app.post('/api/user/free-trial/update', authenticateToken, async (req, res) => {
  try {
    const { usedCount } = req.body;
    
    if (typeof usedCount !== 'number' || usedCount < 0) {
      return res.status(400).json({ error: 'Invalid usage count' });
    }

    // Only allow users (not admins) to update free trial count
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admins do not have free trial' });
    }

    // Update the count in MongoDB
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { freeTrialUsed: usedCount } }
    );

    res.json({ success: true, freeTrialUsed: usedCount });
  } catch (error) {
    console.error('Error updating free trial count:', error);
    res.status(500).json({ error: 'Failed to update free trial count' });
  }
});

// Generate quiz questions (with one-time restriction for free trial users)
app.post('/api/quiz/generate', authenticateToken, async (req, res) => {
  try {
    const { pdfText, options } = req.body;
    
    if (!pdfText || typeof pdfText !== 'string') {
      return res.status(400).json({ error: 'PDF text is required' });
    }
    
    if (!options || typeof options !== 'object') {
      return res.status(400).json({ error: 'Quiz options are required' });
    }

    // Check if user is admin (admins have no restrictions)
    if (req.user.role === 'admin') {
      // Admins can generate quizzes without restrictions
      return res.json({ canGenerate: true, isAdmin: true });
    }

    // Get user's free trial information
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
    
    // Check if user has API key configured (no restrictions if they do)
    const apiKeyDoc = await db.collection('apiKeys').findOne({
      userId: new ObjectId(req.user.id)
    });
    
    if (apiKeyDoc) {
      // Users with API key can generate quizzes without restrictions
      return res.json({ canGenerate: true, hasApiKey: true });
    }
    
    // Check free trial eligibility
    const freeTrialEnabled = user?.freeTrialEnabled || false;
    const freeTrialUsed = user?.freeTrialUsed || 0;
    const freeTrialLimit = user?.freeTrialLimit || 10;
    const freeTrialQuizGenerated = user?.freeTrialQuizGenerated || 0;
    const freeTrialQuizLimit = user?.freeTrialQuizLimit || 1;
    
    // Check if free trial is active
    const canUseFreeTrial = freeTrialEnabled && freeTrialUsed < freeTrialLimit;
    
    if (!canUseFreeTrial) {
      return res.status(400).json({ 
        error: 'Free trial expired. Please add your own API key to continue generating quizzes.' 
      });
    }
    
    // For free trial users, check if they've reached their quiz generation limit
    if (freeTrialQuizGenerated >= freeTrialQuizLimit) {
      return res.status(400).json({ 
        error: `Free trial users can only generate ${freeTrialQuizLimit} quiz(es). Please add your own API key to generate more quizzes.` 
      });
    }
    
    // Increment the quiz generation counter for this free trial user
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { freeTrialQuizGenerated: freeTrialQuizGenerated + 1 } }
    );
    
    // Return success response
    res.json({ 
      success: true, 
      message: 'Quiz generation approved for free trial user',
      freeTrialQuizGenerated: freeTrialQuizGenerated + 1
    });
    
  } catch (error) {
    console.error('Quiz generation check error:', error);
    res.status(500).json({ error: 'Failed to check quiz generation eligibility' });
  }
});

// Analytics API endpoints

// Upsert user in Supabase
app.post('/api/internal/logs/user', authenticateToken, async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    // Verify the user is updating their own record
    if (req.user.id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    // First check if user exists by user_id
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('user_id, email')
      .eq('user_id', userId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      console.error('Error checking existing user:', selectError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingUser) {
      // User exists, update email if different and always update updated_at
      const updateData = { updated_at: new Date().toISOString() };
      
      if (existingUser.email !== email) {
        updateData.email = email;
      }
      
      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to update user:', updateError);
        return res.status(500).json({ error: 'Failed to update user' });
      }
    } else {
      // User doesn't exist, insert new record
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          user_id: userId,
          email: email,
        });

      if (insertError) {
        console.error('Failed to insert user:', insertError);
        return res.status(500).json({ error: 'Failed to create user' });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error upserting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Track event in Supabase
app.post('/api/internal/logs/event', authenticateToken, async (req, res) => {
  try {
    const { eventName, properties, documentId, sessionId } = req.body;
    
    // Verify the user is tracking their own events
    if (req.user.id !== properties.user_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    const event = {
      session_id: sessionId,
      user_id: req.user.id,
      document_id: documentId || null,
      event_name: eventName,
      properties: properties,
    };

    const { error } = await supabase
      .from('user_events')
      .insert([event]);

    if (error) {
      console.error('Failed to track event:', eventName, error);
      return res.status(500).json({ error: 'Failed to track event' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create document in Supabase
app.post('/api/internal/logs/document', authenticateToken, async (req, res) => {
  try {
    const { documentId, fileSizeMb } = req.body;
    
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    const { error } = await supabase
      .from('documents')
      .insert([
        {
          document_id: documentId,
          owner_user_id: req.user.id,
          file_size_mb: fileSizeMb,
          has_annotations: false,
          has_notes: false,
          has_export: false,
        },
      ]);

    if (error) {
      console.error('Failed to create document:', error);
      return res.status(500).json({ error: 'Failed to create document' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document in Supabase
app.patch('/api/internal/logs/document/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { has_annotations, has_notes, has_export } = req.body;
    
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    // First verify the user owns the document
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('owner_user_id')
      .eq('document_id', documentId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.owner_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updates = {};
    if (has_annotations !== undefined) updates.has_annotations = has_annotations;
    if (has_notes !== undefined) updates.has_notes = has_notes;
    if (has_export !== undefined) updates.has_export = has_export;

    const { error: updateError } = await supabase
      .from('documents')
      .update(updates)
      .eq('document_id', documentId);

    if (updateError) {
      console.error('Failed to update document:', updateError);
      return res.status(500).json({ error: 'Failed to update document' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
const startServer = async () => {
  await connectDB()
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
    console.log(`📡 Health check: http://localhost:${PORT}/health`)
  })
}

startServer().catch(console.error)
