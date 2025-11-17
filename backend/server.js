import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import { MongoClient, ObjectId } from 'mongodb'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

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
app.use(express.json({ limit: '50mb' }))

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

/**
 * Two-stage content moderation chain:
 * 1. Prompt Guard: Check for jailbreak attempts
 * 2. Llama Guard: Check for harmful content
 * Only proceeds if both checks pass
 */
async function checkContentModeration(userContent, apiKey) {
  // Skip moderation if disabled
  if (process.env.ENABLE_CONTENT_MODERATION === 'false') {
    return { safe: true }
  }

  try {
    // Extract text content from message (handle both string and array formats)
    let textContent = ''
    if (typeof userContent === 'string') {
      textContent = userContent
    } else if (Array.isArray(userContent)) {
      // For vision models, extract text parts
      const textParts = userContent
        .filter(item => item.type === 'text')
        .map(item => item.text)
      textContent = textParts.join(' ')
    }

    // Skip empty content
    if (!textContent.trim()) {
      return { safe: true }
    }

    // Stage 1: Check for jailbreak attempts using Prompt Guard
    const promptGuardResult = await checkPromptGuard(textContent, apiKey)
    if (!promptGuardResult.safe) {
      return {
        safe: false,
        reason: promptGuardResult.reason,
        stage: 'jailbreak_detection'
      }
    }

    // Stage 2: Check for harmful content using Llama Guard
    const llamaGuardResult = await checkLlamaGuard(textContent, apiKey)
    if (!llamaGuardResult.safe) {
      return {
        safe: false,
        reason: llamaGuardResult.reason,
        stage: 'content_moderation'
      }
    }

    // Both checks passed
    return { safe: true }
  } catch (error) {
    // If moderation check fails, log but allow the request (fail open)
    console.error('Content moderation error:', error)
    return { safe: true }
  }
}

/**
 * Stage 1: Check for jailbreak attempts using Prompt Guard
 * Tries primary model first, falls back to backup model if needed
 */
async function checkPromptGuard(textContent, apiKey) {
  const primaryModel = 'meta-llama/llama-prompt-guard-2-86m'
  const backupModel = 'meta-llama/llama-prompt-guard-2-22m'
  
  // Try primary model first
  const primaryResult = await tryPromptGuardModel(textContent, apiKey, primaryModel, 'primary')
  if (primaryResult.success) {
    return primaryResult.result
  }
  
  // If primary fails, try backup model
  console.warn('Prompt Guard primary model failed, trying backup:', primaryResult.error)
  const backupResult = await tryPromptGuardModel(textContent, apiKey, backupModel, 'backup')
  if (backupResult.success) {
    return backupResult.result
  }
  
  // If both fail, allow request (fail open)
  console.warn('Prompt Guard both models failed, allowing request:', backupResult.error)
  return { safe: true }
}

/**
 * Helper function to try a specific Prompt Guard model
 */
async function tryPromptGuardModel(textContent, apiKey, model, modelType) {
  try {
    const promptGuardRequest = {
      model: model,
      messages: [
        {
          role: 'user',
          content: textContent
        }
      ],
      temperature: 0,
      max_tokens: 50
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(promptGuardRequest)
    })

    // Handle rate limits and errors
    if (response.status === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded',
        result: null
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        result: null
      }
    }

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content || ''
    const resultLower = result.toLowerCase().trim()

    // Prompt Guard typically returns:
    // - "safe" or "Safe" for legitimate prompts
    // - "unsafe" or JSON with violation details for jailbreak attempts
    // - Sometimes structured responses
    
    // Be VERY conservative - only block if response is clearly and unambiguously indicating jailbreak
    // Check for explicit unsafe indicators (exact matches or clear patterns)
    const isExplicitlyUnsafe = resultLower === 'unsafe' ||
                               resultLower === 'jailbreak' ||
                               resultLower.startsWith('unsafe') ||
                               resultLower.startsWith('jailbreak') ||
                               (resultLower.includes('jailbreak') && resultLower.length < 50) || // Short responses with jailbreak
                               (resultLower.includes('unsafe') && !resultLower.includes('safe') && resultLower.length < 50) // Short unsafe without "safe"

    // Explicitly safe indicators - prioritize these
    const isExplicitlySafe = resultLower === 'safe' ||
                            resultLower === 'ok' ||
                            resultLower === 'allowed' ||
                            resultLower.includes('safe') ||
                            resultLower === '' ||
                            resultLower === 'null' ||
                            resultLower.length === 0

    // Default to safe if unclear (fail open - better to allow than block legitimate content)
    // Only block if explicitly unsafe AND not explicitly safe
    const isSafe = isExplicitlySafe || (!isExplicitlyUnsafe)

    if (!isSafe) {
      console.warn('Prompt Guard flagged as jailbreak:', { input: textContent.substring(0, 100), response: result, model: modelType })
    }

    return {
      success: true,
      result: {
        safe: isSafe,
        reason: !isSafe ? result.substring(0, 200) : null
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error',
      result: null
    }
  }
}

