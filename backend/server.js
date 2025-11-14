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
// Allow both localhost and 127.0.0.1 for local development
const allowedOrigins = process.env.FRONTEND_URL 
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173', 'http://127.0.0.1:5173']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      // For development, also allow localhost and 127.0.0.1 variations
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    }
  },
  credentials: true
}))
app.use(express.json())

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
})
app.use('/api/', limiter)

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

    // Validate API key format (OpenRouter keys start with sk-or-v1-)
    if (!apiKey.startsWith('sk-or-v1-') && !apiKey.startsWith('sk-')) {
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
app.post('/api/chat', chatLimiter, authenticateToken, async (req, res) => {
  try {
    const { messages, context, model, temperature, maxTokens, stream } = req.body

    // Validate input
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    // Determine which API key to use
    let apiKey
    if (req.user.role === 'admin') {
      // Admin uses predefined key
      apiKey = process.env.ADMIN_OPENROUTER_API_KEY
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
          error: 'API key not configured. Please add your OpenRouter API key in settings.' 
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

    const allMessages = [systemMessage, ...messages]

    // Prepare request to OpenRouter
    const requestBody = {
      model: model || 'openai/gpt-oss-120b',
      messages: allMessages,
      temperature: temperature || 0.7,
      max_tokens: maxTokens || 3000,
      stream: stream || false
    }

    // Make request to OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
        'X-Title': 'ChatNote - PDF Learning Assistant'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return res.status(response.status).json({
        error: error.error?.message || `OpenRouter API error: ${response.status}`
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

