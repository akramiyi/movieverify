import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/home-feed.js';

test('Home Feed API Suite', async (t) => {
  await t.test('1. Method Guard: Rejects POST with 405 Method Not Allowed', async () => {
    let statusCode = null;
    let jsonBody = null;
    let headers = {};

    const req = { method: 'POST' };
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => { jsonBody = body; }
        };
      }
    };

    await handler(req, res);
    assert.equal(statusCode, 405);
    assert.equal(headers['Allow'], 'GET, HEAD');
    assert.deepEqual(jsonBody, { error: 'Method Not Allowed' });
  });

  await t.test('2. Edge Cache Header: Sets public edge caching headers on GET', async () => {
    let headers = {};
    const req = { method: 'GET' };
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status: () => ({
        json: () => {}
      })
    };

    try {
      await handler(req, res);
    } catch {
      // expected if external fetches fail in test env
    }

    assert.ok(headers['Cache-Control']);
    assert.ok(headers['Cache-Control'].includes('s-maxage=21600'));
  });
});
