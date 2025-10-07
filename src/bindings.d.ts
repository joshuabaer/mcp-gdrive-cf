/**
 * Type definitions for Cloudflare Workers bindings
 */

export interface Env {
  // KV namespace for storing user OAuth tokens
  KV_TOKENS: KVNamespace;

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
