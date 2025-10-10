/**
 * OAuth 2.0 Client Authentication Module
 * Implements dynamic client registration, authorization, and token endpoints
 * per the MCP Authorization specification
 */

import { Env, ClientRegistration, AuthorizationCode, AccessToken } from './bindings';

/**
 * CORS headers for OAuth endpoints
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Generate a cryptographically secure random string
 */
async function generateSecureToken(length: number = 32): Promise<string> {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a SHA-256 hash of a string
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Handle dynamic client registration
 * POST /oauth/register
 */
export async function handleClientRegistration(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as {
      redirect_uris?: string[];
      client_name?: string;
    };

    // Validate redirect URIs
    if (!body.redirect_uris || body.redirect_uris.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'redirect_uris is required',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Validate redirect URIs format
    for (const uri of body.redirect_uris) {
      try {
        new URL(uri);
      } catch {
        return new Response(
          JSON.stringify({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`,
          }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Generate client credentials
    const client_id = `mcp_${await generateSecureToken(16)}`;
    const client_secret = await generateSecureToken(32);

    // Store client registration
    const registration: ClientRegistration = {
      client_id,
      client_secret: await sha256(client_secret), // Store hashed secret
      redirect_uris: body.redirect_uris,
      client_name: body.client_name,
      created_at: Date.now(),
    };

    await env.KV_CLIENTS.put(
      `client:${client_id}`,
      JSON.stringify(registration),
      { expirationTtl: 60 * 60 * 24 * 365 } // 1 year
    );

    // Return client credentials (secret is only shown once)
    return new Response(
      JSON.stringify({
        client_id,
        client_secret, // Return plain secret (not hashed)
        redirect_uris: body.redirect_uris,
        client_name: body.client_name,
        created_at: registration.created_at,
      }),
      { status: 201, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Client registration error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle authorization request
 * GET /oauth/authorize
 */
export async function handleAuthorize(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const client_id = url.searchParams.get('client_id');
  const redirect_uri = url.searchParams.get('redirect_uri');
  const response_type = url.searchParams.get('response_type');
  const state = url.searchParams.get('state');
  const code_challenge = url.searchParams.get('code_challenge');
  const code_challenge_method = url.searchParams.get('code_challenge_method');

  // Validate required parameters
  if (!client_id || !redirect_uri || response_type !== 'code') {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'Missing or invalid required parameters',
      }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // Verify client exists
  const clientData = await env.KV_CLIENTS.get(`client:${client_id}`);
  if (!clientData) {
    return new Response(
      JSON.stringify({
        error: 'invalid_client',
        error_description: 'Unknown client_id',
      }),
      { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const client: ClientRegistration = JSON.parse(clientData);

  // Verify redirect_uri is registered
  if (!client.redirect_uris.includes(redirect_uri)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uri not registered for this client',
      }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // PKCE validation (recommended but optional)
  if (code_challenge && code_challenge_method !== 'S256') {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'Only S256 code_challenge_method is supported',
      }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // Check if user is authenticated (has valid Google OAuth session)
  // For now, we'll require user to authenticate via Google first
  const sessionCookie = request.headers.get('Cookie')?.match(/session_id=([^;]+)/)?.[1];
  let userId: string | null = null;

  if (sessionCookie) {
    const sessionData = await env.KV_TOKENS.get(`session:${sessionCookie}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      userId = session.userId;
    }
  }

  if (!userId) {
    // Store OAuth client request parameters for after Google auth
    const pendingAuthId = await generateSecureToken(16);
    const pendingAuthKey = `pending_auth:${pendingAuthId}`;
    const pendingAuth = {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      timestamp: Date.now(),
    };
    
    await env.KV_CLIENTS.put(
      pendingAuthKey,
      JSON.stringify(pendingAuth),
      { expirationTtl: 10 * 60 } // 10 minutes
    );
    
    // User needs to authenticate first - redirect to Google OAuth
    const googleAuthUrl = new URL(request.url);
    googleAuthUrl.pathname = '/google/authorize';
    // Pass only the ID part, not the full key
    googleAuthUrl.searchParams.set('pending_auth', pendingAuthId);
    
    return new Response(null, {
      status: 302,
      headers: {
        ...CORS_HEADERS,
        Location: googleAuthUrl.toString(),
        'Content-Type': 'text/html',
      },
    });
  }

  // Generate authorization code
  const code = await generateSecureToken(32);
  const authCode: AuthorizationCode = {
    code,
    client_id,
    user_id: userId,
    redirect_uri,
    code_challenge: code_challenge || undefined,
    code_challenge_method: code_challenge_method || undefined,
    scopes: ['mcp'], // Default scope
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
  };

  await env.KV_CLIENTS.put(
    `authcode:${code}`,
    JSON.stringify(authCode),
    { expirationTtl: 10 * 60 } // 10 minutes
  );

  // Redirect back to client with authorization code
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...CORS_HEADERS,
      Location: redirectUrl.toString(),
    },
  });
}

/**
 * Handle token request
 * POST /oauth/token
 */
export async function handleToken(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const contentType = request.headers.get('Content-Type');
    let params: Record<string, string>;

    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      params = {};
      const urlParams = new URLSearchParams(text);
      urlParams.forEach((value, key) => {
        params[key] = value;
      });
    } else if (contentType?.includes('application/json')) {
      params = await request.json();
    } else {
      return new Response(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Content-Type must be application/x-www-form-urlencoded or application/json',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    let {
      grant_type,
      code,
      redirect_uri,
      client_id,
      client_secret,
      code_verifier,
    } = params;

    // Support client_secret_basic authentication (Authorization header)
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Basic ')) {
      try {
        const base64Credentials = authHeader.substring(6);
        const credentials = atob(base64Credentials);
        const [headerClientId, headerClientSecret] = credentials.split(':', 2);
        
        // Prefer credentials from header (client_secret_basic method)
        // This is what MCP Inspector uses
        client_id = headerClientId;
        client_secret = headerClientSecret;
      } catch (error) {
        console.error('Failed to parse Authorization header:', error);
        return new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Invalid Authorization header format',
          }),
          { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate grant_type
    if (grant_type !== 'authorization_code') {
      return new Response(
        JSON.stringify({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code grant type is supported',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required parameters
    if (!code || !redirect_uri || !client_id || !client_secret) {
      console.error('Missing parameters:', { 
        hasCode: !!code, 
        hasRedirectUri: !!redirect_uri, 
        hasClientId: !!client_id, 
        hasClientSecret: !!client_secret 
      });
      return new Response(
        JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required parameters: code, redirect_uri, client_id, and client_secret are required',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Verify client credentials
    const clientData = await env.KV_CLIENTS.get(`client:${client_id}`);
    if (!clientData) {
      console.error('Client not found:', client_id);
      return new Response(
        JSON.stringify({
          error: 'invalid_client',
          error_description: 'Unknown client_id',
        }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const client: ClientRegistration = JSON.parse(clientData);
    const hashedSecret = await sha256(client_secret);
    
    console.log('Token request - Client validation:', {
      client_id,
      hashedSecretMatch: client.client_secret === hashedSecret,
      storedSecretPrefix: client.client_secret.substring(0, 8)
    });
    
    if (client.client_secret !== hashedSecret) {
      console.error('Client secret mismatch for client:', client_id);
      return new Response(
        JSON.stringify({
          error: 'invalid_client',
          error_description: 'Invalid client_secret',
        }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Retrieve authorization code
    console.log('Looking up authorization code:', code.substring(0, 10) + '...');
    const authCodeData = await env.KV_CLIENTS.get(`authcode:${code}`);
    if (!authCodeData) {
      console.error('Authorization code not found in KV');
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const authCode: AuthorizationCode = JSON.parse(authCodeData);
    console.log('Authorization code validation:', {
      codeClientId: authCode.client_id,
      requestClientId: client_id,
      clientIdMatch: authCode.client_id === client_id,
      codeRedirectUri: authCode.redirect_uri,
      requestRedirectUri: redirect_uri,
      redirectUriMatch: authCode.redirect_uri === redirect_uri,
      expired: authCode.expires_at < Date.now(),
      expiresAt: new Date(authCode.expires_at).toISOString()
    });

    // Verify authorization code
    if (
      authCode.client_id !== client_id ||
      authCode.redirect_uri !== redirect_uri ||
      authCode.expires_at < Date.now()
    ) {
      await env.KV_CLIENTS.delete(`authcode:${code}`);
      console.error('Authorization code validation failed');
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Authorization code validation failed',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Verify PKCE if code_challenge was used
    if (authCode.code_challenge) {
      console.log('PKCE verification - code_challenge present:', authCode.code_challenge.substring(0, 20) + '...');
      
      if (!code_verifier) {
        console.error('PKCE verification failed - no code_verifier provided');
        return new Response(
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'code_verifier is required',
          }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // Compute SHA256 of the verifier
      const encoder = new TextEncoder();
      const data = encoder.encode(code_verifier);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      
      // Convert to base64url
      const base64 = btoa(String.fromCharCode(...hashArray));
      const computedChallengeB64 = base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      console.log('PKCE verification:', {
        storedChallenge: authCode.code_challenge.substring(0, 20) + '...',
        computedChallenge: computedChallengeB64.substring(0, 20) + '...',
        match: authCode.code_challenge === computedChallengeB64
      });

      if (authCode.code_challenge !== computedChallengeB64) {
        await env.KV_CLIENTS.delete(`authcode:${code}`);
        console.error('PKCE verification failed - challenge mismatch');
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'PKCE verification failed',
          }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('PKCE verification passed');
    }

    // Delete used authorization code
    await env.KV_CLIENTS.delete(`authcode:${code}`);

    // Generate access token
    const access_token = await generateSecureToken(32);
    const tokenData: AccessToken = {
      token: access_token,
      client_id,
      user_id: authCode.user_id,
      scopes: authCode.scopes,
      expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
      token_type: 'Bearer',
    };

    await env.KV_CLIENTS.put(
      `token:${access_token}`,
      JSON.stringify(tokenData),
      { expirationTtl: 60 * 60 } // 1 hour
    );

    // Return token response
    return new Response(
      JSON.stringify({
        access_token,
        token_type: 'Bearer',
        expires_in: 3600, // 1 hour in seconds
        scope: authCode.scopes.join(' '),
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Token endpoint error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Validate an access token and return associated user ID
 */
export async function validateAccessToken(
  token: string,
  env: Env
): Promise<string | null> {
  try {
    const tokenData = await env.KV_CLIENTS.get(`token:${token}`);
    if (!tokenData) {
      return null;
    }

    const accessToken: AccessToken = JSON.parse(tokenData);
    
    // Check expiration
    if (accessToken.expires_at < Date.now()) {
      await env.KV_CLIENTS.delete(`token:${token}`);
      return null;
    }

    return accessToken.user_id;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}
