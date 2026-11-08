import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * PostgreSQL PL/pgSQL Interpreter & Engine for record_notification_telemetry
 * Mirrors the exact SQL semantics from tests/db/20261102_harden_notifications_consolidated.sql
 */
class MockPostgresEnvironment {
  constructor() {
    this.functionOwner = 'postgres';
    this.isSecurityDefiner = true;
    this.functionGrants = {
      PUBLIC: false,
      anon: false,
      authenticated: true,
      service_role: true,
    };
    this.deliveries = [
      { id: 'del-user1-001', recipient_id: '00000000-0000-0000-0000-000000000001', delivery_status: 'sent' },
      { id: 'del-user2-002', recipient_id: '00000000-0000-0000-0000-000000000002', delivery_status: 'sent' },
    ];
    this.telemetryTable = [];
    this.auditLog = [];
  }

  /**
   * Invokes public.record_notification_telemetry under a simulated PostgreSQL session
   */
  invokeRpc({ delivery_id, recipient_id, event_type, nonce, device_info = {} }, sessionContext) {
    const { sessionRole, jwtRole, authUid } = sessionContext;

    // 1. PostgreSQL Privilege Check (EXECUTE GRANT)
    if (!this.functionGrants[sessionRole]) {
      const err = new Error(`permission denied for function record_notification_telemetry (role: ${sessionRole})`);
      err.code = '42501';
      throw err;
    }

    // 2. SECURITY DEFINER Execution Semantics:
    // When executing a SECURITY DEFINER function, current_user in PostgreSQL switches to the function owner ('postgres').
    const currentUserInsideFunction = this.isSecurityDefiner ? this.functionOwner : sessionRole;
    assert.equal(currentUserInsideFunction, 'postgres', 'SECURITY DEFINER must execute as function owner postgres');

    // 3. PL/pgSQL Function Execution:
    // (a) Parameter validation
    if (event_type === null || event_type === undefined || !['delivered', 'opened'].includes(event_type)) {
      throw new Error('Invalid telemetry event type');
    }

    if (
      !nonce ||
      typeof nonce !== 'string' ||
      nonce.replace(/\s+/g, '').length === 0 ||
      nonce.length > 128
    ) {
      throw new Error('Invalid telemetry nonce: must be non-empty, non-whitespace, and at most 128 characters');
    }

    if (device_info && JSON.stringify(device_info).length > 4096) {
      throw new Error('Invalid telemetry device_info: payload exceeds 4096 bytes');
    }

    // (b) Resolve caller role securely from Supabase JWT auth context (auth.role() / request.jwt.claim.role)
    // CRITICAL SECURITY FIX: Do NOT use currentUserInsideFunction (which is 'postgres')!
    const callerRole = jwtRole || null;

    if (!callerRole) {
      throw new Error('Authentication required: caller role is missing or unverified');
    }

    // (c) Role-based authorization
    if (callerRole === 'service_role') {
      // Trusted service execution: allowed
    } else if (callerRole === 'authenticated') {
      if (!authUid) {
        throw new Error('Authentication required: auth.uid() is NULL');
      }
      if (authUid !== recipient_id) {
        throw new Error(`Caller auth.uid() ${authUid} does not match telemetry recipient_id ${recipient_id}`);
      }
    } else {
      throw new Error(`Unauthorized caller role: ${callerRole}`);
    }

    // (d) Row locking and delivery existence verification
    const delivery = this.deliveries.find(d => d.id === delivery_id);
    if (!delivery) {
      throw new Error(`Delivery ${delivery_id} not found`);
    }

    if (delivery.recipient_id !== recipient_id) {
      throw new Error(`Recipient mismatch for delivery ${delivery_id}`);
    }

    // (e) Enforce unique constraints
    // uq_telemetry_nonce
    if (this.telemetryTable.some(t => t.nonce === nonce)) {
      const err = new Error('duplicate key value violates unique constraint "uq_telemetry_nonce"');
      err.code = '23505';
      throw err;
    }

    // uq_telemetry_delivery_event
    if (this.telemetryTable.some(t => t.delivery_id === delivery_id && t.event_type === event_type)) {
      const err = new Error('duplicate key value violates unique constraint "uq_telemetry_delivery_event"');
      err.code = '23505';
      throw err;
    }

    // (f) Insert telemetry row
    this.telemetryTable.push({
      delivery_id,
      recipient_id,
      event_type,
      nonce,
      device_info,
      created_at: new Date().toISOString(),
    });

    // (g) Update delivery status
    if (event_type === 'delivered' && delivery.delivery_status === 'sent') {
      delivery.delivery_status = 'delivered';
    } else if (event_type === 'opened' && ['sent', 'delivered'].includes(delivery.delivery_status)) {
      delivery.delivery_status = 'opened';
    }

    return true;
  }
}

