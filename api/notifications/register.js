/**
 * POST /api/notifications/register
 * 
 * Secure endpoint to register or refresh an FCM device registration token.
 * Authenticated user identity is strictly extracted from verified Supabase JWT.
 * Associating token ownership with client-supplied user IDs is strictly forbidden.
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { registerDeviceToken } from '../_lib/deviceTokenService.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';

export default async function handler(req, res, customSupabase = null) {
  // Enforce HTTP Method
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  // 1. Authenticate Request
  const user = await requireAuth(req, res, customSupabase);
  if (!user) {
    return; // Response already handled by requireAuth
  }

  // 2. Parse Request Body
  const body = await parseJsonBody(req);
  if (body === null) {
    return sendJson(res, 400, { error: 'Malformed JSON payload.' });
  }

  // 3. Register or Refresh Device Token
  const result = await registerDeviceToken(user, body, customSupabase);

  if (!result.success) {
    return sendJson(res, result.status || 400, { error: result.error });
  }

  return sendJson(res, result.status || 200, result.data);
}
