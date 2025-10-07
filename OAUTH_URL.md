# Remote VSCode - Cloudflare OAuth URLs

When you see "Failed to open" in the terminal, **copy the entire OAuth URL** and paste it in your **local browser**.

## Latest OAuth URL:
```
https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=54d11594-84e4-41aa-b438-e81b8fa78ee7&redirect_uri=http%3A%2F%2Flocalhost%3A8976%2Foauth%2Fcallback&scope=account%3Aread%20user%3Aread%20workers%3Awrite%20workers_kv%3Awrite%20workers_routes%3Awrite%20workers_scripts%3Awrite%20workers_tail%3Aread%20d1%3Awrite%20pages%3Awrite%20zone%3Aread%20ssl_certs%3Awrite%20ai%3Awrite%20queues%3Awrite%20pipelines%3Awrite%20secrets_store%3Awrite%20containers%3Awrite%20cloudchamber%3Awrite%20connectivity%3Aadmin%20offline_access&state=WiPItIKVEP~2lga0Ocr4T81rkj.Ua49p&code_challenge=e4Ueg8H0JtZ4-WP73c6W_N0WQYY3bWl40RYBtGfOHFY&code_challenge_method=S256
```

## Steps:
1. Copy the URL above
2. Paste it in your local browser
3. Complete the Cloudflare OAuth
4. The terminal should then continue automatically

## Alternative: Use API Token
If OAuth keeps failing, use an API token instead:

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Create Token → "Edit Cloudflare Workers" template
3. Copy the token
4. Run: `export CLOUDFLARE_API_TOKEN=your_token_here`
5. Then run: `npx wrangler deploy`
