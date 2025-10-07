# mcp-gdrive-cf

Remote MCP server for Google Drive and Sheets running on Cloudflare Workers.

Adapted from [isaacphi/mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) to run as a remote HTTP/SSE MCP server on Cloudflare's edge network.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yourusername/mcp-gdrive-cf.git
cd mcp-gdrive-cf
npm install

# 2. Create KV namespace and configure secrets
wrangler kv:namespace create KV_TOKENS
wrangler secret put GOOGLE_CLIENT_SECRET

# 3. Deploy
wrangler deploy

# 4. Authenticate
# Visit https://your-worker.workers.dev/google/authorize
# Copy your session ID

# 5. Use in VS Code
# Add to .vscode/mcp.json:
# {
#   "servers": {
#     "gdrive": {
#       "url": "https://your-worker.workers.dev/sse?session=YOUR_SESSION_ID",
#       "type": "http"
#     }
#   }
# }
```

## Features

- 🔍 **gdrive_search** - Search for files in Google Drive
- 📄 **gdrive_read_file** - Read content from Drive files (with export for Docs/Sheets/Slides)
- 📊 **gsheets_read** - Read data from Google Sheets
- ✏️ **gsheets_update_cell** - Update cell values in Sheets
- ☁️ **Remote Access** - Works from any MCP client over HTTP/SSE
- 🔐 **Secure** - OAuth 2.0 with automatic token refresh
- ⚡ **Fast** - Runs on Cloudflare's global edge network

## Architecture

- **Runtime**: Cloudflare Workers
- **Transport**: Server-Sent Events (SSE) at `/sse`
- **Auth**: Google OAuth 2.0 (tokens stored in Workers KV)
- **APIs**: Direct fetch to Google Drive v3 and Sheets v4 REST APIs

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Google Cloud Project** with:
   - Drive API enabled
   - Sheets API enabled
   - OAuth 2.0 credentials (Web application type)
3. **Node.js** LTS and **wrangler** CLI

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create KV Namespace

```bash
wrangler kv:namespace create KV_TOKENS
```

Update `wrangler.toml` with the namespace ID returned.

### 3. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google Drive API
   - Google Sheets API
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Choose **Web application** as the application type
6. Add authorized redirect URIs:
   - Development: `http://localhost:8788/google/callback`
   - Production: `https://<your-worker>.workers.dev/google/callback`
7. Note your **Client ID** and **Client Secret**
8. Set the client ID in `wrangler.toml` under `[vars]`
9. Set the client secret:

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```

**Required OAuth Scopes:**
- `https://www.googleapis.com/auth/drive.readonly` - Read Drive files
- `https://www.googleapis.com/auth/spreadsheets` - Read/write Sheets

### 4. Set Environment Variables

Add to `wrangler.toml`:

```toml
[vars]
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
```

## Development

### Local Development

```bash
npm start
# or
wrangler dev
```

The server will be available at `http://localhost:8788`

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:8788/sse?session=YOUR_SESSION_ID
```

### Authenticate with Google

1. Visit `http://localhost:8788/google/authorize` (or your deployed worker URL)
2. Sign in with your Google account and grant permissions
3. You'll be redirected to a success page showing your **session ID**
4. Copy the session ID and add it to your MCP client configuration

**Note:** The session ID is like an API key - keep it secure and don't share it publicly.

## Deployment

```bash
npm run deploy
# or
wrangler deploy
```

## Usage with MCP Clients

### VS Code (Direct HTTP Connection)

Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "gdrive": {
      "url": "https://<your-worker>.workers.dev/sse?session=YOUR_SESSION_ID",
      "type": "http"
    }
  }
}
```

### Claude Desktop / Cline (Via mcp-remote Bridge)

Edit your MCP settings file:

**macOS/Linux:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-worker>.workers.dev/sse?session=YOUR_SESSION_ID"]
    }
  }
}
```

### Direct Connection (Remote MCP capable clients)

For clients that support HTTP/SSE transport directly, configure them to connect to:

```
https://<your-worker>.workers.dev/sse?session=YOUR_SESSION_ID
```

## API Endpoints

- `GET /` - Health check / server info
- `GET /sse` - MCP SSE endpoint (Streamable HTTP transport)
- `POST /sse` - Send MCP JSON-RPC messages
- `POST /message` - Alternative message endpoint (for SSE+POST pattern)
- `GET /google/authorize` - Start Google OAuth flow
- `GET /google/callback` - OAuth callback handler (receives OAuth code)

