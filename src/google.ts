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

  // Get file metadata first to determine MIME type
  const metaResponse = await googleApiRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`,
    userId,
    env
  );

  if (!metaResponse.ok) {
    throw new Error(`Drive API error: ${metaResponse.status} ${metaResponse.statusText}`);
  }

  const metadata = await metaResponse.json() as any;
  const fileMimeType = metadata.mimeType;

  // Determine if we need to export (Google Docs/Sheets/Slides)
  const isGoogleDoc = fileMimeType?.startsWith('application/vnd.google-apps.');

  let content: string;

  if (isGoogleDoc) {
    // Export Google Workspace file
    const exportMimeType =
      mimeType ||
      getDefaultExportMimeType(fileMimeType);

    const exportResponse = await googleApiRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      userId,
      env
    );

    if (!exportResponse.ok) {
      throw new Error(`Drive export error: ${exportResponse.status} ${exportResponse.statusText}`);
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
