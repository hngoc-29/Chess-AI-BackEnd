import { NextFunction, Request, Response } from 'express';
import { verifySupabaseToken } from '../auth/verifyToken';
import { ensureProfile, UserProfile } from '../auth/ensureProfile';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      profile?: UserProfile;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  const user = await verifySupabaseToken(token);
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid access token.' } });
    return;
  }

  req.userId = user.id;
  req.profile = await ensureProfile(user.id, user.email);
  next();
}
