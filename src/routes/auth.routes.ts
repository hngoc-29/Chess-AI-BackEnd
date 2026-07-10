import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/httpAuth';
import { hashPassword, verifyPassword, generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../auth/jwt';
import { execute, queryOne } from '../db/turso';
import { z } from 'zod';
import { logger } from '../utils/logger';

export const authRouter = Router();

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

/**
 * POST /auth/register
 * Create new user account with email and password
 */
authRouter.post('/register', async (req, res) => {
  try {
    const body = RegisterSchema.parse(req.body);

    // Check if user already exists
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

    // Create user
    const userId = nanoid();
    const passwordHash = await hashPassword(body.password);
    const displayName = body.displayName || body.email.split('@')[0];

    await execute(
      `INSERT INTO users (id, email, password_hash, display_name, elo) 
       VALUES (?, ?, ?, ?, 1200)`,
      [userId, body.email, passwordHash, displayName]
    );

    // Generate tokens
    const accessToken = generateAccessToken(userId, body.email);
    const refreshToken = generateRefreshToken(userId, body.email);

    logger.info({ userId, email: body.email }, 'User registered');

    res.status(201).json({
      user: {
        id: userId,
        email: body.email,
        displayName,
        elo: 1200,
      },
      accessToken,
      refreshToken,
    });
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

    const user = await queryOne<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      elo: number;
    }>('SELECT id, email, password_hash, display_name, elo FROM users WHERE email = ?', [body.email]);

    if (!user) {
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

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    logger.info({ userId: user.id, email: user.email }, 'User logged in');

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        elo: user.elo,
      },
      accessToken,
      refreshToken,
    });
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
    const user = await queryOne<{ id: string; email: string }>(
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
 * GET /auth/me
 * Get current user profile (requires authentication)
 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.profile });
});
