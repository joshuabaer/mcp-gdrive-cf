# Project Structure

```
mcp-gdrive-cf/
├── .github/
│   └── instructions/          # Implementation plans and instructions
├── src/
│   ├── index.ts              # Main entry point, routing
│   ├── mcp.ts                # MCP server implementation, tool registry
│   ├── google.ts             # Google Drive/Sheets API helpers
│   ├── auth-google.ts        # Google OAuth flow handlers
│   ├── storage.ts            # KV storage helpers
│   └── bindings.d.ts         # TypeScript type definitions for Env
├── wrangler.toml             # Cloudflare Workers configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies and scripts
├── README.md                 # Project overview
├── SETUP.md                  # Detailed setup instructions
└── .gitignore                # Git ignore rules

```

## Key Files

### `src/index.ts`
- **Purpose**: Main worker entry point
- **Routes**:
  - `GET /sse` - MCP SSE transport endpoint
  - `GET /google/authorize` - Start Google OAuth flow
  - `GET /google/callback` - Handle OAuth callback
  - `GET /` - Health check / server info
  - `POST /token` - (Future) Client OAuth token exchange
  - `POST /register` - (Future) Dynamic client registration

### `src/mcp.ts`
- **Purpose**: MCP protocol implementation
- **Functions**:
  - `handleMcpRequest()` - Process incoming MCP requests
  - `routeMcpRequest()` - Route to appropriate MCP method handler
  - `handleToolCall()` - Execute tool calls
  - Tool definitions for all 4 tools
- **MCP Methods**:
  - `initialize` - Server initialization
  - `tools/list` - List available tools
  - `tools/call` - Execute a tool

### `src/google.ts`
- **Purpose**: Google API integration
- **Tools Implemented**:
  - `gdriveSearch()` - Search Drive files
  - `gdriveReadFile()` - Read file content with export support
  - `gsheetsRead()` - Read spreadsheet data
  - `gsheetsUpdateCell()` - Update cell values
- **Helpers**:
  - `googleApiRequest()` - Authenticated API calls with auto-refresh

### `src/auth-google.ts`
- **Purpose**: Google OAuth 2.0 flow
- **Functions**:
  - `handleGoogleAuthorize()` - Generate OAuth URL and redirect
  - `handleGoogleCallback()` - Exchange code for tokens
  - `refreshAccessToken()` - Refresh expired access tokens
- **Security**: CSRF protection via state parameter

### `src/storage.ts`
- **Purpose**: Workers KV operations
- **Functions**:
  - `getUserToken()` - Retrieve user tokens from KV
  - `updateUserToken()` - Store/update user tokens in KV
  - `deleteUserToken()` - Remove user tokens from KV
- **Storage Format**: `user:<userId>` → `{ google: { access_token, refresh_token, expiry, scopes } }`

### `src/bindings.d.ts`
- **Purpose**: TypeScript type definitions
- **Types**:
  - `Env` - Cloudflare Worker environment bindings
  - `UserTokenData` - User token storage structure
  - `GoogleTokenData` - Google OAuth token data
  - `SessionData` - Session information

### `wrangler.toml`
- **Purpose**: Cloudflare Workers configuration
- **Contents**:
  - Worker name and entry point
  - KV namespace bindings
  - Environment variables
  - Compatibility settings

## Data Flow

### Authentication Flow
```
1. User → GET /google/authorize
2. Server → Redirect to Google OAuth
3. User → Completes OAuth on Google
4. Google → Redirect to /google/callback?code=xxx
5. Server → Exchange code for tokens
6. Server → Store tokens in KV
7. Server → Return session ID to user
```

### MCP Request Flow
```
1. Client → POST /sse?session=xxx (MCP request)
2. Server → Validate session
3. Server → Retrieve tokens from KV
4. Server → Route MCP request
5. Server → Execute tool (call Google API)
6. Google API → Return data
7. Server → Format as MCP response
8. Server → Return to client
```

### Token Refresh Flow
```
1. Tool call → googleApiRequest()
2. Check token expiry
3. If expired → refreshAccessToken()
4. Use refresh_token to get new access_token
5. Update KV with new access_token
6. Retry original API request
```

## Environment Variables

### Required in `wrangler.toml`
- `GOOGLE_CLIENT_ID` - Google OAuth client ID (public)

### Required as Wrangler Secrets
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (sensitive)

### Optional
- `SESSION_SECRET` - For signing session cookies (future)
- `OAUTH_CLIENT_ID` - For client OAuth (future)
- `OAUTH_CLIENT_SECRET` - For client OAuth (future)

## KV Namespaces

### `KV_TOKENS`
- **Purpose**: Store user OAuth tokens
- **Key Format**: `user:<userId>`
- **Value Format**: JSON string of `UserTokenData`
- **TTL**: 30 days (2,592,000 seconds)

## Dependencies

### Runtime Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol implementation

### Development Dependencies
- `@cloudflare/workers-types` - TypeScript types for Workers
- `typescript` - TypeScript compiler
- `wrangler` - Cloudflare Workers CLI
- `vitest` - Testing framework

## Scripts

```bash
npm start          # Start local dev server (wrangler dev)
npm run dev        # Alias for start
npm run deploy     # Deploy to Cloudflare
npm test           # Run tests (when implemented)
```

## Future Enhancements

### Planned Features
- [ ] Client OAuth implementation (`/authorize`, `/token`, `/register`)
- [ ] Proper session management with signed cookies
- [ ] User info endpoint to get Google user details
- [ ] Additional tools (file upload, folder operations, sharing)
- [ ] Rate limiting per user/tool
- [ ] Logging and monitoring
- [ ] Error tracking (Sentry, etc.)
- [ ] Unit and integration tests
- [ ] Support for service account auth (organization-wide)

### Security Improvements
- [ ] PKCE for OAuth flow
- [ ] Signed session cookies
- [ ] Token encryption in KV
- [ ] IP allowlisting
- [ ] Request signing
- [ ] Audit logging

### Performance Optimizations
- [ ] Cache Google API responses
- [ ] Batch API requests
- [ ] Streaming large file exports
- [ ] Connection pooling
