/**
 * MovieVerify Serverless Authentication Middleware
 * 
 * Verifies Supabase JWT bearer tokens on incoming API requests.
 * Extracts authenticated user claims and enforces authentication boundaries.
 */

import { getSupabaseServerClient } from './supabaseServer.js';

/**
 * Extract bearer token from Authorization header
 * @param {object} headers Request headers
 * @returns {string|null} Raw JWT token or null
 */
export function extractBearerToken(headers) {
  if (!headers) return null;
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1].trim() || null;
}

/**
 * Verify incoming request authentication
 * @param {object} req Incoming HTTP request
 * @param {object|null} customSupabase Optional client override for testing
 * @returns {Promise<{ authenticated: boolean, user?: object, token?: string, error?: string, status: number }>}
 */
export async function authenticateRequest(req, customSupabase = null) {
  const token = extractBearerToken(req.headers);

  if (!token) {
    return {
      authenticated: false,
      error: 'Authentication required. Missing or malformed Authorization header.',
      status: 401,
    };
  }

  try {
    const supabase = getSupabaseServerClient(customSupabase);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data || !data.user) {
      return {
        authenticated: false,
        error: 'Invalid, expired, or revoked authentication token.',
        status: 401,
      };
    }

    return {
      authenticated: true,
      user: data.user,
      token,
      status: 200,
    };
  } catch (err) {
    console.error('[AuthMiddleware] Verification error:', err.message);
    return {
      authenticated: false,
      error: 'Authentication verification failed.',
      status: 401,
    };
  }
}

/**
 * Guard middleware helper for serverless handlers
 * Writes error response directly and returns null if unauthenticated.
 * @param {object} req 
 * @param {object} res 
 * @param {object|null} customSupabase 
 * @returns {Promise<object|null>} Authenticated user or null
 */
export async function requireAuth(req, res, customSupabase = null) {
  const authResult = await authenticateRequest(req, customSupabase);

  if (!authResult.authenticated) {
    res.statusCode = authResult.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: authResult.error }));
    return null;
  }

  return authResult.user;
}

