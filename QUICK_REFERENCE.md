# MCP Google Drive Server - Quick Reference

## URLs

**Production:** `https://mcp-gdrive-cf.brian-money.workers.dev`  
**Health Check:** `https://mcp-gdrive-cf.brian-money.workers.dev/`  
**OAuth Start:** `https://mcp-gdrive-cf.brian-money.workers.dev/google/authorize`  
**MCP Endpoint:** `https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION_ID`

## VS Code Configuration

File: `.vscode/mcp.json`
```json
{
  "servers": {
    "gdrive": {
      "url": "https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION_ID",
      "type": "http"
    }
  }
}
```

## Available Tools

### gdrive_search
Search for files in Google Drive
```typescript
{
  query: string,        // e.g., "name contains 'report'"
  pageSize?: number,    // default: 100, max: 1000
  pageToken?: string    // for pagination
}
```

### gdrive_read_file
Read content from a Drive file
```typescript
{
  fileId: string,       // Google Drive file ID
  mimeType?: string     // export format for Google Docs/Sheets/Slides
}
```

### gsheets_read
Read data from Google Sheets
```typescript
{
  spreadsheetId: string,
  ranges: string[]      // e.g., ["Sheet1!A1:B10"]
}
```

### gsheets_update_cell
Update a cell in Google Sheets
```typescript
{
  spreadsheetId: string,
  range: string,        // e.g., "A1" or "Sheet1!B2"
  value: string
}
```

## Common Commands

### Deploy
```bash
wrangler deploy
```

### View Logs
```bash
wrangler tail
```

### Test Locally
```bash
npm start
# Server at http://localhost:8788
```

### Check KV Storage
```bash
wrangler kv:key list --namespace-id=151468f26d974c478a360660da60178f
```

### Update Secret
```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```

## OAuth Session

- **Duration:** 30 days
- **Auto-refresh:** Every ~1 hour
- **Re-auth URL:** `/google/authorize`

## Troubleshooting

### Get current session status
```bash
curl "https://mcp-gdrive-cf.brian-money.workers.dev/"
```

### Test initialize
```bash
curl -X POST "https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### Test tool call
```bash
curl -X POST "https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## Environment Variables

**wrangler.toml:**
```toml
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
```

**Secrets (via wrangler):**
- `GOOGLE_CLIENT_SECRET`

## KV Namespace

**Binding:** `KV_TOKENS`  
**ID:** `151468f26d974c478a360660da60178f`  
**Storage:** OAuth tokens with 30-day TTL

## Google OAuth Scopes

- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/spreadsheets`

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| GET | `/sse` | Open SSE connection |
| POST | `/sse` | Send MCP message |
| POST | `/message` | Alternative message endpoint |
| GET | `/google/authorize` | Start OAuth flow |
| GET | `/google/callback` | OAuth redirect |

## File Structure

```
src/
├── index.ts           # HTTP routing
├── mcp.ts            # MCP protocol
├── google.ts         # Google APIs
├── auth-google.ts    # OAuth flow
├── storage.ts        # KV helpers
└── bindings.d.ts     # TypeScript types
```

## Support

- **MCP Spec:** https://modelcontextprotocol.io
- **Cloudflare Docs:** https://developers.cloudflare.com/workers/
- **Google Drive API:** https://developers.google.com/drive/api
- **Google Sheets API:** https://developers.google.com/sheets/api
