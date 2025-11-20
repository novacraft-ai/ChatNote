/**
 * Quick script to check if required environment variables are set
 * Run: node check-env.js
 */

import dotenv from 'dotenv'

dotenv.config()

const requiredVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'MONGODB_URI',
  'JWT_SECRET',
  'ENCRYPTION_KEY'
]

console.log('🔍 Checking environment variables...\n')

let allSet = true

requiredVars.forEach(varName => {
  const value = process.env[varName]
  if (value) {
    // Mask sensitive values
    const displayValue = varName.includes('SECRET') || varName.includes('KEY') || varName.includes('URI')
      ? value.substring(0, 10) + '...' 
      : value
    console.log(`✅ ${varName}: ${displayValue}`)
  } else {
    console.log(`❌ ${varName}: NOT SET`)
    allSet = false
  }
})

console.log('\n')

if (allSet) {
  console.log('✅ All required environment variables are set!')
} else {
  console.log('❌ Some environment variables are missing.')
  console.log('\nPlease add them to your backend/.env file:')
  console.log('\nExample:')
  console.log('GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com')
  console.log('GOOGLE_CLIENT_SECRET=your-client-secret')
  console.log('GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback')
  console.log('MONGODB_URI=mongodb+srv://...')
  console.log('JWT_SECRET=your-jwt-secret')
  console.log('ENCRYPTION_KEY=your-encryption-key')
}