/**
 * Stage 2: Check for harmful content using Llama Guard
 * Tries primary model first, falls back to backup model if needed
 */
async function checkLlamaGuard(textContent, apiKey) {
  const primaryModel = 'meta-llama/llama-guard-4-12b'
  const backupModel = 'openai/gpt-oss-safeguard-20b'
  
  // Try primary model first
  const primaryResult = await tryLlamaGuardModel(textContent, apiKey, primaryModel, 'primary')
  if (primaryResult.success) {
    return primaryResult.result
  }
  
  // If primary fails, try backup model
  console.warn('Llama Guard primary model failed, trying backup:', primaryResult.error)
  const backupResult = await tryLlamaGuardModel(textContent, apiKey, backupModel, 'backup')
  if (backupResult.success) {
    return backupResult.result
  }
  
  // If both fail, allow request (fail open)
  console.warn('Llama Guard both models failed, allowing request:', backupResult.error)
  return { safe: true }
}

/**
 * Helper function to try a specific Llama Guard model
 */
async function tryLlamaGuardModel(textContent, apiKey, model, modelType) {
  try {
    const llamaGuardRequest = {
      model: model,
      messages: [
        {
          role: 'user',
          content: textContent
        }
      ],
      temperature: 0,
      max_tokens: 50
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(llamaGuardRequest)
    })

    // Handle rate limits and errors
    if (response.status === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded',
        result: null
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        result: null
      }
    }

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content || ''
    const resultLower = result.toLowerCase().trim()

    // Llama Guard returns responses like:
    // - "safe" or "Safe" for safe content
    // - "unsafe" or JSON with violation categories for unsafe content
    
    // Check if content is explicitly marked as safe
    const isExplicitlySafe = resultLower.trim() === 'safe' || 
                             resultLower.includes('"safe"') ||
                             resultLower.includes("'safe'")
    
    // Check if content is explicitly marked as unsafe
    const isExplicitlyUnsafe = resultLower.includes('unsafe') || 
                               resultLower.includes('harmful') ||
                               resultLower.includes('violation') ||
                               resultLower.includes('inappropriate') ||
                               (resultLower.includes('{') && !isExplicitlySafe) // JSON response usually means unsafe

    // Default to safe if unclear (fail open - better to allow than block legitimate content)
    // Only block if explicitly marked as unsafe
    const isSafe = isExplicitlySafe || (!isExplicitlyUnsafe)

    if (!isSafe) {
      console.warn('Llama Guard flagged as harmful:', { input: textContent.substring(0, 100), response: result, model: modelType })
    }

    return {
      success: true,
      result: {
        safe: isSafe,
        reason: isSafe ? null : result.substring(0, 200) // Limit reason length
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error',
      result: null
    }
  }
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
        createdAt: new Date()
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
        role: user.role
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
        role: user.role
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

    res.json({ hasApiKey: !!apiKeyDoc, isAdmin: false })
  } catch (error) {
    console.error('API key status error:', error)
    res.status(500).json({ error: 'Failed to check API key status' })
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
        return res.status(400).json({ 
          error: 'API key not configured. Please add your Groq API key in settings.' 
        })
      }

      try {
        apiKey = decrypt(apiKeyDoc.encryptedKey, process.env.ENCRYPTION_KEY)
      } catch (error) {
        console.error('Decryption error:', error)
        return res.status(500).json({ error: 'Failed to decrypt API key' })
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

    // Content moderation: Check the latest user message for harmful content
    const latestUserMessage = cleanedMessages
      .filter(msg => msg.role === 'user')
      .pop()
    
    if (latestUserMessage) {
      const moderationResult = await checkContentModeration(latestUserMessage.content, apiKey)
      if (!moderationResult.safe) {
        console.warn('Content moderation flagged message:', {
          userId: req.user.id,
          email: req.user.email,
          stage: moderationResult.stage,
          reason: moderationResult.reason
        })
        
        // Provide specific error message based on which stage failed
        const errorMessage = moderationResult.stage === 'jailbreak_detection'
          ? 'Your message appears to be attempting to bypass system safety measures. Please revise your message and try again.'
          : 'Your message contains content that violates our usage policy. Please revise your message and try again.'
        
        return res.status(400).json({
          error: errorMessage
        })
      }
    }

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
      
      // Log detailed error for debugging (server-side only)
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

