# Architecture Diagrams

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Client                              │
│                  (Claude Desktop, Cursor, etc.)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ MCP Protocol (SSE)
                         │ https://worker.dev/sse?session=xxx
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  Cloudflare Worker                              │
│                  (mcp-gdrive-cf)                                │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Router     │  │  MCP Server  │  │ Google APIs  │         │
│  │  (index.ts)  │──│   (mcp.ts)   │──│ (google.ts)  │         │
│  └──────────────┘  └──────────────┘  └──────┬───────┘         │
│         │                                    │                  │
│         │                                    │                  │
│  ┌──────▼───────┐  ┌──────────────┐        │                  │
│  │ OAuth Flow   │  │   Storage    │        │                  │
│  │(auth-google) │  │ (storage.ts) │        │                  │
│  └──────────────┘  └──────┬───────┘        │                  │
│                            │                 │                  │
└────────────────────────────┼─────────────────┼──────────────────┘
                             │                 │
                             │                 │
                    ┌────────▼─────┐  ┌────────▼─────────┐
                    │ Workers KV   │  │  Google APIs     │
                    │ (KV_TOKENS)  │  │ (Drive & Sheets) │
                    └──────────────┘  └──────────────────┘
```

## Request Flow - Tool Execution

```
┌──────────┐
│  Client  │
└─────┬────┘
      │
      │ 1. POST /sse?session=abc123
      │    { method: "tools/call", params: { name: "gdrive_search", ... }}
      │
┌─────▼────────────────────────────────────────────────┐
│  index.ts - Router                                   │
│  • Parse URL and method                              │
│  • Apply CORS headers                                │
│  • Route to handleMcpRequest()                       │
└─────┬────────────────────────────────────────────────┘
      │
      │ 2. Validate session
      │
┌─────▼────────────────────────────────────────────────┐
│  mcp.ts - MCP Server                                 │
│  • Extract session ID from request                   │
│  • getUserIdentity() validates session               │
│  • Check for Google token in KV                      │
└─────┬────────────────────────────────────────────────┘
      │
      │ 3. Get user token
      │
┌─────▼────────────────────────────────────────────────┐
│  storage.ts - KV Operations                          │
│  • getUserToken(userId)                              │
│  • Retrieve from KV: user:abc123                     │
│  • Parse JSON: { google: { access_token, ... }}      │
└─────┬────────────────────────────────────────────────┘
      │
      │ 4. Return token data
      │
┌─────▼────────────────────────────────────────────────┐
│  mcp.ts - Route to Tool                              │
│  • routeMcpRequest() parses method                   │
│  • handleToolCall() routes to specific tool          │
│  • Call gdriveSearch(args, userId, env)              │
└─────┬────────────────────────────────────────────────┘
      │
      │ 5. Execute tool
      │
┌─────▼────────────────────────────────────────────────┐
│  google.ts - Google API Integration                  │
│  • gdriveSearch() called                             │
│  • googleApiRequest() with auto-refresh              │
│  • Check token expiry                                │
│  • If expired: refreshAccessToken()                  │
└─────┬────────────────────────────────────────────────┘
      │
      │ 6. Call Google API
      │    GET https://www.googleapis.com/drive/v3/files
      │    Authorization: Bearer <access_token>
      │
┌─────▼────────────────────────────────────────────────┐
│  Google Drive API                                    │
│  • Process search query                              │
│  • Return matching files                             │
└─────┬────────────────────────────────────────────────┘
      │
      │ 7. Return results
      │    { files: [...], nextPageToken: "..." }
      │
┌─────▼────────────────────────────────────────────────┐
│  google.ts - Format Response                         │
│  • Normalize API response                            │
│  • Return { files: [...], nextPageToken: ... }       │
└─────┬────────────────────────────────────────────────┘
      │
      │ 8. Format as MCP response
      │
┌─────▼────────────────────────────────────────────────┐
│  mcp.ts - MCP Response                               │
│  • Format as MCP tool response                       │
│  • { content: [{ type: "text", text: "..." }] }      │
└─────┬────────────────────────────────────────────────┘
      │
      │ 9. Return to client
      │    JSON response
      │
┌─────▼────┐
│  Client  │
└──────────┘
```

## OAuth Flow - Initial Authentication

```
┌──────────┐
│   User   │
└─────┬────┘
      │
      │ 1. Visit /google/authorize in browser
      │
┌─────▼────────────────────────────────────────────────┐
│  auth-google.ts - handleGoogleAuthorize()            │
│  • Generate state (CSRF token)                       │
│  • Build Google OAuth URL with scopes                │
│  • Set state cookie                                  │
│  • Redirect to Google                                │
└─────┬────────────────────────────────────────────────┘
      │
      │ 2. Redirect to Google OAuth
      │    https://accounts.google.com/o/oauth2/v2/auth
      │    ?client_id=...&redirect_uri=.../callback
      │    &scope=drive.readonly+spreadsheets
      │
┌─────▼────────────────────────────────────────────────┐
│  Google OAuth Server                                 │
│  • User logs in                                      │
│  • User grants permissions                           │
│  • Generate authorization code                       │
└─────┬────────────────────────────────────────────────┘
      │
      │ 3. Redirect back with code
      │    .../callback?code=xxx&state=yyy
      │
