---
applyTo: '**'
---
Implementation Plan — Run mcp-gdrive as a Remote MCP Server on Cloudflare (via MCP proxy)

Objective

Adapt the functionality of isaacphi/mcp-gdrive to run as a remote MCP server on Cloudflare Workers, reachable by any MCP client through the Cloudflare remote MCP pattern (direct, or bridged via mcp-remote). This plan directly addresses the auth / dynamic registration concerns raised in issue #19 by exposing proper OAuth endpoints and remote transport.

0) Architecture

Runtime: Cloudflare Worker exposing an MCP Server‑Sent Events (SSE) endpoint at /sse.

MCP tools (parity with mcp-gdrive):

gdrive_search → Drive files.list (query, pageToken, pageSize)

gdrive_read_file → Drive files.get?alt=media and files.export for Docs/Sheets/Slides

gsheets_read → Sheets spreadsheets.values.batchGet (or spreadsheets.get when needed)

gsheets_update_cell → Sheets spreadsheets.values.update (valueInputOption=USER_ENTERED)

Auth layers:

Client → MCP server: optional OAuth (server acts as OAuth provider for remote MCP clients). Endpoints: /authorize, /token, /register.

MCP server → Google APIs: OAuth 2.0 “Web application” flow. Tokens stored per user.

State: user token blobs in Workers KV (namespace KV_TOKENS).

Compatibility: Remote‑capable clients connect directly; local‑only clients (e.g., Claude Desktop) use mcp-remote:

{
  "mcpServers": {
    "gdrive": {
      "command": "npx",
      "args": ["mcp-remote", "https://<worker>.<acct>.workers.dev/sse"]
    }
  }
}

1) Prerequisites

Cloudflare account with Workers enabled; node LTS; wrangler CLI.

Google Cloud project with Drive API and Sheets API enabled; OAuth consent configured.

OAuth scopes: https://www.googleapis.com/auth/drive.readonly, https://www.googleapis.com/auth/spreadsheets.

2) Scaffold the Remote MCP Server

Start from Cloudflare’s remote MCP template (authless)

npm create cloudflare@latest -- my-mcp-server \
  --template=cloudflare/ai/demos/remote-mcp-authless
cd my-mcp-server
npm start   # local dev at http://localhost:8788/sse
npx wrangler@latest deploy

(Optional but recommended) Spin a second project using the GitHub OAuth template to see a working auth’d remote MCP, then port the auth pattern to your gdrive server:

npm create cloudflare@latest -- my-mcp-server-github-auth \
  --template=cloudflare/ai/demos/remote-mcp-github-oauth

This shows how the server wires OAuth + Dynamic Client Registration with SSE at /sse and auth endpoints (/authorize, /token, /register).

3) Project Layout

/src
  index.ts              # routes: /sse, /google/authorize, /google/callback; wires OAuth provider
  mcp.ts                # tool registry + router (gdrive + gsheets)
  google.ts             # Google REST helpers (Drive/Sheets)
  auth-google.ts        # OAuth URL builder, token exchange, refresh
  storage.ts            # KV helpers (get/set user tokens)
wrangler.toml           # KV bindings, vars, routes
bindings.d.ts           # Env types for KV + secrets
README.md               # quickstart + client config (mcp-remote)

4) Google OAuth (server → Google)

Create OAuth Client: type Web application. Redirect URI: https://<worker>.<acct>.workers.dev/google/callback (plus a localhost variant for dev if needed).

Server endpoints:

GET /google/authorize → redirect user to Google with Drive/Sheets scopes.

GET /google/callback → exchange code for {access_token, refresh_token, expiry}; persist to KV under the authenticated user.

Token storage: KV key user:<provider>:<sub> -> { google: { refresh_token, access_token, expiry, scopes } }.

Refresh: On 401 from Google APIs, auto‑refresh using the stored refresh_token and update KV.

For early iterations, you can skip client OAuth entirely and only run the Google OAuth flow the first time a user calls a tool; maintain a signed session cookie or URL parameter to correlate the token set with the client identity.

5) Client Authentication (optional now, recommended soon)

Enable OAuth for clients connecting to your MCP server, so remote clients can discover /authorize, perform dynamic client registration at /register, and obtain access tokens from /token. Use the pattern from the Cloudflare OAuth template:

// src/index.ts (sketch)
import { Router } from "./mcp";
import GitHubHandler from "./github-handler"; // or Google/Auth0/WorkOS/etc.
import OAuthProvider from "./oauth-provider";

export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: Router,
  defaultHandler: GitHubHandler,   // swap to Google or your IdP when ready
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

This resolves the “Cannot perform dynamic registration without authorization URL” class of failures by making the endpoints discoverable and functional.

6) Implement the Tools (Worker‑native)

Prefer direct fetch to Google REST endpoints in the Worker runtime (avoid Node‑only libs).

gdrive_search

Request: GET https://www.googleapis.com/drive/v3/files with q, pageSize, pageToken, fields.

Response: normalize to { id, name, mimeType, modifiedTime, owners }[] + nextPageToken.

gdrive_read_file

Branch by MIME:

