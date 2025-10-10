/**
 * Google Drive and Sheets API helpers
 * Direct fetch calls to Google REST APIs
 */

import { Env } from './bindings';
import { getUserToken, updateUserToken } from './storage';
import { refreshAccessToken } from './auth-google';

/**
 * Make authenticated request to Google API with automatic token refresh
 */
async function googleApiRequest(
  url: string,
  userId: string,
  env: Env,
  options: RequestInit = {}
): Promise<Response> {
  let tokenData = await getUserToken(userId, env);

  if (!tokenData?.google) {
    throw new Error('No Google token found for user');
  }

  // Check if token is expired
  if (tokenData.google.expiry < Date.now()) {
    // Refresh token
    tokenData = await refreshAccessToken(userId, env);
  }

  // Make request with access token
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${tokenData.google!.access_token}`,
    },
  });

  // If 401, try refreshing token once
  if (response.status === 401) {
    tokenData = await refreshAccessToken(userId, env);

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${tokenData.google!.access_token}`,
      },
    });
  }

  return response;
}

/**
 * Search Google Drive files
 */
export async function gdriveSearch(
  args: { query: string; pageSize?: number; pageToken?: string },
  userId: string,
  env: Env
): Promise<any> {
  const { query, pageSize = 100, pageToken } = args;

  const params = new URLSearchParams({
    q: query,
    pageSize: pageSize.toString(),
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, owners)',
  });

  if (pageToken) {
    params.append('pageToken', pageToken);
  }

  const response = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    userId,
    env
  );

  if (!response.ok) {
    throw new Error(`Drive API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Read Google Drive file content
 */
export async function gdriveReadFile(
  args: { fileId: string; mimeType?: string },
  userId: string,
  env: Env
): Promise<any> {
  const { fileId, mimeType } = args;

  // Get file metadata first to determine MIME type and size
  const metaResponse = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name,size`,
    userId,
    env
  );

  if (!metaResponse.ok) {
    throw new Error(`Drive API error: ${metaResponse.status} ${metaResponse.statusText}`);
  }

  const metadata = await metaResponse.json() as any;
  const fileMimeType = metadata.mimeType;
  const fileSize = parseInt(metadata.size || '0', 10);

  // Determine if we need to export (Google Docs/Sheets/Slides)
  const isGoogleDoc = fileMimeType?.startsWith('application/vnd.google-apps.');

  let content: string;

  if (isGoogleDoc) {
    // Determine export MIME type
    const exportMimeType = mimeType || getDefaultExportMimeType(fileMimeType);

    // Validate export format if user specified one
    if (mimeType) {
      const validation = validateExportFormat(fileMimeType, mimeType);
      if (!validation.valid) {
        const supportedFormatNames = validation.supportedFormats
          ?.map(fmt => `${getFormatFriendlyName(fmt)} (${fmt})`)
          .join(', ');
        
        throw new Error(
          `Export format "${getFormatFriendlyName(mimeType)}" is not supported for this file type. ` +
          `Supported formats: ${supportedFormatNames}`
        );
      }
    }

    // Check file size before attempting export (10MB limit)
    const MAX_EXPORT_SIZE = 10 * 1024 * 1024; // 10MB
    if (fileSize > MAX_EXPORT_SIZE) {
      const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
      
      // Special handling for spreadsheets - suggest using gsheets_read
      if (fileMimeType === 'application/vnd.google-apps.spreadsheet') {
        throw new Error(
          `Spreadsheet size (${sizeMB}MB) exceeds Google Drive's export limit (10MB). ` +
          `Use the gsheets_read tool to access specific ranges instead: ` +
          `gsheets_read(spreadsheetId: "${fileId}", ranges: ["Sheet1!A1:Z1000"])`
        );
      }
      
      // Other Google Workspace files
      throw new Error(
        `File size (${sizeMB}MB) exceeds Google Drive's export limit (10MB). ` +
        `Consider reducing the file size or accessing it directly in Google Drive.`
      );
    }

    // Export Google Workspace file
    const exportResponse = await googleApiRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      userId,
      env
    );

    if (!exportResponse.ok) {
      const errorText = await exportResponse.text();
      throw new Error(`Drive export error: ${exportResponse.status} - ${errorText}`);
    }

    content = await exportResponse.text();
  } else {
    // Download binary file
    const downloadResponse = await googleApiRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      userId,
      env
    );

    if (!downloadResponse.ok) {
      throw new Error(`Drive download error: ${downloadResponse.status} ${downloadResponse.statusText}`);
    }

    content = await downloadResponse.text();
  }

  return {
    fileId,
    name: metadata.name,
    mimeType: fileMimeType,
    size: fileSize,
    content,
  };
}

