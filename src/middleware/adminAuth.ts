import { Request, Response, NextFunction } from 'express';
import { AuthedUser, UserRole } from '../types';
import { db } from '../db/turso';

/**
 * Middleware để kiểm tra role của user.
 * Yêu cầu httpAuth middleware phải chạy trước - httpAuth populates
 * req.userId/req.profile (not req.user), which is what this reads.
 */
export function requireRole(...allowedRoles: UserRole[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            // Lấy role từ database
            const result = await db.execute({
                sql: 'SELECT role, is_banned FROM users WHERE id = ?',
                args: [userId]
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

            // Attach a lightweight AuthedUser for downstream admin routes
            // that want the acting user's id (e.g. admin-levels.routes.ts
            // records created_by from this).
            (req as any).user = { id: userId, role: userRole } as AuthedUser;

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
