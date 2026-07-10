import { execute, queryOne, transaction } from '../db/turso';
import { logger } from '../utils/logger';
import { CampaignSubmission, CampaignValidationResult } from '../campaign/validateCampaign';
import { nanoid } from 'nanoid';

export async function persistCampaignResult(
  userId: string,
  sub: CampaignSubmission,
  result: CampaignValidationResult,
) {
  const replayId = nanoid();

  try {
    await transaction(async () => {
      // Insert replay record
      await execute(
        `INSERT INTO level_replays (
          id, user_id, level_id, pgn, final_fen, moves_count,
          duration_ms, completed, suspicious
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          replayId,
          userId,
          sub.levelId,
          result.pgn,
          result.finalFen,
          sub.moves.length,
          sub.durationMs,
          result.completed ? 1 : 0,
          result.suspicious ? 1 : 0,
        ]
      );

      if (result.completed) {
        // Only ever raise stars/mark complete — never let a later, worse replay downgrade progress.
        const existing = await queryOne<{ stars: number; completed: number }>(
          'SELECT stars, completed FROM user_levels WHERE user_id = ? AND level_id = ?',
          [userId, sub.levelId]
        );

        const bestStars = Math.max(existing?.stars ?? 0, result.stars);

        if (existing) {
          // Update existing record
          await execute(
            `UPDATE user_levels SET 
              completed = 1,
              stars = ?,
              best_duration_ms = ?,
              best_replay_id = ?,
              attempts = attempts + 1,
              last_attempt_at = datetime('now')
            WHERE user_id = ? AND level_id = ?`,
            [bestStars, sub.durationMs, replayId, userId, sub.levelId]
          );
        } else {
          // Insert new record
          await execute(
            `INSERT INTO user_levels (
              user_id, level_id, completed, stars, best_duration_ms,
              best_replay_id, attempts, last_attempt_at
            ) VALUES (?, ?, 1, ?, ?, ?, 1, datetime('now'))`,
            [userId, sub.levelId, bestStars, sub.durationMs, replayId]
          );
        }
      }
    });

    return { replayId };
  } catch (error) {
    logger.error({ err: error }, 'failed to persist campaign result');
    throw new Error('CAMPAIGN_PERSIST_FAILED');
  }
}