/**
 * Read Google Sheets data
 */
export async function gsheetsRead(
  args: { spreadsheetId: string; ranges: string[] },
  userId: string,
  env: Env
): Promise<any> {
  const { spreadsheetId, ranges } = args;

  const params = new URLSearchParams();
  ranges.forEach((range) => params.append('ranges', range));

  const response = await googleApiRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`,
    userId,
    env
  );

  if (!response.ok) {
    throw new Error(`Sheets API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return {
    spreadsheetId,
    valueRanges: data.valueRanges || [],
  };
}

/**
 * Update Google Sheets cell
 */
export async function gsheetsUpdateCell(
  args: { spreadsheetId: string; range: string; value: string },
  userId: string,
  env: Env
): Promise<any> {
  const { spreadsheetId, range, value } = args;

  const body = {
    values: [[value]],
  };

  const response = await googleApiRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    userId,
    env,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Sheets API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return {
    spreadsheetId,
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows,
    updatedColumns: data.updatedColumns,
    updatedCells: data.updatedCells,
  };
}

/**
 * Create a folder in Google Drive
 */
export async function gdriveCreateFolder(
  args: { name: string; parentId?: string },
  userId: string,
  env: Env
): Promise<any> {
  const { name, parentId } = args;

  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await googleApiRequest(
    'https://www.googleapis.com/drive/v3/files',
    userId,
    env,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive API error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    webViewLink: data.webViewLink,
  };
}

/**
 * Delete a file or folder from Google Drive
 */
export async function gdriveDeleteFile(
  args: { fileId: string },
  userId: string,
  env: Env
): Promise<any> {
  const { fileId } = args;

  const response = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    userId,
    env,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive API error: ${response.status} ${errorData}`);
  }

  return {
    success: true,
    fileId,
    message: 'File deleted successfully',
  };
}

/**
 * Move a file to a different folder in Google Drive
 */
export async function gdriveMoveFile(
  args: { fileId: string; newParentId: string; oldParentId?: string },
  userId: string,
  env: Env
): Promise<any> {
  const { fileId, newParentId, oldParentId } = args;

  // Build query parameters
  const params = new URLSearchParams();
  params.append('addParents', newParentId);
  if (oldParentId) {
    params.append('removeParents', oldParentId);
  }
  params.append('fields', 'id, name, parents');

  const response = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params}`,
    userId,
    env,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive API error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    id: data.id,
    name: data.name,
    parents: data.parents,
  };
}

/**
 * Advanced search in Google Drive with filters
 */
export async function gdriveSearchAdvanced(
  args: {
    query?: string;
    mimeType?: string;
    owner?: string;
    modifiedAfter?: string;
    modifiedBefore?: string;
    pageSize?: number;
    pageToken?: string;
    supportsAllDrives?: boolean;
  },
  userId: string,
  env: Env
): Promise<any> {
  const {
    query,
    mimeType,
    owner,
    modifiedAfter,
    modifiedBefore,
    pageSize = 100,
    pageToken,
    supportsAllDrives = false,
  } = args;

  // Build search query
  const queryParts: string[] = [];
  
  if (query) {
    queryParts.push(query);
  }
  
  if (mimeType) {
    queryParts.push(`mimeType='${mimeType}'`);
  }
  
  if (owner) {
    queryParts.push(`'${owner}' in owners`);
  }
  
  if (modifiedAfter) {
    queryParts.push(`modifiedTime > '${modifiedAfter}'`);
  }
  
  if (modifiedBefore) {
    queryParts.push(`modifiedTime < '${modifiedBefore}'`);
  }

  const fullQuery = queryParts.length > 0 ? queryParts.join(' and ') : 'trashed=false';

  const params = new URLSearchParams({
    q: fullQuery,
    pageSize: pageSize.toString(),
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, owners, parents, size)',
  });

  if (pageToken) {
    params.append('pageToken', pageToken);
  }

  if (supportsAllDrives) {
    params.append('supportsAllDrives', 'true');
    params.append('includeItemsFromAllDrives', 'true');
  }

  const response = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    userId,
    env
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive API error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
    query: fullQuery,
  };
}

/**
 * Append rows to a Google Sheet
 */
