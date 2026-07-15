import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/httpAuth';
import { hashPassword, verifyPassword, generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../auth/jwt';
import { verifyGoogleIdToken, verifyFacebookAccessToken, OAuthIdentity } from '../auth/oauthVerify';
import { execute, queryOne } from '../db/turso';
import { z } from 'zod';
import { logger } from '../utils/logger';

export const authRouter = Router();

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  settings: string;
  auth_provider: string;
  elo: number;
}

const USER_COLUMNS = 'id, email, display_name, avatar_url, settings, auth_provider, elo';

function toUserResponse(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    settings: safeParseSettings(user.settings),
    authProvider: user.auth_provider,
    elo: user.elo,
  };
}

function safeParseSettings(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Issues a token pair + the standard user response shape for any already-resolved user row. */
function issueSession(user: UserRow) {
  return {
    user: toUserResponse(user),
    accessToken: generateAccessToken(user.id, user.email),
    refreshToken: generateRefreshToken(user.id, user.email),
  };
}

/**
 * Handles a verified OAuth identity against the users table. Three shapes
 * of caller, distinguished by (localProfile, resolution):
 *
 *  - No localProfile: plain sign-in. Existing account -> its session.
 *    No existing account -> create one from the OAuth identity.
 *  - localProfile present, no resolution: this is a LOCAL-ONLY guest (see
 *    BackendAuthService.signInAsGuest - guests never touch the database
 *    until this call) upgrading to a real account. No existing account ->
 *    create one seeded with the OAuth identity + local settings, no
 *    conflict possible. Existing account -> can't silently pick a side,
 *    return 409 with the existing account's public info so the client can
 *    ask the player and resend with a resolution.
 *  - localProfile + resolution: the player's answer to that prompt.
 *    'keep_existing' signs into the pre-existing account as-is (local
 *    guest data is discarded). 'keep_local' overwrites the pre-existing
 *    account's profile fields with the local device's data before signing
 *    in - deliberately profile fields only (display name / settings), not
 *    elo/game history, since a local-only guest never had real server-side
 *    games under this identity to begin with.
 */
async function handleOAuthLogin(
  provider: 'google' | 'facebook',
  identity: OAuthIdentity,
  localProfile?: { displayName?: string; settings?: Record<string, unknown> },
  resolution?: 'keep_local' | 'keep_existing',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const existing = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE auth_provider = ? AND provider_id = ?`,
    [provider, identity.providerId],
  );

  if (!existing) {
    const userId = nanoid();
    await execute(
      `INSERT INTO users (id, email, auth_provider, provider_id, display_name, avatar_url, settings, elo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1200)`,
      [
        userId,
        identity.email,
        provider,
        identity.providerId,
        identity.displayName,
        identity.avatarUrl,
        JSON.stringify(localProfile?.settings ?? {}),
      ],
    );
    logger.info({ userId, provider, hadLocalProfile: !!localProfile }, `New user via ${provider} OAuth`);
    const created = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [userId]);
    if (!created) throw new Error('Failed to load user immediately after insert');
    return { status: 201, body: issueSession(created) };
  }

  if (!localProfile || resolution === 'keep_existing') {
    return { status: 200, body: issueSession(existing) };
  }

  if (resolution === 'keep_local') {
    await execute(
      `UPDATE users SET display_name = ?, settings = ?, updated_at = datetime('now') WHERE id = ?`,
      [localProfile.displayName ?? existing.display_name, JSON.stringify(localProfile.settings ?? {}), existing.id],
    );
    logger.info({ userId: existing.id, provider }, 'Existing account overwritten with local guest profile');
    const updated = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [existing.id]);
    if (!updated) throw new Error('User disappeared mid-update');
    return { status: 200, body: issueSession(updated) };
  }

  // localProfile present, no resolution yet: ask, don't guess.
  return {
    status: 409,
    body: {
      error: {
        code: 'LINKED_ELSEWHERE',
        message: `An account already exists for this ${provider} login. Choose which data to keep.`,
        existingAccount: { displayName: existing.display_name, elo: existing.elo, avatarUrl: existing.avatar_url },
      },
    },
  };
}

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1).max(50).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const LocalProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  settings: z.record(z.unknown()).optional(),
});

const GoogleAuthSchema = z.object({
  idToken: z.string().min(1),
  // Present when this login is a local-only guest (see BackendAuthService
  // in the Flutter app) upgrading to a real account. Guests never touch
  // the database until this moment - see the module comment below.
  localProfile: LocalProfileSchema.optional(),
  resolution: z.enum(['keep_local', 'keep_existing']).optional(),
});
const FacebookAuthSchema = z.object({
  accessToken: z.string().min(1),
  localProfile: LocalProfileSchema.optional(),
  resolution: z.enum(['keep_local', 'keep_existing']).optional(),
});

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  // Opaque blob - validated only for size/shape sanity, not specific keys,
  // so the client can evolve what it stores without a backend change.
  settings: z.record(z.unknown()).optional(),
});

/**
 * POST /auth/register
 * Create new user account with email and password
 */
authRouter.post('/register', async (req, res) => {
  try {
    const body = RegisterSchema.parse(req.body);

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ?',
      [body.email]
    );

    if (existing) {
      res.status(400).json({
        error: { code: 'EMAIL_EXISTS', message: 'Email already registered' }
      });
      return;
    }

    const userId = nanoid();
    const passwordHash = await hashPassword(body.password);
    const displayName = body.displayName || body.email.split('@')[0];

    await execute(
      `INSERT INTO users (id, email, password_hash, auth_provider, display_name, elo)
       VALUES (?, ?, ?, 'email', ?, 1200)`,
      [userId, body.email, passwordHash, displayName]
    );

    const user = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [userId]);
    if (!user) throw new Error('Failed to load user immediately after insert');

    logger.info({ userId, email: body.email }, 'User registered');
    res.status(201).json(issueSession(user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors }
      });
      return;
    }
    logger.error({ err: error }, 'Registration failed');
    res.status(500).json({
      error: { code: 'REGISTRATION_FAILED', message: 'Registration failed' }
    });
  }
});

/**
 * POST /auth/login
 * Authenticate with email and password
 */
authRouter.post('/login', async (req, res) => {
  try {
    const body = LoginSchema.parse(req.body);

    const user = await queryOne<UserRow & { password_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ? AND auth_provider = 'email'`,
      [body.email],
    );

    if (!user || !user.password_hash) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }
      });
      return;
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }
      });
      return;
    }

    logger.info({ userId: user.id, email: user.email }, 'User logged in');
    res.json(issueSession(user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors }
      });
      return;
    }
    logger.error({ err: error }, 'Login failed');
    res.status(500).json({
      error: { code: 'LOGIN_FAILED', message: 'Login failed' }
    });
  }
});

