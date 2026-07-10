import { Router } from 'express';
import { requireAdmin, requireModerator } from '../middleware/adminAuth';
import { httpAuth } from '../middleware/httpAuth';
import { db } from '../db/turso';
import { z } from 'zod';

export const adminRouter = Router();

// Tất cả admin routes yêu cầu authentication
adminRouter.use(httpAuth);

// ============================================================================
// USER MANAGEMENT (Admin only)
// ============================================================================

// GET /api/admin/users - Lấy danh sách users với pagination
adminRouter.get('/users', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = (page - 1) * limit;
        const search = req.query.search as string || '';
        const role = req.query.role as string || '';

        let sql = 'SELECT id, email, display_name, role, is_banned, elo, games_played, created_at FROM users';
        const conditions: string[] = [];
        const args: any[] = [];

        if (search) {
            conditions.push('(email LIKE ? OR display_name LIKE ?)');
            args.push(`%${search}%`, `%${search}%`);
        }

        if (role && ['user', 'moderator', 'admin'].includes(role)) {
            conditions.push('role = ?');
            args.push(role);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        args.push(limit, offset);

        const result = await db.execute({ sql, args });

        // Count total
        let countSql = 'SELECT COUNT(*) as total FROM users';
        if (conditions.length > 0) {
            countSql += ' WHERE ' + conditions.join(' AND ');
        }
        const countResult = await db.execute({
            sql: countSql,
            args: args.slice(0, -2) // Remove limit and offset
        });

        const total = Number(countResult.rows[0].total);

        res.json({
            users: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /api/admin/users/:id - Lấy chi tiết user
adminRouter.get('/users/:id', requireAdmin, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT id, email, display_name, role, is_banned, banned_until, ban_reason, 
             elo, games_played, games_won, games_drawn, games_lost, created_at, updated_at 
             FROM users WHERE id = ?`,
            args: [req.params.id]
        });

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// PATCH /api/admin/users/:id/role - Cập nhật role
adminRouter.patch('/users/:id/role', requireAdmin, async (req, res) => {
    try {
        const schema = z.object({
            role: z.enum(['user', 'moderator', 'admin'])
        });

        const { role } = schema.parse(req.body);

        await db.execute({
            sql: 'UPDATE users SET role = ? WHERE id = ?',
            args: [role, req.params.id]
        });

        res.json({ message: 'Role updated successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Error updating role:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// POST /api/admin/users/:id/ban - Ban user
adminRouter.post('/users/:id/ban', requireModerator, async (req, res) => {
    try {
        const schema = z.object({
            duration_hours: z.number().min(1).optional(),
            reason: z.string().min(1).max(500)
        });

        const { duration_hours, reason } = schema.parse(req.body);

        const bannedUntil = duration_hours
            ? new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString()
            : null;

        await db.execute({
            sql: 'UPDATE users SET is_banned = 1, banned_until = ?, ban_reason = ? WHERE id = ?',
            args: [bannedUntil, reason, req.params.id]
        });

        res.json({ message: 'User banned successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Error banning user:', error);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

// POST /api/admin/users/:id/unban - Unban user
adminRouter.post('/users/:id/unban', requireModerator, async (req, res) => {
    try {
        await db.execute({
            sql: 'UPDATE users SET is_banned = 0, banned_until = NULL, ban_reason = NULL WHERE id = ?',
            args: [req.params.id]
        });

        res.json({ message: 'User unbanned successfully' });
    } catch (error) {
        console.error('Error unbanning user:', error);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

// GET /api/admin/stats - Dashboard statistics
adminRouter.get('/stats', requireModerator, async (req, res) => {
    try {
        const [usersCount, matchesCount, activeToday] = await Promise.all([
            db.execute({ sql: 'SELECT COUNT(*) as count FROM users', args: [] }),
            db.execute({ sql: 'SELECT COUNT(*) as count FROM matches', args: [] }),
            db.execute({
                sql: "SELECT COUNT(DISTINCT user_id) as count FROM matches WHERE DATE(ended_at) = DATE('now')",
                args: []
            })
        ]);

        res.json({
            totalUsers: Number(usersCount.rows[0].count),
            totalMatches: Number(matchesCount.rows[0].count),
            activeUsersToday: Number(activeToday.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});
