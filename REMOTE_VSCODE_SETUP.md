# Quick Fix for Remote VSCode Setup

## Problem
Wrangler v4 can't automatically open OAuth links in a remote VSCode environment.

## Solution

### Step 1: Authenticate with Cloudflare

Run this command:
```bash
npx wrangler login
```

When it shows "Failed to open", **copy the full OAuth URL** from the terminal output.

It looks like:
```
https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=...
```

**Paste that URL in your local browser**, complete the OAuth, and the terminal should continue.

### Step 2: Create KV Namespace

Once logged in, run:
```bash
npx wrangler kv namespace create KV_TOKENS
```

Copy the `id` value from the output.

### Step 3: Update wrangler.toml

I see you already have the Client ID set. Now just update the KV namespace ID:

```bash
# Open wrangler.toml and replace:
id = "placeholder-kv-id"

# With your actual KV ID from step 2
```

### Step 4: Set Google Client Secret

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Paste your Google OAuth Client Secret when prompted.

### Step 5: Start the Dev Server

```bash
npm start
```

The server will be at `http://localhost:8788` (forwarded through VSCode)

### Step 6: Authenticate with Google

1. VSCode will show a port forwarding notification - click it
2. Or check the PORTS tab in VSCode to access the forwarded port
3. Navigate to `/google/authorize` 
4. Complete Google OAuth
5. Copy the session ID

### Step 7: Test

```bash
npx @modelcontextprotocol/inspector http://localhost:8788/sse?session=YOUR_SESSION_ID
```

---

## Quick Command Reference

```bash
# Authenticate with Cloudflare (copy the URL if it doesn't open)
npx wrangler login

# Create KV namespace
npx wrangler kv namespace create KV_TOKENS

# Set secret
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Start dev server
npm start
```