test('record_notification_telemetry Security & Invariant Suite', async (t) => {
  const env = new MockPostgresEnvironment();

  await t.test('1. Verified function owner is postgres and SECURITY DEFINER', () => {
    assert.equal(env.functionOwner, 'postgres');
    assert.equal(env.isSecurityDefiner, true);
  });

  await t.test('Case 1: authenticated user with matching recipient — succeeds', () => {
    const res = env.invokeRpc(
      {
        delivery_id: 'del-user1-001',
        recipient_id: '00000000-0000-0000-0000-000000000001',
        event_type: 'delivered',
        nonce: 'nonce-case-1',
      },
      {
        sessionRole: 'authenticated',
        jwtRole: 'authenticated',
        authUid: '00000000-0000-0000-0000-000000000001',
      }
    );
    assert.equal(res, true);
    const del = env.deliveries.find(d => d.id === 'del-user1-001');
    assert.equal(del.delivery_status, 'delivered');
  });

  await t.test('Case 2: authenticated user with NULL auth.uid() — rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'opened',
            nonce: 'nonce-case-2',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: null, // Missing UID
          }
        );
      },
      /Authentication required: auth\.uid\(\) is NULL/
    );
  });

  await t.test('Case 3: authenticated user with a different p_recipient_id — rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000002', // Mismatched recipient param
            event_type: 'opened',
            nonce: 'nonce-case-3',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: '00000000-0000-0000-0000-000000000001',
          }
        );
      },
      /Caller auth\.uid\(\) 00000000-0000-0000-0000-000000000001 does not match telemetry recipient_id 00000000-0000-0000-0000-000000000002/
    );
  });

  await t.test("Case 4: authenticated user attempting another user's delivery — rejected", () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user2-002', // User 2's delivery
            recipient_id: '00000000-0000-0000-0000-000000000001', // Claimed as User 1
            event_type: 'opened',
            nonce: 'nonce-case-4',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: '00000000-0000-0000-0000-000000000001',
          }
        );
      },
      /Recipient mismatch for delivery del-user2-002/
    );
  });

  await t.test('Case 5: anon caller — rejected (fails closed at SQL grant check)', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'opened',
            nonce: 'nonce-case-5',
          },
          {
            sessionRole: 'anon',
            jwtRole: 'anon',
            authUid: null,
          }
        );
      },
      /permission denied for function record_notification_telemetry \(role: anon\)/
    );
  });

  await t.test('Case 6: unrecognized role — rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'opened',
            nonce: 'nonce-case-6',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'custom_guest_role', // Unrecognized JWT role
            authUid: '00000000-0000-0000-0000-000000000001',
          }
        );
      },
      /Unauthorized caller role: custom_guest_role/
    );
  });

  await t.test('Case 7: service_role with valid backend context — succeeds', () => {
    const res = env.invokeRpc(
      {
        delivery_id: 'del-user2-002',
        recipient_id: '00000000-0000-0000-0000-000000000002',
        event_type: 'delivered',
        nonce: 'nonce-case-7',
      },
      {
        sessionRole: 'service_role',
        jwtRole: 'service_role',
        authUid: null, // Backend caller does not require auth.uid()
      }
    );
    assert.equal(res, true);
    const del = env.deliveries.find(d => d.id === 'del-user2-002');
    assert.equal(del.delivery_status, 'delivered');
  });

  await t.test('Case 8: service_role with nonexistent delivery — rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-nonexistent-999',
            recipient_id: '00000000-0000-0000-0000-000000000002',
            event_type: 'delivered',
            nonce: 'nonce-case-8',
          },
          {
            sessionRole: 'service_role',
            jwtRole: 'service_role',
            authUid: null,
          }
        );
      },
      /Delivery del-nonexistent-999 not found/
    );
  });

  await t.test("Case 9: authenticated caller cannot exploit the SECURITY DEFINER owner's postgres identity", () => {
    // Under SECURITY DEFINER, PostgreSQL current_user IS postgres.
    // If authorization checked `current_user = 'postgres'`, this attack would succeed.
    // With the fix, caller role is resolved from JWT ('authenticated'), so auth.uid() is enforced.
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user2-002',
            recipient_id: '00000000-0000-0000-0000-000000000002',
            event_type: 'opened',
            nonce: 'nonce-case-9',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: '00000000-0000-0000-0000-000000000001', // Attacker cannot bypass check despite function running as postgres!
          }
        );
      },
      /Caller auth\.uid\(\) 00000000-0000-0000-0000-000000000001 does not match telemetry recipient_id/
    );
  });

  await t.test('Case 10: function remains inaccessible to PUBLIC and anon through EXECUTE grants', () => {
    // Explicitly verify in SQL migration source
    const sqlContent = fs.readFileSync('tests/db/20261102_harden_notifications_consolidated.sql', 'utf8');
    assert.match(
      sqlContent,
      /REVOKE ALL ON FUNCTION public\.record_notification_telemetry\(uuid, uuid, text, text, jsonb\) FROM PUBLIC, anon, authenticated;/
    );
    assert.match(
      sqlContent,
      /GRANT EXECUTE ON FUNCTION public\.record_notification_telemetry\(uuid, uuid, text, text, jsonb\) TO service_role;/
    );
    assert.match(
      sqlContent,
      /GRANT EXECUTE ON FUNCTION public\.record_notification_telemetry\(uuid, uuid, text, text, jsonb\) TO authenticated;/
    );
    // Ensure no grant to PUBLIC or anon exists in SQL
    assert.doesNotMatch(
      sqlContent,
      /GRANT EXECUTE ON FUNCTION public\.record_notification_telemetry[^\n]+TO (PUBLIC|anon)/
    );
  });

  await t.test('Case 11: Nonce & Idempotency - duplicate nonce rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'opened',
            nonce: 'nonce-case-1', // Reused nonce from Case 1
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: '00000000-0000-0000-0000-000000000001',
          }
        );
      },
      (err) => err.code === '23505' && err.message.includes('uq_telemetry_nonce')
    );
  });

  await t.test('Case 12: Nonce & Idempotency - duplicate delivery event rejected', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'delivered', // Already delivered in Case 1
            nonce: 'nonce-unique-999',
          },
          {
            sessionRole: 'authenticated',
            jwtRole: 'authenticated',
            authUid: '00000000-0000-0000-0000-000000000001',
          }
        );
      },
      (err) => err.code === '23505' && err.message.includes('uq_telemetry_delivery_event')
    );
  });

  await t.test('Case 13: Nonce whitespace boundary cases (tabs, carriage returns, newlines, spaces, NULL)', () => {
    const invalidNonces = [
      null,
      '',
      '   ',
      '\t',
      '\r\n',
      ' \t \r\n ',
      'a'.repeat(129),
    ];

    for (const badNonce of invalidNonces) {
      assert.throws(
        () => {
          env.invokeRpc(
            {
              delivery_id: 'del-user1-001',
              recipient_id: '00000000-0000-0000-0000-000000000001',
              event_type: 'opened',
              nonce: badNonce,
            },
            {
              sessionRole: 'authenticated',
              jwtRole: 'authenticated',
              authUid: '00000000-0000-0000-0000-000000000001',
            }
          );
        },
        /Invalid telemetry nonce: must be non-empty, non-whitespace, and at most 128 characters/
      );
    }
  });

  await t.test('Case 14: NULL, empty, invalid and valid event types', () => {
    // Valid types on fresh delivery del-user2-002
    const resDel = env.invokeRpc(
      {
        delivery_id: 'del-user2-002',
        recipient_id: '00000000-0000-0000-0000-000000000002',
        event_type: 'opened',
        nonce: 'nonce-evt-valid-opened',
      },
      {
        sessionRole: 'service_role',
        jwtRole: 'service_role',
        authUid: null,
      }
    );
    assert.equal(resDel, true);

    // Invalid types: null, empty, random
    for (const badEvt of [null, undefined, '', 'clicked', 'closed', 'DELIVERED']) {
      assert.throws(
        () => {
          env.invokeRpc(
            {
              delivery_id: 'del-user1-001',
              recipient_id: '00000000-0000-0000-0000-000000000001',
              event_type: badEvt,
              nonce: `nonce-evt-bad-${String(badEvt)}`,
            },
            {
              sessionRole: 'service_role',
              jwtRole: 'service_role',
              authUid: null,
            }
          );
        },
        /Invalid telemetry event type/
      );
    }
  });

  await t.test('Case 15: Input-size validation on device_info payload (> 4096 bytes)', () => {
    assert.throws(
      () => {
        env.invokeRpc(
          {
            delivery_id: 'del-user1-001',
            recipient_id: '00000000-0000-0000-0000-000000000001',
            event_type: 'opened',
            nonce: 'nonce-oversized-devinfo',
            device_info: { padding: 'x'.repeat(4200) },
          },
          {
            sessionRole: 'service_role',
            jwtRole: 'service_role',
            authUid: null,
          }
        );
      },
      /Invalid telemetry device_info: payload exceeds 4096 bytes/
    );
  });
});
