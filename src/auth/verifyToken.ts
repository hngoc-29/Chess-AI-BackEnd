import { supabaseAuthClient } from '../db/supabase';
import { AuthedUser } from '../types';

/**
 * The ONLY thing the client is trusted to provide is a Supabase access token.
 * Every user id / display name / elo used anywhere in game logic must trace
 * back through this function — never accept a userId the client sends directly.
 */
export async function verifySupabaseToken(accessToken: string): Promise<AuthedUser | null> {
  if (!accessToken) return null;
  const { data, error } = await supabaseAuthClient.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