Google Docs/Sheets/Slides: files.export(fileId, exportMime). Common mimes: Docs→text/markdown, Sheets→text/csv, Slides→text/plain.

Binary/other: files.get?alt=media.

Note: export payload limit is 10 MB; chunking isn’t supported by files.export. Consider fallbacks (e.g., read smaller ranges for Sheets via Sheets API).

gsheets_read

Paths: spreadsheets.values.batchGet with an array of A1 ranges; or spreadsheets.get when you need sheet metadata.

Response: emit a simple { range, values }[] structure.

gsheets_update_cell

Path: spreadsheets.values.update with valueInputOption=USER_ENTERED.

Input: { spreadsheetId, range, value } (coerce to [[value]]).

Response: updatedRange, updatedRows, and optionally updatedData when includeValuesInResponse=true.

7) KV & Secrets

wrangler.toml (excerpt):

name = "gdrive-remote-mcp"
main = "src/index.ts"
compatibility_date = "2025-08-20"

[[kv_namespaces]]
binding = "KV_TOKENS"
id = "<kv-namespace-id>"

[vars]
GOOGLE_CLIENT_ID = "..."
# Secrets below are set via `wrangler secret put` at deploy time

Secrets:

wrangler secret put GOOGLE_CLIENT_SECRET

8) HTTP Surfaces (routes)

GET /sse — MCP transport (SSE).

GET /authorize — Client OAuth authorize (optional; for client→server auth).

POST /token — Token exchange for client OAuth (optional).

POST /register — Dynamic client registration (optional).

GET /google/authorize — Begin Google OAuth for Drive/Sheets.

GET /google/callback — Handle Google OAuth callback.

9) Testing & Validation

Local: npm start → connect with the MCP Inspector (npx @modelcontextprotocol/inspector) to http://localhost:8788/sse; list tools; invoke gdrive_search on a simple query.

Remote: wrangler deploy; test the deployed URL in Inspector.

Bridge: configure Claude Desktop (or Cursor/Windsurf) using mcp-remote to the Worker URL; validate OAuth prompts and tool invocations.

Drive/Sheets: verify Docs export, large file handling, multiple range reads, and a write with USER_ENTERED.

10) Security Hardening

Keep scopes minimal (drive.readonly + spreadsheets).

Never log token bodies; redact PII in logs.

Rate limit tool invocations; cap read sizes for exports.

Optionally front the Worker with Cloudflare Access/Zero Trust or an MCP Server Portal for org‑level policy.

Rotate OAuth client secrets; support token revocation (KV delete) per user.

11) Rollout Checklist



12) Code Sketches

Google token exchange (callback)

export async function googleCallback(req: Request, env: Env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const userKey = await requireUserIdentity(req, env); // your session mapping
  const body = new URLSearchParams({
    code: code!,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${origin(req)}/google/callback`,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tok = await r.json();
  await env.KV_TOKENS.put(userKey, JSON.stringify({ google: tok }), { expirationTtl: 60 * 60 * 24 * 30 });
  return new Response("OK. You can close this window.");
}

Drive export helper

async function exportGoogleDoc(fileId: string, mime: string, accessToken: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mime)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`export failed ${r.status}`);
  return await r.text();
}

Sheets update helper

async function updateCell(spreadsheetId: string, range: string, value: string, token: string) {
  const body = { values: [[value]] };
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sheet update failed ${r.status}`);
  return await r.json();
}

13) Edge Cases & Gotchas

Dynamic registration error: expose /authorize, /token, /register so remote MCP clients can register and authenticate. When bridging with mcp-remote, you still need those endpoints if the upstream client expects OAuth.

Redirect URIs: for Google, the redirect URI must exactly match what you configured; use HTTPS in production and add localhost redirects for dev.

files.export** limits**: 10 MB cap on exported content. For big Sheets, prefer values.batchGet for page‑sized reads.

Shared Drives: ensure the querying account has access; consider supportsAllDrives=true and includeItemsFromAllDrives=true on Drive queries if you later add that feature.

Runtime constraints: avoid Node‑specific libraries (use fetch + small helpers). Use jose only if you later add service accounts/JWTs.

14) Useful Links (for implementers)

Cloudflare: Remote MCP server guide — https://developers.cloudflare.com/agents/guides/remote-mcp-server/

Cloudflare: Test a Remote MCP Server — https://developers.cloudflare.com/agents/guides/test-remote-mcp-server/

MCP Authorization spec — https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization

mcp-gdrive repo (tools & scopes) — https://github.com/isaacphi/mcp-gdrive

Workers KV quickstart — https://developers.cloudflare.com/kv/get-started/

Google OAuth 2.0 (web server apps) — https://developers.google.com/identity/protocols/oauth2/web-server

Drive files.export reference — https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export

Sheets values.batchGet — https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet

Sheets values.update — https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update

15) Next Steps

Wire tracing/metrics (e.g., request counters per tool, error rate, P95 latencies).

Add organization controls (Cloudflare Access, server portal) and per‑user/tool policy.

Expand toolset (append rows; batch updates; Drive files.list with Drive‑shared toggles; search helpers for mime/time).