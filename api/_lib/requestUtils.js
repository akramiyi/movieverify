/**
 * MovieVerify API Request Helpers
 */

/**
 * Parses JSON request body across both Vercel Serverless and native Node runtimes
 * @param {object} req 
 * @returns {Promise<object|null>}
 */
export async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  // Handle incoming readable stream
  if (typeof req.on === 'function') {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data || !data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  return {};
}

/**
 * Send JSON response
 * @param {object} res 
 * @param {number} status 
 * @param {object} payload 
 */
export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

