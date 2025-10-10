/**
 * Google OAuth 2.0 flow implementation
 * Handles authorization, token exchange, and refresh
 */

import { Env, UserTokenData, GoogleTokenData } from './bindings';
import { getUserToken, updateUserToken } from './storage';

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Required scopes for Drive and Sheets
// Note: Changed from drive.readonly to drive to support write operations
// (create, delete, move, upload, share)
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

/**
 * Handle Google OAuth authorization redirect
 */
export function handleGoogleAuthorize(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const pendingAuth = url.searchParams.get('pending_auth');

  // Generate state parameter for CSRF protection
  const state = crypto.randomUUID();

  // Build authorization URL
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${origin}/google/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  // Set cookies - need multiple Set-Cookie headers for multiple cookies
  const headers = new Headers({
    'Location': authUrl.toString(),
  });
  
  headers.append('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  
  if (pendingAuth) {
    console.log('Storing pending_auth in cookie:', pendingAuth);
    headers.append('Set-Cookie', `pending_auth=${pendingAuth}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  }

  // Set state in cookie for verification
  // Create a new Response with headers instead of modifying immutable redirect
  return new Response(null, {
    status: 302,
    headers,
  });
}

/**
 * Handle Google OAuth callback
 */
export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Check for errors
  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  // Verify state parameter (CSRF protection)
  const cookies = request.headers.get('Cookie') || '';
  console.log('Google callback - Cookies received:', cookies);
  
  const stateCookie = cookies
    .split(';')
    .find((c) => c.trim().startsWith('oauth_state='))
    ?.split('=')[1];
    
  const pendingAuthCookie = cookies
    .split(';')
    .find((c) => c.trim().startsWith('pending_auth='))
    ?.split('=')[1];

  console.log('Google callback - State cookie:', stateCookie);
  console.log('Google callback - Pending auth cookie:', pendingAuthCookie);

  if (state !== stateCookie) {
    return new Response('Invalid state parameter', { status: 400 });
  }

  // Exchange code for tokens
  const origin = `${url.protocol}//${url.host}`;
  const tokenData = await exchangeCodeForToken(code, origin, env);

  // Generate user ID (for now, use a simple session ID)
  // In production, this should be based on the Google user ID from the token
  const userId = crypto.randomUUID();

  // Store tokens in KV
  await updateUserToken(userId, { google: tokenData }, env);

  // Check if this is part of an OAuth client flow
  if (pendingAuthCookie) {
    console.log('Found pending auth cookie, looking up:', pendingAuthCookie);
    const pendingAuthData = await env.KV_CLIENTS.get(`pending_auth:${pendingAuthCookie}`);
    console.log('Pending auth data from KV:', pendingAuthData ? 'Found' : 'Not found');
    
    if (pendingAuthData) {
      const pendingAuth = JSON.parse(pendingAuthData);
      console.log('Pending auth details:', { 
        client_id: pendingAuth.client_id, 
        redirect_uri: pendingAuth.redirect_uri 
      });
      
      // Generate authorization code
      const authCode = crypto.randomUUID();
      const authCodeData = {
        code: authCode,
        client_id: pendingAuth.client_id,
        user_id: userId,
        redirect_uri: pendingAuth.redirect_uri,
        code_challenge: pendingAuth.code_challenge,
        code_challenge_method: pendingAuth.code_challenge_method,
        scopes: ['mcp'],
        expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
      };
      
      await env.KV_CLIENTS.put(
        `authcode:${authCode}`,
        JSON.stringify(authCodeData),
        { expirationTtl: 10 * 60 }
      );
      
      // Clean up pending auth
      await env.KV_CLIENTS.delete(`pending_auth:${pendingAuthCookie}`);
      
      // Redirect back to OAuth client with authorization code
      const redirectUrl = new URL(pendingAuth.redirect_uri);
      redirectUrl.searchParams.set('code', authCode);
      if (pendingAuth.state) {
        redirectUrl.searchParams.set('state', pendingAuth.state);
      }
      
      return new Response(null, {
        status: 302,
        headers: {
          'Location': redirectUrl.toString(),
          'Set-Cookie': `session=${userId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`, // 30 days
        },
      });
    }
  }

  // Set session cookie
  const response = new Response(
    `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
        .success { color: #059669; font-size: 24px; margin-bottom: 20px; }
        .code { background: #f3f4f6; padding: 10px; border-radius: 5px; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="success">✓ Authentication Successful</div>
      <p>You can now use the MCP server with this session ID:</p>
      <div class="code">${userId}</div>
      <p>Add this to your MCP client configuration as a query parameter: <code>?session=${userId}</code></p>
      <p>Or set it as a cookie named <code>session</code></p>
    </body>
    </html>
    `,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': `session=${userId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`, // 30 days
      },
    }
  );

  return response;
}

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForToken(
  code: string,
  origin: string,
  env: Env
): Promise<GoogleTokenData> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${origin}/google/callback`,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorData}`);
  }

  const data: any = await response.json();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + data.expires_in * 1000,
    scopes: data.scope?.split(' ') || GOOGLE_SCOPES,
    token_type: data.token_type,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(userId: string, env: Env): Promise<UserTokenData> {
  const tokenData = await getUserToken(userId, env);

  if (!tokenData?.google?.refresh_token) {
    throw new Error('No refresh token available');
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: tokenData.google.refresh_token,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorData}`);
  }

  const data: any = await response.json();

  // Update token data
  const updatedTokenData: UserTokenData = {
    google: {
      access_token: data.access_token,
      refresh_token: tokenData.google.refresh_token, // Keep existing refresh token
      expiry: Date.now() + data.expires_in * 1000,
      scopes: tokenData.google.scopes,
      token_type: data.token_type,
    },
  };

  // Store updated tokens
  await updateUserToken(userId, updatedTokenData, env);

  return updatedTokenData;
}
