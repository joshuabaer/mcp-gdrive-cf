/**
 * MCP Server implementation
 * Handles tool registration and request routing via SSE
 *
 * Uses the MCP SSE transport protocol:
 *   1. Client GETs /sse → receives `event: endpoint` with message URL
 *   2. Client POSTs JSON-RPC to message URL
 *   3. Server relays responses back via SSE `event: message`
 *
 * A global Map correlates session IDs to SSE stream writers so POST
 * handlers (separate fetch invocations) can push responses to the
 * correct SSE stream. This works reliably on Cloudflare Workers when
 * requests hit the same isolate, which is typical for a single client.
 */

import { Env } from './bindings';
import {
  gdriveSearch,
  gdriveReadFile,
  gdriveCreateFolder,
  gdriveDeleteFile,
  gdriveMoveFile,
  gdriveSearchAdvanced,
  gdriveUploadFile,
  gdriveAddPermission,
  gsheetsRead,
  gsheetsUpdateCell,
  gsheetsAppendRow,
  gdriveListComments,
  gdriveListRevisions,
  gdriveGetRevision,
} from './google';
import { getUserToken } from './storage';
import { validateAccessToken } from './oauth-client';

/**
 * Global map: sessionId → SSE stream writer.
 * Populated on GET /sse, consumed on POST /message.
 */
const sseWriters = new Map<string, { writer: WritableStreamDefaultWriter; encoder: TextEncoder }>();

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
          description: 'Export MIME type for Google Docs/Sheets/Slides. Supported formats:\n' +
            '- Google Docs: text/plain, text/markdown, text/html, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document (DOCX), application/rtf, application/epub+zip\n' +
            '- Google Sheets: text/csv, text/tab-separated-values, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (XLSX), application/x-vnd.oasis.opendocument.spreadsheet (ODS)\n' +
            '- Google Slides: text/plain, application/pdf, application/vnd.openxmlformats-officedocument.presentationml.presentation (PPTX), application/vnd.oasis.opendocument.presentation (ODP)\n' +
            'Default: text/markdown for Docs, text/csv for Sheets, text/plain for Slides',
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
  {
    name: 'gdrive_create_folder',
    description: 'Create a new folder in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the folder to create',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent folder ID. If not specified, creates in root',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'gdrive_delete_file',
    description: 'Delete a file or folder from Google Drive (moves to trash)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file or folder ID to delete',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'gdrive_move_file',
    description: 'Move a file to a different folder in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID to move',
        },
        newParentId: {
          type: 'string',
          description: 'ID of the destination folder',
        },
        oldParentId: {
          type: 'string',
          description: 'Optional ID of the current parent folder (for faster operation)',
        },
      },
      required: ['fileId', 'newParentId'],
    },
  },
  {
    name: 'gdrive_search_advanced',
    description: 'Advanced search in Google Drive with filters for MIME type, owner, dates, and shared drives',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional base search query (e.g., "name contains \'report\'")',
        },
        mimeType: {
          type: 'string',
          description: 'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.folder")',
        },
        owner: {
          type: 'string',
          description: 'Filter by owner email address',
        },
        modifiedAfter: {
          type: 'string',
          description: 'Filter files modified after this date (RFC 3339 format: "2024-01-01T00:00:00Z")',
        },
        modifiedBefore: {
          type: 'string',
          description: 'Filter files modified before this date (RFC 3339 format: "2024-12-31T23:59:59Z")',
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
        supportsAllDrives: {
          type: 'boolean',
          description: 'Include files from shared drives',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'gdrive_upload_file',
    description: 'Upload a file to Google Drive (max 5MB, use simple upload)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the file to create',
        },
        content: {
          type: 'string',
          description: 'File content (text or base64 encoded)',
        },
        mimeType: {
          type: 'string',
          description: 'MIME type of the file (default: text/plain)',
          default: 'text/plain',
        },
        parentId: {
          type: 'string',
          description: 'Optional parent folder ID',
        },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'gdrive_add_permission',
    description: 'Add sharing permissions to a Google Drive file or folder',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file or folder ID',
        },
        email: {
          type: 'string',
          description: 'Email address (required for user/group types)',
        },
        role: {
          type: 'string',
          description: 'Permission role: "reader", "writer", "commenter", or "owner"',
          enum: ['reader', 'writer', 'commenter', 'owner'],
        },
        type: {
          type: 'string',
          description: 'Permission type: "user", "group", "domain", or "anyone"',
          enum: ['user', 'group', 'domain', 'anyone'],
        },
      },
      required: ['fileId', 'role', 'type'],
    },
  },
  {
    name: 'gsheets_append_row',
    description: 'Append one or more rows to a Google Sheet',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: {
          type: 'string',
          description: 'Google Sheets spreadsheet ID',
        },
        range: {
          type: 'string',
          description: 'A1 notation range (e.g., "Sheet1!A:A" or "Sheet1")',
        },
        values: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'Array of rows to append, where each row is an array of cell values',
        },
      },
      required: ['spreadsheetId', 'range', 'values'],
    },
  },
  {
    name: 'gdrive_list_comments',
    description: 'List comments on a Google Drive file (Docs, Sheets, Slides). Returns comment text, author, timestamps, quoted document text, and threaded replies.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID',
        },
        includeResolved: {
          type: 'boolean',
          description: 'Include resolved comments (default: true)',
          default: true,
        },
        pageSize: {
          type: 'number',
          description: 'Number of comments per page (max 100)',
          default: 100,
        },
        pageToken: {
          type: 'string',
          description: 'Token for pagination',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'gdrive_list_revisions',
    description: 'List revision history of a Google Drive file. Returns who edited the file and when.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID',
        },
        pageSize: {
          type: 'number',
          description: 'Number of revisions per page (max 200)',
          default: 200,
        },
        pageToken: {
          type: 'string',
          description: 'Token for pagination',
        },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'gdrive_get_revision',
    description: 'Get a specific revision of a Google Drive file. Can export the content of past revisions for Google Docs/Sheets/Slides.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID',
        },
        revisionId: {
          type: 'string',
          description: 'Revision ID (from gdrive_list_revisions)',
        },
        exportMimeType: {
          type: 'string',
          description: 'MIME type to export revision content as (e.g., "text/plain", "text/markdown"). Omit to get metadata only.',
        },
      },
      required: ['fileId', 'revisionId'],
    },
  },
];

