/**
 * Main entry point for the MCP Google Drive remote server
 * Handles routing for SSE endpoint and OAuth flows
 */

import { Env } from './bindings';
import { handleMcpRequest } from './mcp';
import { handleGoogleAuthorize, handleGoogleCallback } from './auth-google';

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

      // Route: Client OAuth endpoints (optional, for future implementation)
      if (path === '/token') {
        return new Response(
          JSON.stringify({ error: 'Client OAuth not yet implemented' }),
          { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (path === '/register') {
        return new Response(
          JSON.stringify({ error: 'Dynamic client registration not yet implemented' }),
          { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Route: Health check / info
      if (path === '/' || path === '/health') {
        return new Response(
          JSON.stringify({
            name: 'mcp-gdrive-cf',
            version: '0.1.0',
            endpoints: {
              sse: '/sse',
              authorize: '/google/authorize',
              callback: '/google/callback',
            },
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
