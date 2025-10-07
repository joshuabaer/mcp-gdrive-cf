# Manual Setup Guide for Remote VSCode

Since you're working in a remote VSCode instance, here's a streamlined manual setup process:

## Step 1: Create KV Namespace

Run this command and note the ID:
```bash
npx wrangler kv:namespace create KV_TOKENS
```

Copy the `id` value from the output (looks like: `abc123def456...`)

## Step 2: Update wrangler.toml

Edit `wrangler.toml` and replace this line:
```toml
id = "placeholder-kv-id"
```

With your actual KV ID:
```toml
id = "your-actual-kv-id-here"
```

Also add your Google Client ID:
```toml
[vars]
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
```

## Step 3: Set Client Secret

Run this command and paste your Google Client Secret when prompted:
```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## Step 4: Start Dev Server

```bash
npm start
```

The server will start at `http://localhost:8788`

## Step 5: Authenticate

Since you're on a remote instance, you'll need to:

1. The dev server URL will be accessible via VSCode's port forwarding
2. Click the forwarded port link in VSCode (usually shows a popup)
3. Or manually forward port 8788 and access it
4. Visit the OAuth URL: `http://localhost:8788/google/authorize`
5. Complete the OAuth flow in your browser
6. Copy the session ID from the success page

## Step 6: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:8788/sse?session=YOUR_SESSION_ID
```

---

**Quick Commands (Copy & Paste)**

```bash
# 1. Create KV namespace
npx wrangler kv:namespace create KV_TOKENS

# 2. Edit wrangler.toml manually with your KV ID and Client ID

# 3. Set client secret
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 4. Start server
npm start
```
