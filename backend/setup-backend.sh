#!/bin/bash

echo "🔧 Backend Setup Helper"
echo "======================"
echo ""

# Check if .env exists
if [ -f ".env" ]; then
    echo "⚠️  .env already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

echo "Step 1: MongoDB Connection String"
echo "----------------------------------"
echo "Paste your MongoDB Atlas connection string:"
echo "(Format: mongodb+srv://username:password@cluster.mongodb.net/mynotes?retryWrites=true&w=majority)"
read -p "MONGODB_URI: " MONGODB_URI

if [ -z "$MONGODB_URI" ]; then
    echo "❌ MongoDB URI cannot be empty!"
    exit 1
fi

echo ""
echo "Step 2: Generate JWT Secret"
echo "---------------------------"
echo "Generating JWT secret..."
JWT_SECRET=$(openssl rand -hex 32)
echo "✅ Generated: $JWT_SECRET"

echo ""
echo "Step 3: Generate Encryption Key"
echo "-------------------------------"
echo "Generating encryption key..."
ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "✅ Generated: $ENCRYPTION_KEY"

echo ""
echo "Step 4: Google Client ID"
echo "------------------------"
read -p "GOOGLE_CLIENT_ID [105659660993-asqa3dlsubs7dadcdcjlee269piun1hr.apps.googleusercontent.com]: " GOOGLE_CLIENT_ID
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-105659660993-asqa3dlsubs7dadcdcjlee269piun1hr.apps.googleusercontent.com}

echo ""
echo "Step 5: Admin Email"
echo "-------------------"
read -p "ADMIN_EMAILS (your email): " ADMIN_EMAILS

if [ -z "$ADMIN_EMAILS" ]; then
    echo "⚠️  Warning: No admin email set. You won't have admin access!"
fi

echo ""
echo "Step 6: Admin API Key (Optional)"
echo "--------------------------------"
read -p "ADMIN_OPENROUTER_API_KEY (press Enter to skip): " ADMIN_API_KEY

echo ""
echo "Step 7: Frontend URL"
echo "--------------------"
read -p "FRONTEND_URL [http://localhost:5173]: " FRONTEND_URL
FRONTEND_URL=${FRONTEND_URL:-http://localhost:5173}

# Create .env file
cat > .env << ENVFILE
# Server Configuration
PORT=3000
NODE_ENV=development

# MongoDB Atlas Connection
MONGODB_URI=$MONGODB_URI

# JWT Secret
JWT_SECRET=$JWT_SECRET

# Google OAuth
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID

# Admin Configuration
ADMIN_EMAILS=$ADMIN_EMAILS

# Admin OpenRouter API Key
ADMIN_OPENROUTER_API_KEY=$ADMIN_API_KEY

# CORS Configuration
FRONTEND_URL=$FRONTEND_URL

# Encryption Key for API Keys
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENVFILE

echo ""
echo "✅ Created .env file!"
echo ""
echo "📝 Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Start server: npm run dev"
echo "3. Test: http://localhost:3000/health"
echo ""
echo "💡 Tip: .env is already in .gitignore, so it won't be committed."