/**
 * POST /auth/refresh
 * Get new access token using refresh token
 */
authRouter.post('/refresh', async (req, res) => {
  try {
    const body = RefreshSchema.parse(req.body);

    const payload = verifyRefreshToken(body.refreshToken);
    if (!payload) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' }
      });
      return;
    }

    // Verify user still exists
    const user = await queryOne<{ id: string; email: string | null }>(
      'SELECT id, email FROM users WHERE id = ?',
      [payload.userId]
    );

    if (!user) {
      res.status(401).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
      return;
    }

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    res.json({ accessToken, refreshToken });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors }
      });
      return;
    }
    logger.error({ err: error }, 'Token refresh failed');
    res.status(500).json({
      error: { code: 'REFRESH_FAILED', message: 'Token refresh failed' }
    });
  }
});

/**
 * POST /auth/guest
 * Creates a new anonymous account immediately - no external token needed.
 * Kept upgradeable: see /auth/link/google and /auth/link/facebook.
 */
authRouter.post('/guest', async (req, res) => {
  try {
    const userId = nanoid();
    // Distinguishable, not falsely-official-looking default name; player
    // can rename via PATCH /auth/me at any time.
    const displayName = `Guest ${userId.slice(0, 5)}`;

    await execute(
      `INSERT INTO users (id, auth_provider, display_name, elo) VALUES (?, 'guest', ?, 1200)`,
      [userId, displayName],
    );
    const user = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [userId]);
    if (!user) throw new Error('Failed to load user immediately after insert');

    logger.info({ userId }, 'Guest account created');
    res.status(201).json(issueSession(user));
  } catch (error) {
    logger.error({ err: error }, 'Guest login failed');
    res.status(500).json({ error: { code: 'GUEST_LOGIN_FAILED', message: 'Could not create guest session' } });
  }
});

/**
 * POST /auth/oauth/google
 * Body: { idToken } - the ID token from Google Sign-In on the client.
 */
authRouter.post('/oauth/google', async (req, res) => {
  try {
    const body = GoogleAuthSchema.parse(req.body);
    const identity = await verifyGoogleIdToken(body.idToken);
    if (!identity) {
      res.status(401).json({ error: { code: 'INVALID_OAUTH_TOKEN', message: 'Could not verify Google token' } });
      return;
    }
    const { status, body: responseBody } = await handleOAuthLogin('google', identity, body.localProfile, body.resolution);
    res.status(status).json(responseBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } });
      return;
    }
    logger.error({ err: error }, 'Google OAuth login failed');
    res.status(500).json({ error: { code: 'OAUTH_LOGIN_FAILED', message: 'Google sign-in failed' } });
  }
});

