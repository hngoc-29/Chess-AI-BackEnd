import { supabaseAdmin } from '../db/supabase';
import { logger } from '../utils/logger';
import { CampaignSubmission, CampaignValidationResult } from '../campaign/validateCampaign';

export async function persistCampaignResult(
  userId: string,
  sub: CampaignSubmission,
  result: CampaignValidationResult,
) {
  const { data: replay, error: replayError } = await supabaseAdmin
    .from('level_replays')
    .insert({
      user_id: userId,
      level_id: sub.levelId,
      pgn: result.pgn,
      final_fen: result.finalFen,
      moves_count: sub.moves.length,
      duration_ms: sub.durationMs,
      completed: result.completed,
      suspicious: result.suspicious,
    })
    .select('id')
    .single();

  if (replayError) {
    logger.error({ err: replayError }, 'failed to persist level replay');
    throw new Error('REPLAY_PERSIST_FAILED');
  }

  if (result.completed) {
    // Only ever raise stars/mark complete — never let a later, worse replay downgrade progress.
    const { data: existing } = await supabaseAdmin
      .from('user_levels')
      .select('stars, completed')
      .eq('user_id', userId)
      .eq('level_id', sub.levelId)
      .maybeSingle();

    const bestStars = Math.max(existing?.stars ?? 0, result.stars);

    await supabaseAdmin.from('user_levels').upsert(
      {
        user_id: userId,
        level_id: sub.levelId,
        completed: true,
        stars: bestStars,
        best_duration_ms: sub.durationMs,
        best_replay_id: replay.id,
        last_attempt_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,level_id' },
    );
  }

  return { replayId: replay.id as string };
}
