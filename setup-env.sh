#!/bin/bash

# Helper script to set up .env.local file for Google OAuth

echo "🔐 Google OAuth Environment Setup"
echo "=================================="
echo ""

# Check if .env.local already exists
if [ -f ".env.local" ]; then
    echo "⚠️  .env.local already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

echo "Enter your Google OAuth Client ID:"
echo "(Format: 123456789-abcdefghijklmnop.apps.googleusercontent.com)"
read -p "Client ID: " CLIENT_ID

if [ -z "$CLIENT_ID" ]; then
    echo "❌ Client ID cannot be empty!"
    exit 1
fi

echo ""
echo "Enter your backend URL:"
echo "(For local dev, use: http://localhost:3000)"
read -p "Backend URL [http://localhost:3000]: " BACKEND_URL

# Default to localhost if empty
if [ -z "$BACKEND_URL" ]; then
    BACKEND_URL="http://localhost:3000"
fi

# Create .env.local file
cat > .env.local << EOF
# Google OAuth Configuration
VITE_GOOGLE_CLIENT_ID=$CLIENT_ID

# Backend API URL
VITE_BACKEND_URL=$BACKEND_URL
EOF

echo ""
echo "✅ Created .env.local file!"
echo ""
echo "Contents:"
echo "--------"
cat .env.local
echo "--------"
echo ""
echo "📝 Next steps:"
echo "1. Restart your dev server: npm run dev"
echo "2. Open http://localhost:5173"
echo "3. Click 'Sign in with Google'"
echo ""
echo "💡 Tip: .env.local is already in .gitignore, so it won't be committed."

