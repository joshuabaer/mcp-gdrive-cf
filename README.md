# mcp-gdrive-cf

Remote MCP server for Google Drive and Sheets running on Cloudflare Workers with full OAuth 2.0 support.

**Production Ready** ✅ | **11 Tools** | **OAuth 2.0** | **PKCE** | **Global Edge Network**

Adapted from [isaacphi/mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) to run as a remote HTTP/SSE MCP server on Cloudflare's edge network with complete OAuth 2.0 authorization server capabilities.

---

## 🚀 Quick Start

\`\`\`bash
# 1. Clone and install
git clone https://github.com/brianmoney/mcp-gdrive-cf.git
cd mcp-gdrive-cf
npm install

# 2. Create KV namespaces
wrangler kv:namespace create KV_TOKENS
wrangler kv:namespace create KV_CLIENTS

# 3. Update wrangler.toml with your namespace IDs

# 4. Configure Google OAuth credentials
wrangler secret put GOOGLE_CLIENT_SECRET

# 5. Deploy
wrangler deploy

# 6. Test with MCP Inspector
npx @modelcontextprotocol/inspector https://your-worker.workers.dev/sse
\`\`\`

---

## ✨ Features

### Drive Operations
- 🔍 **Search** - Basic and advanced search with filters (MIME type, owner, dates, shared drives)
- 📄 **Read** - Read any file with 22+ export formats (PDF, DOCX, XLSX, Markdown, etc.)
- 📁 **Create Folders** - Organize files with nested folder structures
- ⬆️ **Upload** - Upload files up to 5MB
- 🗑️ **Delete** - Move files to trash
- 📦 **Move** - Reorganize files between folders
- 🔐 **Share** - Add permissions (reader, writer, commenter, owner)

### Sheets Operations
- 📊 **Read** - Batch read multiple ranges
- ✏️ **Update** - Update individual cells
- ➕ **Append** - Add rows to spreadsheets

### Infrastructure
- ☁️ **Global Edge Network** - Runs on Cloudflare Workers worldwide
- 🔐 **OAuth 2.0 Server** - Full authorization server with PKCE support
- 🔑 **Dynamic Client Registration** - Automatic client onboarding
- 🔄 **Auto Token Refresh** - Seamless Google token renewal
- 📡 **SSE Transport** - Real-time Server-Sent Events
- 🛡️ **Secure** - HTTPS only, encrypted token storage

---

## 🎯 What Makes This Different

Unlike the original STDIO-based \`mcp-gdrive\`, this implementation:

1. **Runs remotely** on Cloudflare Workers (no local process)
2. **Full OAuth 2.0** authorization server (not just OAuth client)
3. **Multi-client support** via dynamic client registration
4. **PKCE security** for public clients
5. **22+ export formats** for Drive files
6. **Write operations** (create, delete, move, share, upload)
7. **Production tested** with real workloads

---

## 📋 Prerequisites

### Required
- **Cloudflare Account** with Workers enabled (free tier works)
- **Google Cloud Project** with Drive API and Sheets API enabled
- **Node.js** LTS (v18+)
- **Wrangler CLI** (\`npm install -g wrangler\`)

### Google Cloud Setup

1. Create a project at [Google Cloud Console](https://console.cloud.google.com/)
2. Enable APIs:
   - Google Drive API
   - Google Sheets API
3. Create OAuth 2.0 credentials:
   - Type: **Web application**
   - Redirect URIs: \`https://your-worker.workers.dev/google/callback\`
4. Required OAuth scopes:
   - \`https://www.googleapis.com/auth/drive\`
   - \`https://www.googleapis.com/auth/spreadsheets\`

---

## 🔧 Installation & Deployment

### 1. Install Dependencies

\`\`\`bash
npm install
\`\`\`

### 2. Create KV Namespaces

\`\`\`bash
# For user session tokens
wrangler kv:namespace create KV_TOKENS

# For OAuth client registrations
wrangler kv:namespace create KV_CLIENTS
\`\`\`

Copy the namespace IDs to \`wrangler.toml\`:

\`\`\`toml
[[kv_namespaces]]
binding = "KV_TOKENS"
id = "your-tokens-namespace-id"

[[kv_namespaces]]
binding = "KV_CLIENTS"
id = "your-clients-namespace-id"
\`\`\`

### 3. Configure Environment Variables

Add to \`wrangler.toml\`:

\`\`\`toml
[vars]
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
\`\`\`

Set secrets:

\`\`\`bash
# Google OAuth client secret
wrangler secret put GOOGLE_CLIENT_SECRET
\`\`\`

### 4. Deploy

\`\`\`bash
wrangler deploy
\`\`\`

Your worker will be available at: \`https://your-worker-name.your-account.workers.dev\`

---

## 🔐 OAuth 2.0 Flow

This server implements a **complete OAuth 2.0 authorization server** per the MCP specification.

### Using MCP Inspector

The easiest way to test the OAuth flow:

\`\`\`bash
npx @modelcontextprotocol/inspector https://your-worker.workers.dev/sse
\`\`\`

1. **Discovery** - Inspector auto-discovers OAuth endpoints
2. **Registration** - Click "Guided Setup" → registers client automatically
3. **Authorization** - Redirects to Google → authenticates → redirects back
4. **Token Exchange** - Automatically exchanges code for access token
5. **Use Tools** - All 11 tools now available!

### Security Features

- ✅ **PKCE (RFC 7636)** - Proof Key for Code Exchange
- ✅ **State Parameter** - CSRF protection
- ✅ **HTTPS Only** - Enforced by Cloudflare Workers
- ✅ **Secure Token Storage** - Encrypted in Workers KV
- ✅ **Token Expiration** - Access tokens expire in 1 hour
- ✅ **Client Secret Hashing** - SHA-256 hashed storage
- ✅ **Authorization Code Single-Use** - Codes deleted after exchange

---

## 🛠️ Available Tools

### Drive Tools

- \`gdrive_search\` - Basic search across all files
- \`gdrive_search_advanced\` - Advanced search with filters
- \`gdrive_read_file\` - Read files with 22+ export formats
- \`gdrive_create_folder\` - Create folders
- \`gdrive_upload_file\` - Upload files (up to 5MB)
- \`gdrive_delete_file\` - Move files to trash
- \`gdrive_move_file\` - Move files between folders
- \`gdrive_add_permission\` - Share files/folders
- \`gdrive_list_comments\` - List comments with author, quoted text, and threaded replies
- \`gdrive_list_revisions\` - List revision history with editors and timestamps
- \`gdrive_get_revision\` - Fetch metadata or exported content for a specific revision

### Sheets Tools

- \`gsheets_read\` - Read multiple ranges
- \`gsheets_update_cell\` - Update single cells
- \`gsheets_append_row\` - Append rows

---

## 🔌 Client Configuration

### VS Code with MCP Extension

Create \`.vscode/settings.json\`:

\`\`\`json
{
  "mcp.servers": {
    "gdrive": {
      "url": "https://your-worker.workers.dev/sse",
      "authorization": {
        "type": "oauth2"
      }
    }
  }
}
\`\`\`

### Claude Desktop / Cline

**macOS/Linux:** \`~/Library/Application Support/Claude/claude_desktop_config.json\`  
**Windows:** \`%APPDATA%\\Claude\\claude_desktop_config.json\`

\`\`\`json
{
  "mcpServers": {
    "gdrive": {
      "url": "https://your-worker.workers.dev/sse"
    }
  }
}
\`\`\`

---

## 🧪 Testing

### Local Development

\`\`\`bash
npm start
# Server available at http://localhost:8788
\`\`\`

### Test with MCP Inspector

\`\`\`bash
npx @modelcontextprotocol/inspector http://localhost:8788/sse
\`\`\`

### Check CloudFlare Logs

\`\`\`bash
wrangler tail --format pretty
\`\`\`

---

## 🐛 Troubleshooting

### "Failed to discover OAuth metadata"

**Solution:**
- Ensure \`/.well-known/oauth-authorization-server\` returns valid JSON
- Check CORS headers are present
- Verify latest version is deployed: \`wrangler deploy\`

### "Token exchange failed: HTTP 400"

**Solutions:**
- Check code_verifier matches original code_challenge
- Ensure redirect_uri exactly matches registration
- Verify client credentials are correct
- Check CloudFlare logs: \`wrangler tail\`

### Tools not working

**Solutions:**
- Check Google OAuth scopes include \`drive\` and \`spreadsheets\`
- Re-authenticate if scopes changed: visit \`/google/authorize\`
- Verify Worker has valid Google access token
- Check KV namespace bindings in \`wrangler.toml\`

---

## 📊 Performance & Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| **Request Timeout** | 30 seconds | CloudFlare Workers limit |
| **File Upload** | 5 MB | Simple upload API limit |
| **File Export** | 10 MB | Google Drive export limit |
| **Token Storage** | 30 days | Automatic cleanup |
| **Authorization Code** | 10 minutes | Single-use |
| **Access Token** | 1 hour | Auto-refreshed |

---

## 🔒 Security Best Practices

1. **Never commit secrets** - Use \`wrangler secret put\`
2. **Rotate client secrets** - Periodically regenerate OAuth credentials
3. **Monitor access** - Use CloudFlare Analytics to track usage
4. **Limit OAuth scopes** - Only request necessary Google permissions
5. **Use PKCE** - Always use PKCE for public clients
6. **Validate redirect URIs** - Whitelist exact URIs in Google Console
7. **Enable 2FA** - Protect your CloudFlare and Google accounts

---

## 📄 License

MIT License

---

## 🙏 Acknowledgments

- [isaacphi/mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) - Original STDIO implementation
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [CloudFlare Workers](https://workers.cloudflare.com/) - Serverless platform

---

**Made with ☁️ by [Brian Money](https://github.com/brianmoney)**