/**
 * POST /auth/oauth/facebook
 * Body: { accessToken } - the access token from Facebook Login on the client.
 */
authRouter.post('/oauth/facebook', async (req, res) => {
  try {
    const body = FacebookAuthSchema.parse(req.body);
    const identity = await verifyFacebookAccessToken(body.accessToken);
    if (!identity) {
      res.status(401).json({ error: { code: 'INVALID_OAUTH_TOKEN', message: 'Could not verify Facebook token' } });
      return;
    }
    const { status, body: responseBody } = await handleOAuthLogin('facebook', identity, body.localProfile, body.resolution);
    res.status(status).json(responseBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } });
      return;
    }
    logger.error({ err: error }, 'Facebook OAuth login failed');
    res.status(500).json({ error: { code: 'OAUTH_LOGIN_FAILED', message: 'Facebook sign-in failed' } });
  }
});

/**
 * POST /auth/link/google, /auth/link/facebook
 * Upgrades the CURRENTLY authenticated account (typically a guest) to be
 * backed by an OAuth identity, instead of creating a brand new account -
 * this is what preserves a guest's elo/history when they "really" sign in.
 * Fails with LINKED_ELSEWHERE if that provider identity already backs a
 * different account; deliberately does not attempt an automatic merge.
 */
function registerLinkRoute(path: string, provider: 'google' | 'facebook') {
  authRouter.post(path, requireAuth, async (req, res) => {
    try {
      const identity =
        provider === 'google'
          ? await verifyGoogleIdToken(GoogleAuthSchema.parse(req.body).idToken)
          : await verifyFacebookAccessToken(FacebookAuthSchema.parse(req.body).accessToken);

      if (!identity) {
        res.status(401).json({ error: { code: 'INVALID_OAUTH_TOKEN', message: `Could not verify ${provider} token` } });
        return;
      }

      const conflict = await queryOne<{ id: string }>(
        'SELECT id FROM users WHERE auth_provider = ? AND provider_id = ?',
        [provider, identity.providerId],
      );
      if (conflict && conflict.id !== req.userId) {
        res.status(409).json({
          error: {
            code: 'LINKED_ELSEWHERE',
            message: `This ${provider} account is already linked to a different King's Gambit account. Sign in with it directly instead.`,
          },
        });
        return;
      }

      await execute(
        `UPDATE users SET auth_provider = ?, provider_id = ?,
                email = COALESCE(email, ?), avatar_url = COALESCE(avatar_url, ?)
         WHERE id = ?`,
        [provider, identity.providerId, identity.email, identity.avatarUrl, req.userId],
      );
      const user = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [req.userId]);
      if (!user) throw new Error('User disappeared mid-link');

      logger.info({ userId: req.userId, provider }, 'Account linked to OAuth provider');
      res.json({ user: toUserResponse(user) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } });
        return;
      }
      logger.error({ err: error, provider }, 'Account linking failed');
      res.status(500).json({ error: { code: 'LINK_FAILED', message: 'Could not link account' } });
    }
  });
}
registerLinkRoute('/link/google', 'google');
registerLinkRoute('/link/facebook', 'facebook');

/**
 * PATCH /auth/me
 * Self-service profile edits. This is the endpoint the mobile app's
 * offline change queue replays once connectivity returns - see
 * OFFLINE_SYNC.md in the Flutter repo.
 */
authRouter.patch('/me', requireAuth, async (req, res) => {
  try {
    const body = UpdateProfileSchema.parse(req.body);
    const sets: string[] = [];
    const args: unknown[] = [];

    if (body.displayName !== undefined) {
      sets.push('display_name = ?');
      args.push(body.displayName);
    }
    if (body.avatarUrl !== undefined) {
      sets.push('avatar_url = ?');
      args.push(body.avatarUrl);
    }
    if (body.settings !== undefined) {
      sets.push('settings = ?');
      args.push(JSON.stringify(body.settings));
    }

    if (sets.length === 0) {
      res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No fields to update' } });
      return;
    }

    sets.push("updated_at = datetime('now')");
    args.push(req.userId);
    await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args);

    const user = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [req.userId]);
    if (!user) throw new Error('User disappeared mid-update');

    res.json({ user: toUserResponse(user) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } });
      return;
    }
    logger.error({ err: error, userId: req.userId }, 'Profile update failed');
    res.status(500).json({ error: { code: 'UPDATE_FAILED', message: 'Could not update profile' } });
  }
});

/**
 * GET /auth/me
 * Get current user profile (requires authentication)
 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.profile });
});
