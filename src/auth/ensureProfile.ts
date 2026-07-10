import { supabaseAdmin } from '../db/supabase';
import { logger } from '../utils/logger';

export interface UserProfile {
  id: string;
  display_name: string;
  elo: number;
  avatar_url: string | null;
}

const DEFAULT_ELO = 1200;

/**
 * Looks up the app-level profile for an authenticated Supabase user, creating
 * one on first sight. This is the only place profile rows get created, and it
 * always runs server-side with the service-role key — the client cannot
 * forge its own starting Elo or user id.
 */
export async function ensureProfile(userId: string, email?: string | null): Promise<UserProfile> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('users')
    .select('id, display_name, elo, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (selectError) {
    logger.error({ err: selectError }, 'failed to look up user profile');
    throw new Error('PROFILE_LOOKUP_FAILED');
  }
  if (existing) return existing as UserProfile;

  const fallbackName = email ? email.split('@')[0] : `Player${userId.slice(0, 6)}`;
  const { data: created, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({ id: userId, display_name: fallbackName, elo: DEFAULT_ELO })
    .select('id, display_name, elo, avatar_url')
    .single();

  if (insertError) {
    // Race condition guard: another connection from the same user created it first.
    const { data: retry } = await supabaseAdmin
      .from('users')
      .select('id, display_name, elo, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (retry) return retry as UserProfile;
    logger.error({ err: insertError }, 'failed to create user profile');
    throw new Error('PROFILE_CREATE_FAILED');
  }

  return created as UserProfile;
}
