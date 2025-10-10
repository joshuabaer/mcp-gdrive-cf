/**
 * Main entry point for the MCP Google Drive remote server
 * Handles routing for SSE endpoint and OAuth flows
 */

import { Env } from './bindings';
import { handleMcpRequest } from './mcp';
import { handleGoogleAuthorize, handleGoogleCallback } from './auth-google';
import {
  handleClientRegistration,
  handleAuthorize,
  handleToken,
} from './oauth-client';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route: MCP SSE endpoint
      if (path === '/sse' || path === '/sse/') {
        return await handleMcpRequest(request, env, ctx);
      }

      // Route: MCP message endpoint (for SSE+POST pattern)
      if (path === '/message' || path === '/message/') {
        return await handleMcpRequest(request, env, ctx);
      }

      // Route: Google OAuth flow start
      if (path === '/google/authorize' || path === '/authorize') {
        return handleGoogleAuthorize(request, env);
      }

      // Route: Google OAuth callback
      if (path === '/google/callback' || path === '/callback') {
        return await handleGoogleCallback(request, env);
      }

      // Route: OAuth client registration (dynamic client registration)
      if (path === '/oauth/register' || path === '/register') {
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
        }
        return await handleClientRegistration(request, env);
      }

      // Route: OAuth authorization endpoint
      if (path === '/oauth/authorize') {
        return await handleAuthorize(request, env);
      }

      // Route: OAuth token endpoint
      if (path === '/oauth/token' || path === '/token') {
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
        }
        return await handleToken(request, env);
      }

      // Route: OAuth discovery (RFC 8414)
      if (path === '/.well-known/oauth-authorization-server') {
        const baseUrl = new URL(request.url).origin;
        return new Response(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/oauth/token`,
            registration_endpoint: `${baseUrl}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
            code_challenge_methods_supported: ['S256', 'plain'],
            scopes_supported: ['openid'],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Route: Health check / info
      if (path === '/' || path === '/health') {
        return new Response(
          JSON.stringify({
            name: 'mcp-gdrive-cf',
            version: '0.4.0',
            endpoints: {
              sse: '/sse',
              google_authorize: '/google/authorize',
              google_callback: '/google/callback',
              oauth_register: '/oauth/register',
              oauth_authorize: '/oauth/authorize',
              oauth_token: '/oauth/token',
              oauth_discovery: '/.well-known/oauth-authorization-server',
            },
            tools: 11,
            features: ['google_drive', 'google_sheets', 'oauth_clients'],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 404 for unknown routes
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};
