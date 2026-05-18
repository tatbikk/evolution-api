import { Logger } from '@config/logger.config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton Supabase client for the COD Agent layer.
 *
 * The COD Agent stores ALL of its data in a dedicated Supabase project,
 * isolated from Evolution's own PostgreSQL database. Access uses the service
 * role key, so it bypasses RLS — the key must never leave the backend.
 */
const logger = new Logger('CodAgentSupabase');

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'COD Agent: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.',
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logger.info('Supabase client initialized');
  return client;
}
