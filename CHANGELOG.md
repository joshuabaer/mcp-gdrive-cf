# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2025-10-10

### Added - OAuth 2.0 Authorization Server
- **Complete OAuth 2.0 Provider** - Full authorization server implementation per MCP specification
- **Dynamic Client Registration** - RFC 7591 compliant client registration endpoint (`/oauth/register`)
- **PKCE Support** - RFC 7636 Proof Key for Code Exchange with S256 method
- **OAuth Discovery** - RFC 8414 metadata endpoint (`/.well-known/oauth-authorization-server`)
- **Bearer Token Authentication** - Standard `Authorization: Bearer <token>` header support
- **Multi-Client Support** - Isolated credentials and tokens per OAuth client
- **Client Secret Hashing** - SHA-256 hashed storage for security
- **Authorization Code Flow** - Standard OAuth 2.0 code exchange
- **CORS Support** - Full CORS headers for browser-based OAuth clients

### OAuth Endpoints
- `POST /oauth/register` - Register new OAuth clients
- `GET /oauth/authorize` - Authorization endpoint with Google OAuth integration
- `POST /oauth/token` - Token endpoint (supports client_secret_basic and client_secret_post)
- `GET /.well-known/oauth-authorization-server` - OAuth metadata discovery

### Security
- Authorization codes expire in 10 minutes (single-use)
- Access tokens expire in 1 hour
- Client secrets stored as SHA-256 hashes
- PKCE challenge verification
- CSRF protection via state parameter
- Session-based user authentication

### Fixed
- PKCE verification now uses correct base64url encoding
- OAuth callback properly generates authorization codes for MCP clients
- Pending auth state correctly stored and retrieved from KV
- Multiple Set-Cookie headers properly formatted

### Testing
- Verified with MCP Inspector end-to-end OAuth flow
- Production tested with real Google Drive accounts
- All 11 tools operational through OAuth-authenticated connections

## [0.3.0] - 2025-10-07

### Added - Export Formats & Large File Handling
- **22+ Export Formats** for Google Workspace files
  - Google Docs: Plain Text, Markdown, HTML, PDF, DOCX, RTF, EPUB
  - Google Sheets: CSV, TSV, PDF, XLSX, ODS
  - Google Slides: Plain Text, PDF, PPTX, ODP
  - Google Drawings: SVG, PNG, JPEG, PDF
- **Configurable Export MIME Types** - Optional `mimeType` parameter in `gdrive_read_file`
- **File Size Detection** - Automatic detection of 10MB export limit
- **Smart Error Messages** - Helpful guidance for large file fallbacks
- **Format Validation** - Validates requested formats and suggests alternatives

### Changed
- Default export formats:
  - Docs → Markdown (was plain text)
  - Sheets → CSV (unchanged)
  - Slides → Plain text (unchanged)

### Fixed
- Large spreadsheet handling with range-based fallback suggestions
- Export format MIME type validation

## [0.2.0] - 2025-10-07

### Added - Write Operations (Phase 1)
- **gdrive_create_folder** - Create folders with optional parent
- **gdrive_delete_file** - Delete files/folders (moves to trash)
- **gdrive_move_file** - Move files between folders
- **gdrive_search_advanced** - Advanced search with filters:
  - MIME type filtering
  - Owner filtering
  - Modified date range
  - Shared drives support
- **gdrive_upload_file** - Upload files up to 5MB
- **gdrive_add_permission** - Share files with roles (reader, writer, commenter, owner)
- **gsheets_append_row** - Append one or more rows to spreadsheets

### Changed - Breaking
- **OAuth Scope Updated** - Changed from `drive.readonly` to `drive` (full access)
  - ⚠️ Existing users must re-authenticate after upgrading
  - Required to support write operations

### Testing
- All 7 new tools production tested
- Verified against live Google Drive/Sheets APIs
- Error handling validated

## [0.1.0] - 2025-10-06

### Added - Initial Release
- **Remote MCP Server** on Cloudflare Workers
- **SSE Transport** - Server-Sent Events at `/sse`
- **Google OAuth 2.0** - User authentication with automatic token refresh
- **Workers KV Storage** - Token persistence (30-day TTL)
- **Basic Drive Tools**:
  - `gdrive_search` - Search files with query syntax
  - `gdrive_read_file` - Read file content (with export for Docs/Sheets/Slides)
- **Basic Sheets Tools**:
  - `gsheets_read` - Read multiple ranges
  - `gsheets_update_cell` - Update single cells

### Infrastructure
- TypeScript codebase
- Cloudflare Workers runtime
- Direct fetch to Google REST APIs (Drive v3, Sheets v4)
- Health check endpoint at `/`
- Google OAuth endpoints: `/google/authorize`, `/google/callback`

### Security
- OAuth 2.0 with offline access
- Automatic token refresh
- HTTPS only (CloudFlare enforced)
- Session-based authentication
- CSRF protection (state parameter)

---

## Migration Guide

### v0.3.0 → v0.4.0

**No breaking changes** - OAuth 2.0 is additive functionality.

**New Setup Required:**
1. Create second KV namespace for OAuth clients:
   ```bash
   wrangler kv:namespace create KV_CLIENTS
   ```
2. Add to `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "KV_CLIENTS"
   id = "your-clients-namespace-id"
   ```
3. Deploy: `wrangler deploy`

**Client Configuration:**
- Old method (session-based) still works
- New method (OAuth 2.0) recommended for production

### v0.2.0 → v0.3.0

**No breaking changes** - Export formats are optional.

**To Use New Features:**
- Pass `mimeType` parameter to `gdrive_read_file`
- Defaults used if not specified

### v0.1.0 → v0.2.0

**Breaking Change:** OAuth scope changed.

**Migration Steps:**
1. Update to v0.2.0: `git pull && npm install && wrangler deploy`
2. Re-authenticate: Visit `https://your-worker.workers.dev/google/authorize`
3. Update MCP client configuration with new session ID

---

## Version Naming

- **Major** (X.0.0) - Breaking changes requiring code updates
- **Minor** (0.X.0) - New features, backward compatible
- **Patch** (0.0.X) - Bug fixes, no new features

---

[0.4.0]: https://github.com/brianmoney/mcp-gdrive-cf/releases/tag/v0.4.0
[0.3.0]: https://github.com/brianmoney/mcp-gdrive-cf/releases/tag/v0.3.0
[0.2.0]: https://github.com/brianmoney/mcp-gdrive-cf/releases/tag/v0.2.0
[0.1.0]: https://github.com/brianmoney/mcp-gdrive-cf/releases/tag/v0.1.0