/**
 * Send a JSON-RPC response through the SSE stream for the given session.
 * Returns true if delivered, false if no writer was found.
 */
async function sendSseMessage(sessionId: string, jsonrpcResponse: any): Promise<boolean> {
  const entry = sseWriters.get(sessionId);
  if (!entry) return false;
  try {
    const payload = `event: message\ndata: ${JSON.stringify(jsonrpcResponse)}\n\n`;
    await entry.writer.write(entry.encoder.encode(payload));
    return true;
  } catch {
    // Writer closed — clean up
    sseWriters.delete(sessionId);
    return false;
  }
}

/**
 * Handle MCP SSE request (legacy transport)
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

  // For POST requests (messages), process and relay response via SSE
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

    // Resolve the session ID used for this POST (matches the one in the endpoint URL)
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId')
      || url.searchParams.get('session')
      || userId;

    // initialize + notifications/initialized are allowed without auth
    if (method === 'initialize') {
      const result = await routeMcpRequest(mcpRequest, sessionId || 'anonymous', env);
      const jsonrpcResponse = { jsonrpc: '2.0', id: mcpRequest.id, result };
      if (sessionId) await sendSseMessage(sessionId, jsonrpcResponse);
      return new Response('Accepted', { status: 202 });
    }

    if (method === 'notifications/initialized') {
      // Client acknowledgment — no response needed
      return new Response('Accepted', { status: 202 });
    }

    // All remaining methods require a session
    if (!sessionId) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'Missing session identifier. Connect via /sse first.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // tools/list works without Google OAuth
    if (method === 'tools/list') {
      const result = await routeMcpRequest(mcpRequest, sessionId, env);
      const jsonrpcResponse = { jsonrpc: '2.0', id: mcpRequest.id, result };
      await sendSseMessage(sessionId, jsonrpcResponse);
      return new Response('Accepted', { status: 202 });
    }

    // All other methods (tools/call, etc.) require Google OAuth token
    const tokenData = await getUserToken(sessionId, env);
    if (!tokenData?.google) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        error: {
          code: -32001,
          message: 'Not authenticated with Google. Visit /google/authorize to connect your account.',
        },
      };
      await sendSseMessage(sessionId, errorResponse);
      return new Response('Accepted', { status: 202 });
    }

    const result = await routeMcpRequest(mcpRequest, sessionId, env);
    const jsonrpcResponse = { jsonrpc: '2.0', id: mcpRequest.id, result };
    await sendSseMessage(sessionId, jsonrpcResponse);
    return new Response('Accepted', { status: 202 });
  }

  return new Response('Method not allowed', { status: 405 });
}

// ─── Streamable HTTP transport ───────────────────────────────────────────────
// MCP 2025-03-26 spec: POST JSON-RPC → JSON-RPC response in body.
// No separate SSE connection needed — eliminates cross-isolate Map issues.

const STREAMABLE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Handle MCP Streamable HTTP transport.
 * Client POSTs JSON-RPC, server responds with JSON-RPC in the body.
 * Session tracked via Mcp-Session-Id header.
 */
