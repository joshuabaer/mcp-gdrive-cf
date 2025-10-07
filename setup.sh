#!/bin/bash

# MCP Google Drive Cloudflare - Quick Start Setup Script
# This script helps automate the initial setup process

set -e  # Exit on error

echo "════════════════════════════════════════════════════════════"
echo "  MCP Google Drive Cloudflare - Setup Script"
echo "════════════════════════════════════════════════════════════"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Check if wrangler is installed
echo -e "${BLUE}[1/6]${NC} Checking prerequisites..."
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠ Wrangler CLI not found. Installing via npx...${NC}"
else
    echo -e "${GREEN}✓ Wrangler CLI found${NC}"
fi

# Step 2: Create KV namespace
echo ""
echo -e "${BLUE}[2/6]${NC} Creating KV namespace..."
echo -e "${YELLOW}Running: wrangler kv:namespace create KV_TOKENS${NC}"
echo ""
KV_OUTPUT=$(npx wrangler kv:namespace create KV_TOKENS 2>&1 || true)
echo "$KV_OUTPUT"

# Extract KV ID from output
KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+' || echo "")

if [ -n "$KV_ID" ]; then
    echo ""
    echo -e "${GREEN}✓ KV namespace created!${NC}"
    echo -e "${YELLOW}KV Namespace ID: $KV_ID${NC}"
    echo ""
    echo -e "${BLUE}Updating wrangler.toml...${NC}"
    
    # Update wrangler.toml with the actual KV ID
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/id = \"placeholder-kv-id\"/id = \"$KV_ID\"/" wrangler.toml
    else
        # Linux
        sed -i "s/id = \"placeholder-kv-id\"/id = \"$KV_ID\"/" wrangler.toml
    fi
    
    echo -e "${GREEN}✓ wrangler.toml updated${NC}"
else
    echo -e "${YELLOW}⚠ Could not extract KV ID. You may need to update wrangler.toml manually.${NC}"
fi

# Step 3: Google OAuth setup instructions
echo ""
echo -e "${BLUE}[3/6]${NC} Google OAuth Setup"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Please complete the following steps in Google Cloud Console:"
echo ""
echo "1. Go to: https://console.cloud.google.com/"
echo "2. Create a new project (or select existing)"
echo "3. Enable APIs:"
echo "   - Google Drive API"
echo "   - Google Sheets API"
echo ""
echo "4. Create OAuth 2.0 Credentials:"
echo "   - Go to: APIs & Services > Credentials"
echo "   - Create OAuth 2.0 Client ID"
echo "   - Application type: Web application"
echo "   - Authorized redirect URIs:"
echo "     • http://localhost:8788/google/callback (for dev)"
echo ""
echo "5. Configure OAuth consent screen with scopes:"
echo "   - https://www.googleapis.com/auth/drive.readonly"
echo "   - https://www.googleapis.com/auth/spreadsheets"
echo ""
read -p "Press Enter when you have completed Google OAuth setup..."

# Step 4: Collect OAuth credentials
echo ""
echo -e "${BLUE}[4/6]${NC} Configure OAuth Credentials"
echo "════════════════════════════════════════════════════════════"
echo ""
read -p "Enter your Google OAuth Client ID: " CLIENT_ID

if [ -n "$CLIENT_ID" ]; then
    # Update wrangler.toml with client ID
    if grep -q "GOOGLE_CLIENT_ID" wrangler.toml; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|# GOOGLE_CLIENT_ID = \"...\"|GOOGLE_CLIENT_ID = \"$CLIENT_ID\"|" wrangler.toml
        else
            sed -i "s|# GOOGLE_CLIENT_ID = \"...\"|GOOGLE_CLIENT_ID = \"$CLIENT_ID\"|" wrangler.toml
        fi
    else
        echo "GOOGLE_CLIENT_ID = \"$CLIENT_ID\"" >> wrangler.toml
    fi
    echo -e "${GREEN}✓ Client ID saved to wrangler.toml${NC}"
fi

echo ""
echo "Now setting the Client Secret (will be stored securely)..."
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Step 5: Test local setup
echo ""
echo -e "${BLUE}[5/6]${NC} Testing Local Setup"
echo "════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}Starting local development server...${NC}"
echo -e "Press Ctrl+C to stop the server when done testing"
echo ""
echo "To test:"
echo "1. Visit: http://localhost:8788/google/authorize"
echo "2. Complete OAuth flow"
echo "3. Copy the session ID"
echo "4. Test with MCP Inspector:"
echo "   npx @modelcontextprotocol/inspector http://localhost:8788/sse?session=YOUR_SESSION_ID"
echo ""
read -p "Press Enter to start the dev server (Ctrl+C to exit)..."

npm start

# Step 6: Deployment instructions
echo ""
echo -e "${BLUE}[6/6]${NC} Deployment"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "To deploy to Cloudflare Workers:"
echo ""
echo "  npm run deploy"
echo ""
echo "After deployment:"
echo "1. Update Google OAuth redirect URI with production URL"
echo "2. Test OAuth flow at: https://your-worker.workers.dev/google/authorize"
echo "3. Configure your MCP client with:"
echo "   https://your-worker.workers.dev/sse?session=YOUR_SESSION_ID"
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  • Review SETUP.md for detailed instructions"
echo "  • Check STRUCTURE.md for architecture details"
echo "  • See CHECKLIST.md for testing tasks"
echo ""
