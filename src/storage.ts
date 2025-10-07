/**
 * KV storage helpers for user tokens
 */

import { Env, UserTokenData } from './bindings';

const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

/**
 * Get user token data from KV
 */
export async function getUserToken(userId: string, env: Env): Promise<UserTokenData | null> {
  const key = `user:${userId}`;
  const data = await env.KV_TOKENS.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as UserTokenData;
  } catch (error) {
    console.error('Failed to parse token data:', error);
    return null;
  }
}

/**
 * Update user token data in KV
 */
export async function updateUserToken(
  userId: string,
  tokenData: UserTokenData,
  env: Env
): Promise<void> {
  const key = `user:${userId}`;
  await env.KV_TOKENS.put(key, JSON.stringify(tokenData), {
    expirationTtl: TOKEN_TTL,
  });
}

/**
 * Delete user token data from KV
 */
export async function deleteUserToken(userId: string, env: Env): Promise<void> {
  const key = `user:${userId}`;
  await env.KV_TOKENS.delete(key);
}