┌─────▼────────────────────────────────────────────────┐
│  auth-google.ts - handleGoogleCallback()             │
│  • Verify state matches cookie (CSRF check)          │
│  • Exchange code for tokens                          │
└─────┬────────────────────────────────────────────────┘
      │
      │ 4. Exchange code for tokens
      │    POST https://oauth2.googleapis.com/token
      │    { code, client_id, client_secret, ... }
      │
┌─────▼────────────────────────────────────────────────┐
│  Google Token Server                                 │
│  • Validate code                                     │
│  • Return tokens                                     │
│    { access_token, refresh_token, expires_in, ... }  │
└─────┬────────────────────────────────────────────────┘
      │
      │ 5. Store tokens
      │
┌─────▼────────────────────────────────────────────────┐
│  storage.ts - updateUserToken()                      │
│  • Generate userId (UUID)                            │
│  • Store in KV: user:abc123 → token data            │
│  • Set 30-day TTL                                    │
└─────┬────────────────────────────────────────────────┘
      │
      │ 6. Return success page with session ID
      │
┌─────▼────┐
│   User   │
│  Copies  │
│ Session  │
└──────────┘
```

## Token Refresh Flow

```
┌─────────────────────────────────────────────────────┐
│  Tool execution in progress...                      │
│  googleApiRequest() called                          │
└─────┬───────────────────────────────────────────────┘
      │
      │ 1. Check token expiry
      │    if (tokenData.google.expiry < Date.now())
      │
      ├─── Token Valid ─────┐
      │                     │
      │                     │ 2a. Use existing token
      │                     │     Make API request
      │                     │
      └─── Token Expired ───┤
                            │
                            │ 2b. Refresh token needed
                            │
┌───────────────────────────▼─────────────────────────┐
│  auth-google.ts - refreshAccessToken()              │
│  • Get refresh_token from KV                        │
│  • Call Google token endpoint                       │
└───────────────────────────┬─────────────────────────┘
                            │
                            │ 3. Request new access token
                            │    POST /token
                            │    { refresh_token, client_id, ... }
                            │
┌───────────────────────────▼─────────────────────────┐
│  Google Token Server                                │
│  • Validate refresh_token                           │
│  • Generate new access_token                        │
│  • Return { access_token, expires_in, ... }         │
└───────────────────────────┬─────────────────────────┘
                            │
                            │ 4. Update stored tokens
                            │
┌───────────────────────────▼─────────────────────────┐
│  storage.ts - updateUserToken()                     │
│  • Update KV with new access_token                  │
│  • Keep existing refresh_token                      │
│  • Update expiry timestamp                          │
└───────────────────────────┬─────────────────────────┘
                            │
                            │ 5. Retry original API request
                            │    with new access_token
                            │
┌───────────────────────────▼─────────────────────────┐
│  Google API                                         │
│  • Accept request with new token                    │
│  • Return data                                      │
└─────────────────────────────────────────────────────┘
```

## Data Storage Structure

```
Workers KV Namespace: KV_TOKENS
├── Key: "user:abc-123-def-456"
│   Value: {
│     "google": {
│       "access_token": "ya29.a0AfH6...",
│       "refresh_token": "1//0gK9xZ...",
│       "expiry": 1704067200000,
│       "scopes": [
│         "https://www.googleapis.com/auth/drive.readonly",
│         "https://www.googleapis.com/auth/spreadsheets"
│       ],
│       "token_type": "Bearer"
│     }
│   }
│   TTL: 30 days (2,592,000 seconds)
│
├── Key: "user:xyz-789-uvw-012"
│   Value: { ... }
│   TTL: 30 days
│
└── ... (one entry per user)
```

## Tool Execution Matrix

```
┌────────────────────┬──────────────────┬─────────────────────┐
│      Tool          │   Google API     │    Parameters       │
├────────────────────┼──────────────────┼─────────────────────┤
│ gdrive_search      │ Drive files.list │ query, pageSize,    │
│                    │                  │ pageToken           │
├────────────────────┼──────────────────┼─────────────────────┤
│ gdrive_read_file   │ Drive files.get  │ fileId, mimeType    │
│                    │ files.export     │ (for Google Docs)   │
├────────────────────┼──────────────────┼─────────────────────┤
│ gsheets_read       │ Sheets values    │ spreadsheetId,      │
│                    │ .batchGet        │ ranges[]            │
├────────────────────┼──────────────────┼─────────────────────┤
│ gsheets_update_cell│ Sheets values    │ spreadsheetId,      │
│                    │ .update          │ range, value        │
└────────────────────┴──────────────────┴─────────────────────┘
```

## Security Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: HTTPS/TLS                                 │
│  • All traffic encrypted                            │
│  • Cloudflare automatic HTTPS                       │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  Layer 2: Session Validation                        │
│  • Session ID required for all MCP requests         │
│  • Validated against KV storage                     │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  Layer 3: CSRF Protection                           │
│  • State parameter in OAuth flow                    │
│  • State cookie verification                        │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  Layer 4: OAuth Scopes                              │
│  • Minimal scopes (drive.readonly + spreadsheets)   │
│  • User consent required                            │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  Layer 5: Token Management                          │
│  • Tokens stored in KV (not exposed to client)      │
│  • 30-day TTL on stored tokens                      │
│  • Automatic refresh on expiry                      │
└─────────────────────────────────────────────────────┘
```