export async function handleStreamableHttp(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === 'GET') {
    // GET is used by the client to open an SSE stream for server-initiated messages.
    // We don't need server-initiated messages, so just return the server info.
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-gdrive-cf', version: '0.4.0' },
      },
    }), { headers: STREAMABLE_HEADERS });
  }

  if (request.method === 'DELETE') {
    // Session termination — acknowledge it
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: STREAMABLE_HEADERS });
  }

  // Parse the JSON-RPC request
  let mcpRequest: any;
  try {
    mcpRequest = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  const method: string | undefined = mcpRequest?.method;

  // Resolve session: Mcp-Session-Id header > query param > cookie
  const sessionId = request.headers.get('mcp-session-id')
    || new URL(request.url).searchParams.get('session')
    || await getUserIdentity(request, env);

  // ── initialize ──
  if (method === 'initialize') {
    const newSessionId = sessionId || crypto.randomUUID();
    const result = await routeMcpRequest(mcpRequest, newSessionId, env);
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result }),
      { status: 200, headers: { ...STREAMABLE_HEADERS, 'Mcp-Session-Id': newSessionId } },
    );
  }

  // ── notifications (no response body) ──
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
    return new Response(null, { status: 204 });
  }

  // ── All remaining methods require a session ──
  if (!sessionId) {
    return jsonRpcError(mcpRequest?.id, -32001, 'Missing session. Send initialize first.');
  }

  // tools/list doesn't need Google OAuth
  if (method === 'tools/list') {
    const result = await routeMcpRequest(mcpRequest, sessionId, env);
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result }),
      { status: 200, headers: { ...STREAMABLE_HEADERS, 'Mcp-Session-Id': sessionId } },
    );
  }

  // All other methods (tools/call, etc.) require Google OAuth token
  const tokenData = await getUserToken(sessionId, env);
  if (!tokenData?.google) {
    return jsonRpcError(
      mcpRequest?.id, -32001,
      'Not authenticated with Google. Visit /google/authorize to connect your account.',
    );
  }

  const result = await routeMcpRequest(mcpRequest, sessionId, env);
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: mcpRequest.id, result }),
    { status: 200, headers: { ...STREAMABLE_HEADERS, 'Mcp-Session-Id': sessionId } },
  );
}

function jsonRpcError(id: any, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }),
    { status: 200, headers: STREAMABLE_HEADERS },
  );
}

/**
 * Handle SSE connection for MCP protocol.
 *
 * Follows the MCP SSE transport spec:
 *   event: endpoint
 *   data: /message?sessionId=<uuid>
 *
 * The client POSTs JSON-RPC to that URL; responses are pushed back
 * as `event: message` frames on this SSE stream.
 */
async function handleSseConnection(
  userId: string | null,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Each SSE connection gets a unique session ID
  const sessionId = userId || crypto.randomUUID();

  // Register the writer so POST handlers can push responses
  sseWriters.set(sessionId, { writer, encoder });

  ctx.waitUntil(
    (async () => {
      try {
        // Send the message endpoint URL using the MCP SSE event format
        const endpointUrl = `/message?sessionId=${sessionId}`;
        await writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));

        // Keep connection alive with SSE comments
        const keepAlive = setInterval(async () => {
          try {
            await writer.write(encoder.encode(': keepalive\n\n'));
          } catch {
            clearInterval(keepAlive);
            sseWriters.delete(sessionId);
          }
        }, 30000);
      } catch (error) {
        console.error('SSE error:', error);
        sseWriters.delete(sessionId);
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
            version: '0.3.0',
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

      case 'gdrive_create_folder':
        result = await gdriveCreateFolder(args, userId, env);
        break;

      case 'gdrive_delete_file':
        result = await gdriveDeleteFile(args, userId, env);
        break;

      case 'gdrive_move_file':
        result = await gdriveMoveFile(args, userId, env);
        break;

      case 'gdrive_search_advanced':
        result = await gdriveSearchAdvanced(args, userId, env);
        break;

      case 'gdrive_upload_file':
        result = await gdriveUploadFile(args, userId, env);
        break;

      case 'gdrive_add_permission':
        result = await gdriveAddPermission(args, userId, env);
        break;

      case 'gsheets_read':
        result = await gsheetsRead(args, userId, env);
        break;

      case 'gsheets_update_cell':
        result = await gsheetsUpdateCell(args, userId, env);
        break;

      case 'gsheets_append_row':
        result = await gsheetsAppendRow(args, userId, env);
        break;

      case 'gdrive_list_comments':
        result = await gdriveListComments(args, userId, env);
        break;

      case 'gdrive_list_revisions':
        result = await gdriveListRevisions(args, userId, env);
        break;

      case 'gdrive_get_revision':
        result = await gdriveGetRevision(args, userId, env);
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
  // Check for OAuth Bearer token in Authorization header
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const userId = await validateAccessToken(token, env);
    if (userId) {
      return userId;
    }
  }

  // Fallback to session cookie or query parameter (accept both 'sessionId' and 'session')
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId')
    || url.searchParams.get('session')
    || getCookie(request, 'session');

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
