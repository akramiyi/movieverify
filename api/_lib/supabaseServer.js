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