## Project Structure

```
/src
  index.ts          # Main worker entry point, HTTP routing
  mcp.ts            # MCP protocol implementation (SSE + JSON-RPC)
  google.ts         # Google Drive/Sheets API helpers
  auth-google.ts    # OAuth 2.0 flow (authorize, callback, refresh)
  storage.ts        # KV storage helpers for user tokens
  bindings.d.ts     # TypeScript definitions for Cloudflare bindings
wrangler.toml       # Cloudflare Workers configuration
package.json        # Dependencies and scripts
tsconfig.json       # TypeScript configuration
```

## Tool Reference

### gdrive_search

Search for files in Google Drive.

**Parameters:**
- `query` (string, required) - Search query (e.g., `"name contains 'report'"`)
- `pageSize` (number) - Results per page (default: 100, max: 1000)
- `pageToken` (string) - Pagination token

### gdrive_read_file

Read content from a Google Drive file.

**Parameters:**
- `fileId` (string, required) - Google Drive file ID
- `mimeType` (string) - Export MIME type for Google Docs/Sheets/Slides

### gsheets_read

Read data from Google Sheets.

**Parameters:**
- `spreadsheetId` (string, required) - Spreadsheet ID
- `ranges` (array, required) - Array of A1 notation ranges

### gsheets_update_cell

Update a cell in Google Sheets.

**Parameters:**
- `spreadsheetId` (string, required) - Spreadsheet ID
- `range` (string, required) - A1 notation range
- `value` (string, required) - Value to write

## Troubleshooting

### "Waiting for server to respond to `initialize` request"

This usually means the MCP client can't connect to the server. Check:
- Is the worker URL correct in your MCP configuration?
- Did you deploy the latest version? (`wrangler deploy`)
- Does your session ID exist and have valid tokens?
- Try accessing the health endpoint: `https://<worker>/` (should return JSON)

### "Unauthorized" or "Missing session identifier"

Your session ID is missing or invalid:
- Make sure you've completed the OAuth flow at `/google/authorize`
- Check that your session ID is included in the URL: `?session=YOUR_SESSION_ID`
- Sessions expire after 30 days - re-authenticate if needed

### "Not authenticated with Google"

Your Google OAuth tokens are missing or expired:
1. Re-authenticate at `https://<worker>/google/authorize`
2. Get a new session ID
3. Update your MCP client configuration

### "Sheets API error: 400 Bad Request"

When updating cells, make sure:
- The range format is correct (e.g., `A1`, `Sheet1!B2:C5`)
- You have write permissions to the spreadsheet
- The spreadsheet ID is valid

### Testing the Worker Directly

Test the initialize request with curl:

```bash
curl -X POST "https://<worker>/sse?session=YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Expected response:
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"mcp-gdrive-cf","version":"0.1.0"}}}
```

## Contributing

Contributions are welcome! This project follows the MCP specification for remote servers.

## Related Projects

- [MCP Specification](https://modelcontextprotocol.io) - Model Context Protocol documentation
- [mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) - Original STDIO-based MCP server
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless execution environment

## OAuth Session Duration

**Session Cookie:** 30 days
- The session cookie that identifies your MCP client expires after 30 days

**Token Storage:** 30 days
- OAuth tokens are stored in Cloudflare KV with a 30-day TTL
- After 30 days, you'll need to re-authenticate by visiting `/google/authorize`

**Access Token:** ~1 hour
- Google access tokens expire every hour
- **Automatically refreshed** using the refresh token (no user action required)

**Refresh Token:** Indefinite (until revoked)
- Obtained during OAuth with `access_type: offline`
- Allows automatic access token renewal for the duration of the session

To re-authenticate after 30 days:
1. Visit `https://<your-worker>.workers.dev/google/authorize`
2. Complete the OAuth flow
3. Update your MCP client configuration with the new session ID

## Security

- OAuth tokens stored in KV with 30-day TTL
- Automatic access token refresh every hour
- HTTPS only in production (enforced by Cloudflare Workers)
- CSRF protection via state parameter in OAuth flow
- Minimal OAuth scopes:
  - `https://www.googleapis.com/auth/drive.readonly` - Read-only Drive access
  - `https://www.googleapis.com/auth/spreadsheets` - Read/write Sheets access
- Session-based authentication using secure HTTP-only cookies
- No token data exposed to client

## License

MIT
