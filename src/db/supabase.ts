import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Service-role client — full DB access, bypasses Row Level Security.
 * ONLY ever used server-side. Never send this key or this client's
 * responses-with-secrets to the Flutter app.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Anon-key client — used only to ask Supabase Auth "is this access token valid,
 * and if so, which user does it belong to?". It cannot read/write data on its own
 * because RLS still applies to it.
 */
export const supabaseAuthClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