export async function gsheetsAppendRow(
  args: { spreadsheetId: string; range: string; values: string[][] },
  userId: string,
  env: Env
): Promise<any> {
  const { spreadsheetId, range, values } = args;

  const body = {
    values,
  };

  const response = await googleApiRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    userId,
    env,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Sheets API error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    spreadsheetId,
    tableRange: data.tableRange,
    updates: {
      updatedRange: data.updates?.updatedRange,
      updatedRows: data.updates?.updatedRows,
      updatedColumns: data.updates?.updatedColumns,
      updatedCells: data.updates?.updatedCells,
    },
  };
}

/**
 * Upload a file to Google Drive
 * Supports simple upload for files up to 5MB
 */
export async function gdriveUploadFile(
  args: { name: string; content: string; mimeType?: string; parentId?: string },
  userId: string,
  env: Env
): Promise<any> {
  const { name, content, mimeType = 'text/plain', parentId } = args;

  // Create metadata
  const metadata: any = {
    name,
    mimeType,
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  // Create multipart body
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = 
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const response = await googleApiRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    userId,
    env,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive upload error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
    webViewLink: data.webViewLink,
  };
}

/**
 * Add sharing permissions to a file
 */
export async function gdriveAddPermission(
  args: { fileId: string; email?: string; role: string; type: string },
  userId: string,
  env: Env
): Promise<any> {
  const { fileId, email, role, type } = args;

  const permission: any = {
    type, // 'user', 'group', 'domain', 'anyone'
    role, // 'reader', 'writer', 'commenter', 'owner'
  };

  if (email && (type === 'user' || type === 'group')) {
    permission.emailAddress = email;
  }

  const response = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    userId,
    env,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(permission),
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Drive permissions error: ${response.status} ${errorData}`);
  }

  const data = await response.json() as any;
  return {
    id: data.id,
    type: data.type,
    role: data.role,
    emailAddress: data.emailAddress,
  };
}

/**
 * Get default export MIME type for Google Workspace files
 */
function getDefaultExportMimeType(googleMimeType: string): string {
  const mimeTypeMap: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/markdown',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  };

  return mimeTypeMap[googleMimeType] || 'text/plain';
}

/**
 * Supported export formats for Google Workspace files
 * Reference: https://developers.google.com/drive/api/guides/ref-export-formats
 */
const EXPORT_FORMATS: Record<string, string[]> = {
  'application/vnd.google-apps.document': [
    'text/plain',
    'text/markdown',
    'text/html',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/rtf',
    'application/epub+zip',
    'application/zip', // HTML zipped
  ],
  'application/vnd.google-apps.spreadsheet': [
    'text/csv',
    'text/tab-separated-values',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'application/x-vnd.oasis.opendocument.spreadsheet', // ODS
    'application/zip', // HTML zipped
  ],
  'application/vnd.google-apps.presentation': [
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
    'application/vnd.oasis.opendocument.presentation', // ODP
  ],
  'application/vnd.google-apps.drawing': [
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'application/pdf',
  ],
};

/**
 * Validate that the requested export format is supported for the given file type
 */
function validateExportFormat(googleMimeType: string, requestedMimeType: string): { valid: boolean; supportedFormats?: string[] } {
  const supportedFormats = EXPORT_FORMATS[googleMimeType];
  
  if (!supportedFormats) {
    return { valid: false };
  }
  
  const isValid = supportedFormats.includes(requestedMimeType);
  
  return {
    valid: isValid,
    supportedFormats: isValid ? undefined : supportedFormats,
  };
}

/**
 * Get friendly format names for error messages
 */
function getFormatFriendlyName(mimeType: string): string {
  const formatNames: Record<string, string> = {
    'text/plain': 'Plain Text',
    'text/markdown': 'Markdown',
    'text/html': 'HTML',
    'text/csv': 'CSV',
    'text/tab-separated-values': 'TSV',
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX (Word)',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX (Excel)',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX (PowerPoint)',
    'application/rtf': 'RTF (Rich Text)',
    'application/epub+zip': 'EPUB',
    'application/x-vnd.oasis.opendocument.spreadsheet': 'ODS',
    'application/vnd.oasis.opendocument.presentation': 'ODP',
    'application/zip': 'ZIP (HTML)',
    'image/svg+xml': 'SVG',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
  };
  
  return formatNames[mimeType] || mimeType;
}

// TODO: Future enhancement - gsheets_batch_update
// Implement batch updates for multiple ranges and formatting
// via sheets.spreadsheets.batchUpdate API
// Reference: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
