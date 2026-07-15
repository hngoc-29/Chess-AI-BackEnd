import { queryOne } from '../db/turso';
import { logger } from '../utils/logger';

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string;
  elo: number;
  avatar_url: string | null;
  /** Opaque to the backend - client decides what goes in here (sound, board style, ...). */
  settings: string;
  auth_provider: 'email' | 'google' | 'facebook' | 'guest';
  role: 'user' | 'moderator' | 'admin';
  games_played: number;
  games_won: number;
  games_drawn: number;
  games_lost: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_ELO = 1200;

/**
 * Looks up the app-level profile for an authenticated user.
 * Note: Profile creation now happens during registration, not here.
 * This function only retrieves existing profiles.
 */
export async function ensureProfile(userId: string, email?: string | null): Promise<UserProfile> {
  try {
    const existing = await queryOne<UserProfile>(
      `SELECT id, email, display_name, elo, avatar_url, settings, auth_provider, role,
              games_played, games_won, games_drawn, games_lost, created_at, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (existing) {
      return existing;
    }

    logger.error({ userId }, 'User profile not found');
    throw new Error('PROFILE_NOT_FOUND');
  } catch (error) {
    logger.error({ err: error, userId }, 'Failed to look up user profile');
    throw new Error('PROFILE_LOOKUP_FAILED');
  }
}
