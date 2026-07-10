import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/httpAuth';
import { supabaseAdmin } from '../db/supabase';
import { HttpError } from '../middleware/errorHandler';

export const matchesRouter = Router();

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(), // cursor: ended_at of the last item you saw
});

/** Match history for the logged-in user (as white or black), newest first. */
matchesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const query = ListQuerySchema.parse(req.query);
    let q = supabaseAdmin
      .from('matches')
      .select(
        'id, white_id, black_id, winner_id, result_type, rated, time_control, moves_count, started_at, ended_at, duration_ms, white_elo_before, white_elo_after, black_elo_before, black_elo_after',
      )
      .or(`white_id.eq.${req.userId},black_id.eq.${req.userId}`)
      .order('ended_at', { ascending: false })
      .limit(query.limit);

    if (query.before) q = q.lt('ended_at', query.before);

    const { data, error } = await q;
    if (error) throw new HttpError(500, 'DB_ERROR', error.message);
    res.json({ matches: data });
  } catch (err) {
    next(err);
  }
});

/** Full replay (PGN + final FEN) for a single match. Only participants can fetch it. */
matchesRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('matches')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new HttpError(500, 'DB_ERROR', error.message);
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'Match not found.');
    if (data.white_id !== req.userId && data.black_id !== req.userId) {
      throw new HttpError(403, 'FORBIDDEN', 'You were not a participant in this match.');
    }
    res.json({ match: data });
  } catch (err) {
    next(err);
  }
});
