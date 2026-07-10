import { Socket } from 'socket.io';
import { verifyToken } from '../auth/verifyToken';
import { ensureProfile, UserProfile } from '../auth/ensureProfile';
import { logger } from '../utils/logger';

export interface AuthedSocketData {
  userId: string;
  profile: UserProfile;
}

/**
 * Runs once per connection, before any event handler. The client sends its
 * JWT access token in the connection `auth` payload:
 *
 *   io("wss://your-server", { auth: { token: accessToken } })
 *
 * A socket that fails this never gets to register any game event handlers.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
) {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('UNAUTHENTICATED'));

    const authedUser = await verifyToken(token);
    if (!authedUser) return next(new Error('INVALID_TOKEN'));

    const profile = await ensureProfile(authedUser.id, authedUser.email);
    socket.data = { userId: authedUser.id, profile };
    next();
  } catch (err) {
    logger.error({ err }, 'socket auth failed');
    next(new Error('AUTH_ERROR'));
  }
}
