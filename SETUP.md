# Setup Guide for mcp-gdrive-cf

This guide walks you through setting up the MCP Google Drive server on Cloudflare Workers.

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create Cloudflare KV Namespace

Create a KV namespace for storing user OAuth tokens:

```bash
npx wrangler kv:namespace create KV_TOKENS
```

This will output something like:
```
🌀 Creating namespace with title "mcp-gdrive-cf-KV_TOKENS"
✨ Success!
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "KV_TOKENS"
id = "abc123..."
```

**Action Required:** Copy the `id` value and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV_TOKENS"
id = "your-actual-kv-id-here"  # Replace this!
```

## Step 3: Set Up Google Cloud Project

### 3.1 Create/Select Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one

### 3.2 Enable APIs

Enable the following APIs:
- Google Drive API
- Google Sheets API

Navigate to: **APIs & Services > Library** and search for each API to enable them.

### 3.3 Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External** user type (or Internal if you have a Google Workspace)
3. Fill in the required fields:
   - App name: `MCP Google Drive Server`
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/spreadsheets`
5. Add test users (your Google account email) if in testing mode

### 3.4 Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `MCP GDrive CF Worker`
5. Authorized redirect URIs:
   - For local dev: `http://localhost:8788/google/callback`
   - For production: `https://mcp-gdrive-cf.<your-account>.workers.dev/google/callback`
6. Click **Create**
7. **Save** the Client ID and Client Secret

## Step 4: Configure Environment Variables

### 4.1 Set Google Client ID

Edit `wrangler.toml` and add:

```toml
[vars]
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
```

### 4.2 Set Google Client Secret (Secret)

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

When prompted, paste your Google Client Secret.

## Step 5: Test Locally

Start the development server:

```bash
npm start
```

The server will be available at `http://localhost:8788`

### 5.1 Authenticate with Google

1. Open browser: `http://localhost:8788/google/authorize`
2. Complete the OAuth flow
3. Copy the session ID from the success page
4. Test the SSE endpoint: `http://localhost:8788/sse?session=YOUR_SESSION_ID`

### 5.2 Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:8788/sse?session=YOUR_SESSION_ID
```

In the inspector:
1. Click "Connect"
2. List tools - should see 4 tools (gdrive_search, gdrive_read_file, gsheets_read, gsheets_update_cell)
3. Test a tool like `gdrive_search` with query: `"name contains 'test'"`

## Step 6: Deploy to Cloudflare

Deploy the worker:

```bash
npm run deploy
```

After deployment, you'll get a URL like: `https://mcp-gdrive-cf.<your-account>.workers.dev`

### 6.1 Update Google OAuth Redirect URIs

1. Go back to Google Cloud Console
2. Edit your OAuth 2.0 Client
3. Add the production redirect URI: `https://mcp-gdrive-cf.<your-account>.workers.dev/google/callback`
4. Save

### 6.2 Authenticate on Production

1. Visit: `https://mcp-gdrive-cf.<your-account>.workers.dev/google/authorize`
2. Complete OAuth flow
3. Save the session ID

## Step 7: Configure MCP Client

### Option A: Direct Connection (Remote MCP capable)

If your MCP client supports remote servers directly, configure it with:
- URL: `https://mcp-gdrive-cf.<your-account>.workers.dev/sse?session=YOUR_SESSION_ID`

### Option B: Via mcp-remote (Claude Desktop, etc.)

Edit your MCP client configuration (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp-gdrive-cf.<your-account>.workers.dev/sse?session=YOUR_SESSION_ID"
      ]
    }
  }
}
```

## Troubleshooting

### Issue: "Unauthorized" error

- Make sure you've completed the OAuth flow at `/google/authorize`
- Verify the session ID is correct
- Check that the session cookie is being sent

### Issue: "redirect_uri_mismatch" error

- Verify the redirect URI in Google Cloud Console exactly matches your Worker URL
- Include the `/google/callback` path
- Use `https://` for production (not `http://`)

### Issue: "Access denied" error

- Check that you've enabled the Drive API and Sheets API in Google Cloud Console
- Verify the OAuth scopes are correct
- Make sure your Google account is added as a test user if the app is in testing mode

### Issue: KV namespace not found

- Run `npx wrangler kv:namespace create KV_TOKENS` if you haven't already
- Update the `id` in `wrangler.toml` with the actual namespace ID
- Redeploy: `npm run deploy`

### Issue: Token expired

The system should automatically refresh tokens. If you get persistent token errors:
1. Delete the old session from KV
2. Re-authenticate at `/google/authorize`

## Security Notes

- **Never commit** `GOOGLE_CLIENT_SECRET` to version control
- Use Wrangler secrets for sensitive values
- Tokens are stored in KV with a 30-day TTL
- Consider implementing rate limiting for production use
- Review Google Cloud Console audit logs periodically

## Next Steps

- Implement client OAuth for multi-user scenarios
- Add more tools (file upload, folder operations, etc.)
- Set up monitoring and alerting
- Add rate limiting
- Implement proper session management with signed cookies
