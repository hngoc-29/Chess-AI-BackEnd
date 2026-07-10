import { Router } from 'express';
import { requireAuth } from '../middleware/httpAuth';
import { CAMPAIGN_LEVELS } from '../campaign/levels';
import { validateCampaignSubmission } from '../campaign/validateCampaign';
import { persistCampaignResult } from '../services/campaignService';
import { query } from '../db/turso';
import { HttpError } from '../middleware/errorHandler';
import { CampaignCompleteSchema, parseOrError } from '../utils/validation';

export const campaignRouter = Router();

campaignRouter.get('/levels', requireAuth, (_req, res) => {
  res.json({
    levels: CAMPAIGN_LEVELS.map((l) => ({
      id: l.id,
      order: l.order,
      title: l.title,
      playerColor: l.playerColor,
    })),
  });
});

/** The logged-in user's progress (completed/stars) across all levels. */
campaignRouter.get('/progress', requireAuth, async (req, res, next) => {
  try {
    const data = await query<{
      level_id: string;
      completed: number;
      stars: number;
      best_duration_ms: number;
      last_attempt_at: string;
    }>(
      'SELECT level_id, completed, stars, best_duration_ms, last_attempt_at FROM user_levels WHERE user_id = ?',
      [req.userId]
    );
    res.json({ progress: data });
  } catch (err) {
    next(err);
  }
});

/**
 * The client plays the level locally against the on-device AI, then submits
 * the resulting move list here. The server re-simulates every move with
 * chess.js before recording anything — see docs/SECURITY.md for exactly
 * what this can and cannot guarantee against a modified client.
 */
campaignRouter.post('/levels/:levelId/complete', requireAuth, async (req, res, next) => {
  try {
    const parsed = parseOrError(CampaignCompleteSchema, { ...req.body, levelId: req.params.levelId });
    if (!parsed.ok) throw new HttpError(400, 'VALIDATION_ERROR', parsed.message);

    const result = validateCampaignSubmission(parsed.data);
    if (!result.valid) {
      throw new HttpError(422, result.reason ?? 'INVALID_SUBMISSION', 'Submitted game could not be validated.');
    }

    const persisted = await persistCampaignResult(req.userId!, parsed.data, result);
    res.json({
      completed: result.completed,
      stars: result.stars,
      suspicious: result.suspicious,
      replayId: persisted.replayId,
    });
  } catch (err) {
    next(err);
  }
});
