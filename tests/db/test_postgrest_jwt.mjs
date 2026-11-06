import crypto from 'node:crypto';

const JWT_SECRET = 'super-secret-jwt-key-32-characters-minimum!!';
const BASE_URL = 'http://127.0.0.1:3000';

function createJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const sHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const sPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(sHeader + '.' + sPayload).digest('base64url');
  return sHeader + '.' + sPayload + '.' + signature;
}

function createExpiredJwt(payload) {
  const expiredPayload = { ...payload, exp: Math.floor(Date.now() / 1000) - 3600 };
  return createJwt(expiredPayload);
}

function createTamperedJwt(payload) {
  const token = createJwt(payload);
  const parts = token.split('.');
  // Modify body without updating signature
  const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, role: 'service_role' })).toString('base64url');
  return parts[0] + '.' + tamperedPayload + '.' + parts[2];
}

async function postRpc(params, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}/rpc/record_notification_telemetry`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function runRealJwtIntegrationTests() {
  console.log('--- Starting Real Supabase PostgREST JWT Integration Tests ---');
  let passed = 0;
  let total = 0;

  function assertTest(name, condition, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] Case ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Case ${total}: ${name} -> ${details}`);
    }
  }

  // Case 1: Valid Authenticated JWT with matching recipient
  const user1Token = createJwt({
    role: 'authenticated',
    sub: '00000000-0000-0000-0000-000000000001',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const res1 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000001',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_001_' + Date.now(),
  }, user1Token);

  assertTest(
    'Valid authenticated JWT with matching recipient succeeds (HTTP 200/204)',
    res1.status >= 200 && res1.status < 300,
    JSON.stringify(res1)
  );

  // Case 2: Expired JWT rejected with HTTP 401 Unauthorized
  const expiredToken = createExpiredJwt({
    role: 'authenticated',
    sub: '00000000-0000-0000-0000-000000000001',
  });

  const res2 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000001',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_002',
  }, expiredToken);

  assertTest(
    'Expired JWT rejected by PostgREST signature verification (HTTP 401)',
    res2.status === 401,
    JSON.stringify(res2)
  );

  // Case 3: Tampered JWT / Invalid signature rejected with HTTP 401
  const tamperedToken = createTamperedJwt({
    role: 'authenticated',
    sub: '00000000-0000-0000-0000-000000000001',
  });

  const res3 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000001',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_003',
  }, tamperedToken);

  assertTest(
    'Tampered JWT rejected by PostgREST cryptographic signature check (HTTP 401)',
    res3.status === 401,
    JSON.stringify(res3)
  );

  // Case 4: Recipient mismatch (Authenticated user 1 attempting user 2 recipient_id)
  const res4 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000002',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_004',
  }, user1Token);

  assertTest(
    'Recipient mismatch rejected by function authorization (HTTP 400 with mismatch message)',
    res4.status >= 400 && JSON.stringify(res4.body).includes('does not match telemetry recipient_id'),
    JSON.stringify(res4)
  );

  // Case 5: Missing user identity (sub is missing or null in authenticated JWT)
  const tokenNoSub = createJwt({
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const res5 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000001',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_005',
  }, tokenNoSub);

  assertTest(
    'Missing user identity (null auth.uid()) rejected by function (HTTP 400 auth.uid() is NULL)',
    res5.status >= 400 && JSON.stringify(res5.body).includes('auth.uid() is NULL'),
    JSON.stringify(res5)
  );

  // Case 6: Anonymous caller (no Authorization header -> PostgREST executes as anon)
  const res6 = await postRpc({
    p_delivery_id: '11111111-1111-1111-1111-111111111111',
    p_recipient_id: '00000000-0000-0000-0000-000000000001',
    p_event_type: 'opened',
    p_nonce: 'postgrest_jwt_nonce_006',
  });

  assertTest(
    'Anonymous caller rejected with permission denied (HTTP 401/403/404 function not found or denied)',
    res6.status === 401 || res6.status === 403 || res6.status === 404,
    JSON.stringify(res6)
  );

  // Case 7: Valid service_role execution
  const serviceToken = createJwt({
    role: 'service_role',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const res7 = await postRpc({
    p_delivery_id: '22222222-2222-2222-2222-222222222222',
    p_recipient_id: '00000000-0000-0000-0000-000000000002',
    p_event_type: 'opened',
    p_nonce: 'postgrest_service_nonce_007_' + Date.now(),
  }, serviceToken);

  assertTest(
    'Valid service-role execution succeeds via PostgREST (HTTP 200/204)',
    res7.status >= 200 && res7.status < 300,
    JSON.stringify(res7)
  );

  // Case 8: NULL / empty / invalid event types
  const res8a = await postRpc({
    p_delivery_id: '22222222-2222-2222-2222-222222222222',
    p_recipient_id: '00000000-0000-0000-0000-000000000002',
    p_event_type: null,
    p_nonce: 'postgrest_service_nonce_008a',
  }, serviceToken);

  const res8b = await postRpc({
    p_delivery_id: '22222222-2222-2222-2222-222222222222',
    p_recipient_id: '00000000-0000-0000-0000-000000000002',
    p_event_type: 'invalid_event',
    p_nonce: 'postgrest_service_nonce_008b',
  }, serviceToken);

  assertTest(
    'NULL and invalid event types rejected with "Invalid telemetry event type"',
    res8a.status >= 400 && JSON.stringify(res8a.body).includes('Invalid telemetry event type') &&
    res8b.status >= 400 && JSON.stringify(res8b.body).includes('Invalid telemetry event type'),
    `8a: ${JSON.stringify(res8a)}, 8b: ${JSON.stringify(res8b)}`
  );

  // Case 9: Input-size validation on device_info payload (> 4096 bytes)
  const oversizedDeviceInfo = { data: 'x'.repeat(4200) };
  const res9 = await postRpc({
    p_delivery_id: '22222222-2222-2222-2222-222222222222',
    p_recipient_id: '00000000-0000-0000-0000-000000000002',
    p_event_type: 'opened',
    p_nonce: 'postgrest_service_nonce_009',
    p_device_info: oversizedDeviceInfo,
  }, serviceToken);

  assertTest(
    'Oversized device_info (> 4096 bytes) rejected by payload boundary check',
    res9.status >= 400 && JSON.stringify(res9.body).includes('payload exceeds 4096 bytes'),
    JSON.stringify(res9)
  );

  console.log(`\nResult: ${passed}/${total} PostgREST JWT integration tests passed.`);
  process.exit(passed === total ? 0 : 1);
}

runRealJwtIntegrationTests().catch(err => {
  console.error('Fatal integration test failure:', err);
  process.exit(1);
});
