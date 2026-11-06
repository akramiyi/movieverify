/**
 * MovieVerify Firebase Admin Initialization Test Suite
 * Tests isolated initialization, credential validation, singleton lifecycle, and security guards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  getFirebaseCredentials,
  isFirebaseConfigured,
  initFirebaseAdmin,
  getFirebaseAdmin,
  resetFirebaseAdmin,
} from '../../api/_lib/firebaseAdmin.js';

test('Firebase Admin Infrastructure Suite', async (t) => {
  const originalEnv = { ...process.env };

  t.beforeEach(async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    await resetFirebaseAdmin();
  });

  t.afterEach(async () => {
    await resetFirebaseAdmin();
    process.env = { ...originalEnv };
  });

  await t.test('1. Fails safely when all credentials are absent', () => {
    assert.equal(isFirebaseConfigured(), false);
    assert.equal(getFirebaseCredentials(), null);
    assert.equal(initFirebaseAdmin(), null);
    assert.equal(getFirebaseAdmin(), null);
  });

  await t.test('2. Fails safely when partial credentials are provided', () => {
    process.env.FIREBASE_PROJECT_ID = 'test-mv-project';
    // Missing clientEmail and privateKey
    assert.equal(isFirebaseConfigured(), false);
    assert.equal(initFirebaseAdmin(), null);
  });

  await t.test('3. Fails safely when FIREBASE_SERVICE_ACCOUNT contains malformed JSON', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = 'not-valid-json{';
    assert.equal(isFirebaseConfigured(), false);
    assert.equal(getFirebaseCredentials(), null);
    assert.equal(initFirebaseAdmin(), null);
  });

  await t.test('4. Correctly normalizes escaped newlines in FIREBASE_PRIVATE_KEY', () => {
    process.env.FIREBASE_PROJECT_ID = 'test-mv-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@test-mv-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBg\\n-----END PRIVATE KEY-----';

    const creds = getFirebaseCredentials();
    assert.ok(creds);
    assert.equal(creds.projectId, 'test-mv-project');
    assert.equal(creds.clientEmail, 'firebase-adminsdk@test-mv-project.iam.gserviceaccount.com');
    assert.ok(creds.privateKey.includes('\n'), 'Private key should contain unescaped newline');
    assert.ok(!creds.privateKey.includes('\\n'), 'Private key should not retain escaped \\n');
  });

  await t.test('5. Parses FIREBASE_SERVICE_ACCOUNT from Base64 encoded JSON string', () => {
    const rawJson = JSON.stringify({
      project_id: 'base64-project',
      client_email: 'base64-sa@base64-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
    });
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(rawJson).toString('base64');

    const creds = getFirebaseCredentials();
    assert.ok(creds);
    assert.equal(creds.projectId, 'base64-project');
    assert.equal(creds.clientEmail, 'base64-sa@base64-project.iam.gserviceaccount.com');
  });

  await t.test('6. Guards against browser-context execution', () => {
    // Simulate browser environment
    globalThis.window = {};
    try {
      assert.throws(() => {
        initFirebaseAdmin();
      }, /Security violation: Firebase Admin SDK must never be initialized in browser context/);
    } finally {
      delete globalThis.window;
    }
  });

  await t.test('7. Prevents duplicate initialization (Singleton Pattern)', () => {
    // Generate valid mock RSA key for SDK test
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const mockCreds = {
      projectId: 'mv-unit-test-project',
      clientEmail: 'service-account@mv-unit-test-project.iam.gserviceaccount.com',
      privateKey,
    };

    const app1 = initFirebaseAdmin(mockCreds);
    assert.ok(app1, 'First initialization should succeed');
    assert.equal(app1.name, '[DEFAULT]');

    const app2 = getFirebaseAdmin();
    assert.strictEqual(app1, app2, 'Subsequent getFirebaseAdmin must return identical instance');

    const app3 = initFirebaseAdmin(mockCreds);
    assert.strictEqual(app1, app3, 'Calling initFirebaseAdmin again must return existing instance without error');
  });
});
