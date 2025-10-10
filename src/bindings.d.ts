/**
 * Type definitions for Cloudflare Workers bindings
 */

export interface Env {
  // KV namespace for storing user OAuth tokens
  KV_TOKENS: KVNamespace;

  // KV namespace for storing OAuth client registrations
  KV_CLIENTS: KVNamespace;

  // Google OAuth credentials
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Session secret for signing cookies
  SESSION_SECRET?: string;

  // Optional: OAuth provider settings for client authentication
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
}

/**
 * User token data stored in KV
 */
export interface UserTokenData {
  google?: GoogleTokenData;
}

/**
 * Google OAuth token data
 */
export interface GoogleTokenData {
  access_token: string;
  refresh_token: string;
  expiry: number; // Unix timestamp in milliseconds
  scopes: string[];
  token_type?: string;
}

/**
 * Session data
 */
export interface SessionData {
  userId: string;
  state?: string; // OAuth state parameter
  createdAt: number;
}

/**
 * Registered OAuth client data
 */
export interface ClientRegistration {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}

/**
 * OAuth authorization code data
 */
export interface AuthorizationCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scopes: string[];
  expires_at: number;
}

/**
 * OAuth access token data
 */
export interface AccessToken {
  token: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  expires_at: number;
  token_type: 'Bearer';
}
