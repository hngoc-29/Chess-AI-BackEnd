import { queryOne } from '../db/turso';
import { logger } from '../utils/logger';

export interface UserProfile {
  id: string;
  display_name: string;
  elo: number;
  avatar_url: string | null;
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
      'SELECT id, display_name, elo, avatar_url FROM users WHERE id = ?',
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
