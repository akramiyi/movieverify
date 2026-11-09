/**
 * MovieVerify Supabase Server Client
 * 
 * Provides an isolated, singleton server-side Supabase client with service-role privileges.
 * Used exclusively for serverless API endpoints to verify user JWTs and perform authenticated
 * database operations with RLS awareness.
 */

import { createClient } from '@supabase/supabase-js';

let serverClient = null;

/**
 * Get or initialize the Supabase server client
 * @param {object|null} customClient Optional client override (for testing/mocking)
 * @returns {object} Supabase client instance
 */
export function getSupabaseServerClient(customClient = null) {
  if (customClient) {
    return customClient;
  }

  if (serverClient) {
    return serverClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('Supabase server error: SUPABASE_URL environment variable is missing.');
  }

  if (!serviceRoleKey) {
    throw new Error('Supabase server error: SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
  }

  serverClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });

  return serverClient;
}

/**
 * Reset server client instance (primarily used for test isolation)
 */
export function resetSupabaseServerClient() {
  serverClient = null;
}

/**
 * Create a request-scoped Supabase client on behalf of an authenticated user.
 * Authenticates as the user using their verified JWT and the public anon key.
 * Used to invoke SECURITY DEFINER RPCs where auth.uid() context is required.
 *
 * @param {string} userJwt Verified user Bearer token
 * @param {object|null} customClient Optional client override (for testing)
 * @returns {object} Supabase client instance
 */
export function getSupabaseUserClient(userJwt, customClient = null) {
  if (customClient) {
    return customClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Supabase server error: SUPABASE_URL environment variable is missing.');
  }

  if (!anonKey) {
    throw new Error('Supabase server error: SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY environment variable is missing.');
  }

  if (!userJwt || typeof userJwt !== 'string') {
    throw new Error('Supabase user client error: userJwt is required.');
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userJwt}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}
