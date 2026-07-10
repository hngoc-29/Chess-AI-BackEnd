import { Router } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { httpAuth } from '../middleware/httpAuth';
import { db } from '../db/turso';
import { z } from 'zod';
import { nanoid } from 'nanoid';

export const adminLevelsRouter = Router();

// Tất cả routes yêu cầu admin authentication
adminLevelsRouter.use(httpAuth, requireAdmin);

// ============================================================================
// CAMPAIGN LEVELS MANAGEMENT
// ============================================================================

// GET /api/admin/levels - Lấy danh sách levels
adminLevelsRouter.get('/', async (req, res) => {
    try {
        const published = req.query.published as string;

        let sql = 'SELECT * FROM campaign_levels';
        const args: any[] = [];

        if (published === 'true' || published === 'false') {
            sql += ' WHERE is_published = ?';
            args.push(published === 'true' ? 1 : 0);
        }

        sql += ' ORDER BY order_index ASC';

        const result = await db.execute({ sql, args });

        res.json({ levels: result.rows });
    } catch (error) {
        console.error('Error fetching levels:', error);
        res.status(500).json({ error: 'Failed to fetch levels' });
    }
});

// GET /api/admin/levels/:id - Lấy chi tiết level
adminLevelsRouter.get('/:id', async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM campaign_levels WHERE id = ?',
            args: [req.params.id]
        });

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Level not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching level:', error);
        res.status(500).json({ error: 'Failed to fetch level' });
    }
});

// POST /api/admin/levels - Tạo level mới
adminLevelsRouter.post('/', async (req, res) => {
    try {
        const schema = z.object({
            title: z.string().min(1).max(100),
            description: z.string().min(1).max(1000),
            difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
            order_index: z.number().int().min(0),
            initial_fen: z.string().min(1),
            target_objective: z.string().min(1).max(200),
            time_limit_ms: z.number().int().min(0).optional(),
            star_thresholds: z.object({
                '1': z.number().int().min(0),
                '2': z.number().int().min(0),
                '3': z.number().int().min(0)
            }),
            ai_level: z.number().int().min(800).max(2800),
            is_published: z.boolean().optional()
        });

        const data = schema.parse(req.body);
        const user = (req as any).user;
        const levelId = nanoid();

        await db.execute({
            sql: `INSERT INTO campaign_levels 
            (id, title, description, difficulty, order_index, initial_fen, 
             target_objective, time_limit_ms, star_thresholds, ai_level, 
             is_published, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                levelId,
                data.title,
                data.description,
                data.difficulty,
                data.order_index,
                data.initial_fen,
                data.target_objective,
                data.time_limit_ms || null,
                JSON.stringify(data.star_thresholds),
                data.ai_level,
                data.is_published ? 1 : 0,
                user.id
            ]
        });

        res.status(201).json({
            message: 'Level created successfully',
            levelId
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Error creating level:', error);
        res.status(500).json({ error: 'Failed to create level' });
    }
});

// PATCH /api/admin/levels/:id - Cập nhật level
adminLevelsRouter.patch('/:id', async (req, res) => {
    try {
        const schema = z.object({
            title: z.string().min(1).max(100).optional(),
            description: z.string().min(1).max(1000).optional(),
            difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
            order_index: z.number().int().min(0).optional(),
            initial_fen: z.string().min(1).optional(),
            target_objective: z.string().min(1).max(200).optional(),
            time_limit_ms: z.number().int().min(0).optional().nullable(),
            star_thresholds: z.object({
                '1': z.number().int().min(0),
                '2': z.number().int().min(0),
                '3': z.number().int().min(0)
            }).optional(),
            ai_level: z.number().int().min(800).max(2800).optional(),
            is_published: z.boolean().optional()
        });

        const data = schema.parse(req.body);
        const updates: string[] = [];
        const args: any[] = [];

        if (data.title !== undefined) {
            updates.push('title = ?');
            args.push(data.title);
        }
        if (data.description !== undefined) {
            updates.push('description = ?');
            args.push(data.description);
        }
        if (data.difficulty !== undefined) {
            updates.push('difficulty = ?');
            args.push(data.difficulty);
        }
        if (data.order_index !== undefined) {
            updates.push('order_index = ?');
            args.push(data.order_index);
        }
        if (data.initial_fen !== undefined) {
            updates.push('initial_fen = ?');
            args.push(data.initial_fen);
        }
        if (data.target_objective !== undefined) {
            updates.push('target_objective = ?');
            args.push(data.target_objective);
        }
        if (data.time_limit_ms !== undefined) {
            updates.push('time_limit_ms = ?');
            args.push(data.time_limit_ms);
        }
        if (data.star_thresholds !== undefined) {
            updates.push('star_thresholds = ?');
            args.push(JSON.stringify(data.star_thresholds));
        }
        if (data.ai_level !== undefined) {
            updates.push('ai_level = ?');
            args.push(data.ai_level);
        }
        if (data.is_published !== undefined) {
            updates.push('is_published = ?');
            args.push(data.is_published ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        args.push(req.params.id);

        await db.execute({
            sql: `UPDATE campaign_levels SET ${updates.join(', ')} WHERE id = ?`,
            args
        });

        res.json({ message: 'Level updated successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Error updating level:', error);
        res.status(500).json({ error: 'Failed to update level' });
    }
});

// DELETE /api/admin/levels/:id - Xóa level
adminLevelsRouter.delete('/:id', async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM campaign_levels WHERE id = ?',
            args: [req.params.id]
        });

        res.json({ message: 'Level deleted successfully' });
    } catch (error) {
        console.error('Error deleting level:', error);
        res.status(500).json({ error: 'Failed to delete level' });
    }
});

// GET /api/admin/levels/:id/stats - Thống kê level
adminLevelsRouter.get('/:id/stats', async (req, res) => {
    try {
        const [attemptsResult, completedResult, avgStarsResult] = await Promise.all([
            db.execute({
                sql: 'SELECT COUNT(*) as count FROM level_replays WHERE level_id = ?',
                args: [req.params.id]
            }),
            db.execute({
                sql: 'SELECT COUNT(*) as count FROM user_levels WHERE level_id = ? AND completed = 1',
                args: [req.params.id]
            }),
            db.execute({
                sql: 'SELECT AVG(stars) as avg FROM user_levels WHERE level_id = ? AND completed = 1',
                args: [req.params.id]
            })
        ]);

        res.json({
            totalAttempts: Number(attemptsResult.rows[0].count),
            totalCompleted: Number(completedResult.rows[0].count),
            averageStars: Number(avgStarsResult.rows[0].avg) || 0
        });
    } catch (error) {
        console.error('Error fetching level stats:', error);
        res.status(500).json({ error: 'Failed to fetch level stats' });
    }
});
