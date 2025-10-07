/**
 * MCP Server implementation
 * Handles tool registration and request routing via SSE
 */

import { Env } from './bindings';
import {
  gdriveSearch,
  gdriveReadFile,
  gsheetsRead,
  gsheetsUpdateCell,
} from './google';
import { getUserToken } from './storage';

/**
 * MCP tool definitions matching mcp-gdrive functionality
 */
const MCP_TOOLS = [
  {
    name: 'gdrive_search',
    description: 'Search for files in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "name contains \'report\'")',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results per page (max 1000)',
          default: 100,
        },
        pageToken: {
          type: 'string',
          description: 'Token for pagination',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'gdrive_read_file',
    description: 'Read content from a Google Drive file',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID',
        },
        mimeType: {
          type: 'string',
          description: 'Export MIME type for Google Docs/Sheets/Slides (e.g., text/markdown, text/csv)',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'gsheets_read',
    description: 'Read data from Google Sheets',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID',
        },
        ranges: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of A1 notation ranges (e.g., ["Sheet1!A1:B10"])',
        },
      },
      required: ['spreadsheetId', 'ranges'],
    },
  },
  {
    name: 'gsheets_update_cell',
    description: 'Update a cell in Google Sheets',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID',
        },
        range: {
          type: 'string',
          description: 'A1 notation range (e.g., "Sheet1!A1")',
        },
        value: {
          type: 'string',
          description: 'Value to write to the cell',
        },
      },
      required: ['spreadsheetId', 'range', 'value'],
    },
  },
];

/**
 * Handle MCP SSE request
 */
export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Extract user identity from request (session cookie, auth header, etc.)
  const userId = await getUserIdentity(request, env);

  // For SSE, we need to handle GET requests with streaming
  if (request.method === 'GET') {
    return handleSseConnection(userId, env, ctx);
  }

  // For POST requests (messages), handle them directly
  if (request.method === 'POST') {
    let mcpRequest: any;

    try {
      mcpRequest = await request.json();
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request body',
          message: error instanceof Error ? error.message : 'Unable to parse JSON body',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const method: string | undefined = mcpRequest?.method;
  
    // Allow initialize even if the client has not authenticated yet so the handshake can complete
    if (method === 'initialize') {
      const result = await routeMcpRequest(mcpRequest, userId || 'anonymous', env);
      const response = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result,
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // tools/list can run without OAuth, but we still require a session so we can correlate later calls
    if (!userId) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'Missing session identifier. Add ?session=YOUR_SESSION_ID or set a session cookie.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'tools/list') {
      const result = await routeMcpRequest(mcpRequest, userId, env);
      const response = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result,
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All other methods require Google OAuth token
    const tokenData = await getUserToken(userId, env);
    if (!tokenData?.google) {
      return new Response(
        JSON.stringify({
          error: 'Not authenticated with Google',
          message: 'Please visit /google/authorize to authenticate your session.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await routeMcpRequest(mcpRequest, userId, env);
    const response = {
      jsonrpc: '2.0',
      id: mcpRequest.id,
      result,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}

/**
 * Handle SSE connection for MCP protocol
 */
async function handleSseConnection(
  userId: string | null,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Create a TransformStream for SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send SSE messages
  const sendEvent = async (data: any) => {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(message));
  };

  // Handle the SSE connection asynchronously
  ctx.waitUntil(
    (async () => {
      try {
        // Send endpoint message
        await sendEvent({
          jsonrpc: '2.0',
          method: 'endpoint',
          params: {
            endpoint: '/message',
          },
        });

        // Keep connection alive
        const keepAlive = setInterval(async () => {
          try {
            await writer.write(encoder.encode(': keepalive\n\n'));
          } catch (error) {
            clearInterval(keepAlive);
          }
        }, 30000);

        // Note: In a real implementation, you'd wait for the client to close the connection
        // For now, we'll keep it open indefinitely
      } catch (error) {
        console.error('SSE error:', error);
      }
    })()
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Route MCP requests to appropriate handlers
 */
async function routeMcpRequest(mcpRequest: any, userId: string, env: Env): Promise<any> {
  const { method, params } = mcpRequest;

  try {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'mcp-gdrive-cf',
            version: '0.1.0',
          },
        };

      case 'tools/list':
        return {
          tools: MCP_TOOLS,
        };

      case 'tools/call':
        return await handleToolCall(params, userId, env);

      default:
        return {
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    return {
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    };
  }
}

/**
 * Handle tool call
 */
async function handleToolCall(params: any, userId: string, env: Env): Promise<any> {
  const { name, arguments: args } = params;

  try {
    let result;

    switch (name) {
      case 'gdrive_search':
        result = await gdriveSearch(args, userId, env);
        break;

      case 'gdrive_read_file':
        result = await gdriveReadFile(args, userId, env);
        break;

      case 'gsheets_read':
        result = await gsheetsRead(args, userId, env);
        break;

      case 'gsheets_update_cell':
        result = await gsheetsUpdateCell(args, userId, env);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Extract user identity from request
 * TODO: Implement proper session management
 */
async function getUserIdentity(request: Request, env: Env): Promise<string | null> {
  // For now, use a simple session cookie or query parameter
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session') || getCookie(request, 'session');

  if (!sessionId) {
    return null;
  }

  // In a real implementation, validate the session
  return sessionId;
}

/**
 * Get cookie value from request
 */
function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie');
  if (!cookies) return null;

  const match = cookies.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
