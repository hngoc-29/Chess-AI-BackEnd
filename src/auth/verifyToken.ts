import { verifyAccessToken } from './jwt';
import { AuthedUser } from '../types';

/**
 * The ONLY thing the client is trusted to provide is a JWT access token.
 * Every user id / display name / elo used anywhere in game logic must trace
 * back through this function — never accept a userId the client sends directly.
 */
export async function verifyToken(accessToken: string): Promise<AuthedUser | null> {
  if (!accessToken) return null;
  const payload = verifyAccessToken(accessToken);
  if (!payload) return null;
  return { id: payload.userId, email: payload.email };
}
