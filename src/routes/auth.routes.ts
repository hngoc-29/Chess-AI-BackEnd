import { Router } from 'express';
import { requireAuth } from '../middleware/httpAuth';

export const authRouter = Router();

/**
 * Called by the Flutter app right after Supabase login. Verifies the token,
 * creates the `users` profile row on first login, and returns it — this is
 * how the client learns its server-assigned Elo, it never sets its own.
 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.profile });
});
