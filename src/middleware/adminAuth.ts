import { Request, Response, NextFunction } from 'express';
import { AuthedUser, UserRole } from '../types';
import { db } from '../db/turso';

/**
 * Middleware để kiểm tra role của user
 * Yêu cầu httpAuth middleware phải chạy trước để có req.user
 */
export function requireRole(...allowedRoles: UserRole[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user as AuthedUser | undefined;

        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            // Lấy role từ database
            const result = await db.execute({
                sql: 'SELECT role, is_banned FROM users WHERE id = ?',
                args: [user.id]
            });

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userData = result.rows[0];
            const userRole = userData.role as UserRole;
            const isBanned = userData.is_banned as number;

            // Check if user is banned
            if (isBanned === 1) {
                return res.status(403).json({ error: 'User is banned' });
            }

            // Check if user has required role
            if (!allowedRoles.includes(userRole)) {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    required: allowedRoles,
                    current: userRole
                });
            }

            // Attach role to user object for downstream use
            user.role = userRole;
            (req as any).user = user;

            next();
        } catch (error) {
            console.error('Error checking user role:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Shorthand middleware để yêu cầu admin role
 */
export const requireAdmin = requireRole('admin');

/**
 * Middleware để yêu cầu moderator hoặc admin role
 */
export const requireModerator = requireRole('moderator', 'admin');
