import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

export interface JWTPayload {
    userId: string;
    email: string;
    iat?: number;
    exp?: number;
}

/**
 * Generate JWT access token (expires in 7 days)
 */
export function generateAccessToken(userId: string, email: string): string {
    const payload: JWTPayload = { userId, email };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Generate JWT refresh token (expires in 30 days)
 */
export function generateRefreshToken(userId: string, email: string): string {
    const payload: JWTPayload = { userId, email };
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

/**
 * Verify and decode JWT access token
 */
export function verifyAccessToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    } catch (error) {
        return null;
    }
}

/**
 * Verify and decode JWT refresh token
 */
export function verifyRefreshToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, env.JWT_REFRESH_SECRET) as JWTPayload;
    } catch (error) {
        return null;
    }
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}
