/**
 * POST /api/notifications/revoke
 * 
 * Secure endpoint to deactivate/revoke an FCM device token.
 * Authenticated user identity is strictly verified.
 * Users can only revoke device tokens they personally own. Cross-user revocation is blocked (403).
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { revokeDeviceToken } from '../_lib/deviceTokenService.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';

export default async function handler(req, res, customSupabase = null) {
  // Enforce HTTP Method
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return sendJson(res, 405, { error: 'Method not allowed. Use POST or DELETE.' });
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

  // 3. Revoke Device Token
  const result = await revokeDeviceToken(user, body, customSupabase);

  if (!result.success) {
    return sendJson(res, result.status || 400, { error: result.error });
  }

  return sendJson(res, result.status || 200, result.data);
}
