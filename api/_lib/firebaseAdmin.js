/**
 * MovieVerify Firebase Admin SDK Initialization Module
 * 
 * Provides secure, isolated server-side Firebase Admin initialization.
 * - Supports FIREBASE_SERVICE_ACCOUNT (JSON/base64) or individual env vars.
 * - Prevents duplicate initialization in hot-reload/serverless environments.
 * - Guards against execution in browser context.
 * - Fails safely when credentials are absent or invalid.
 * - Strictly prevents leakage of private keys.
 */

import { initializeApp, getApps, getApp, deleteApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let cachedApp = null;

/**
 * Validates and retrieves Firebase service account credentials from environment
 * @returns {object|null} Credential object with { projectId, clientEmail, privateKey } or null
 */
export function getFirebaseCredentials() {
  // Option 1: Full JSON or Base64 encoded service account
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      const decoded = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
      if (parsed.projectId && parsed.clientEmail && parsed.privateKey) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  // Option 2: Individual environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    // Normalise escaped newlines often found in Vercel/Docker env vars
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  return null;
}

/**
 * Check if valid Firebase credentials are configured in the environment
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return getFirebaseCredentials() !== null;
}

/**
 * Initializes Firebase Admin SDK with singleton lifecycle
 * @param {object|null} customCredentials Optional credential override (for isolated testing)
 * @returns {object|null} Initialized Firebase App or null
 */
export function initFirebaseAdmin(customCredentials = null) {
  if (typeof window !== 'undefined') {
    throw new Error('Security violation: Firebase Admin SDK must never be initialized in browser context.');
  }

  // Return existing initialized instance if available
  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedApp = existingApps[0];
    return cachedApp;
  }

  const creds = customCredentials || getFirebaseCredentials();
  if (!creds || !creds.projectId || !creds.clientEmail || !creds.privateKey) {
    return null;
  }

  try {
    cachedApp = initializeApp({
      credential: cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
    });
    return cachedApp;
  } catch (err) {
    // Log safe error message without leaking private key
    console.error('[FirebaseAdmin] Initialization failed safely:', err.message);
    return null;
  }
}

/**
 * Get the active Firebase Admin App instance (or initialize if not yet loaded)
 * @returns {object|null}
 */
export function getFirebaseAdmin() {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }
  return initFirebaseAdmin();
}

/**
 * Get Firebase Messaging service
 * @returns {object|null}
 */
export function getFirebaseMessaging() {
  const app = getFirebaseAdmin();
  if (!app) return null;
  return getMessaging(app);
}

/**
 * Reset Firebase Admin state (primarily used in test teardown)
 */
export async function resetFirebaseAdmin() {
  const apps = getApps();
  if (apps.length > 0) {
    await Promise.all(apps.map(app => deleteApp(app).catch(() => {})));
  }
  cachedApp = null;
}
