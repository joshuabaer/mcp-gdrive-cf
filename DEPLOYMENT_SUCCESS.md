# 🎉 Deployment Successful!

## Your Worker URL
**`https://mcp-gdrive-cf.brian-money.workers.dev`**

## Next Steps

### 1. Update Google OAuth Redirect URIs

Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)

1. Click on your OAuth 2.0 Client ID
2. Add to **Authorized redirect URIs**:
   ```
   https://mcp-gdrive-cf.brian-money.workers.dev/google/callback
   ```
3. Click **Save**

### 2. Test the Endpoints

#### Health Check
```bash
curl https://mcp-gdrive-cf.brian-money.workers.dev/
```

#### Start OAuth Flow
Visit in your browser:
```
https://mcp-gdrive-cf.brian-money.workers.dev/google/authorize
```

This will:
1. Redirect you to Google for authentication
2. Ask you to grant permissions (Drive readonly + Sheets)
3. Redirect back with a session ID
4. Show you a success page with your session ID

### 3. Copy Your Session ID

After completing OAuth, you'll see a page with:
```
✓ Authentication Successful

You can now use the MCP server with this session ID:
abc-123-def-456...

Add this to your MCP client configuration as a query parameter: ?session=abc-123-def-456
```

**Save this session ID!**

### 4. Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector \
  https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION_ID
```

### 5. Configure Your MCP Client

#### Option A: Direct Connection (if your client supports remote MCP)
```json
{
  "servers": {
    "gdrive": {
      "url": "https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION_ID"
    }
  }
}
```

#### Option B: Via mcp-remote (for Claude Desktop, etc.)
```json
{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp-gdrive-cf.brian-money.workers.dev/sse?session=YOUR_SESSION_ID"
      ]
    }
  }
}
```

## Available Tools

Once connected, you'll have access to 4 tools:

1. **gdrive_search** - Search for files in Google Drive
   ```json
   {
     "query": "name contains 'report'",
     "pageSize": 10
   }
   ```

2. **gdrive_read_file** - Read file contents
   ```json
   {
     "fileId": "1abc123...",
     "mimeType": "text/markdown"
   }
   ```

3. **gsheets_read** - Read spreadsheet data
   ```json
   {
     "spreadsheetId": "1abc123...",
     "ranges": ["Sheet1!A1:B10"]
   }
   ```

4. **gsheets_update_cell** - Update a cell
   ```json
   {
     "spreadsheetId": "1abc123...",
     "range": "Sheet1!A1",
     "value": "Hello World"
   }
   ```

## Troubleshooting

### If OAuth fails:
- Check that you added the correct redirect URI
- Make sure your Google Cloud project has Drive API and Sheets API enabled
- Verify your OAuth consent screen is configured

### If tools return errors:
- Make sure you completed the OAuth flow and have a valid session ID
- Check that your Google account has access to the files/sheets you're trying to access
- Tokens are valid for 30 days and refresh automatically

## Monitoring

View your Worker logs:
```bash
npx wrangler tail
```

## Update Deployment

To deploy changes:
```bash
npx wrangler deploy
```

## Success! 🚀

Your MCP Google Drive server is now live and ready to use!
