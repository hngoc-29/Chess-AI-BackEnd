import { supabaseAdmin } from '../db/supabase';
import { GameRoom } from '../engine/GameRoom';
import { computeEloDelta } from '../engine/elo';
import { logger } from '../utils/logger';

export async function persistFinishedMatch(room: GameRoom) {
  if (room.status !== 'finished' || !room.result) {
    throw new Error('persistFinishedMatch called on a non-finished room');
  }

  const { resultType, winnerColor } = room.result;
  const winnerId =
    winnerColor === 'w' ? room.white.userId : winnerColor === 'b' ? room.black.userId : null;

  let whiteEloBefore = room.white.elo;
  let blackEloBefore = room.black.elo;
  let whiteEloAfter = whiteEloBefore;
  let blackEloAfter = blackEloBefore;

  if (room.settings.rated) {
    const outcome = winnerColor === 'w' ? 'white' : winnerColor === 'b' ? 'black' : 'draw';
    const delta = computeEloDelta(whiteEloBefore, blackEloBefore, outcome);
    whiteEloAfter = delta.whiteAfter;
    blackEloAfter = delta.blackAfter;
  }

  const startedAt = room.startedAt ?? room.createdAt;
  const endedAt = room.endedAt ?? Date.now();

  const { data, error } = await supabaseAdmin
    .from('matches')
    .insert({
      white_id: room.white.userId,
      black_id: room.black.userId,
      winner_id: winnerId,
      result_type: resultType,
      rated: room.settings.rated,
      time_control: `${room.settings.timeControl.initialMs / 1000}+${room.settings.timeControl.incrementMs / 1000}`,
      white_time_left_ms: room.clockSnapshot().whiteTimeLeftMs,
      black_time_left_ms: room.clockSnapshot().blackTimeLeftMs,
      moves_count: room.moveHistory().length,
      pgn: room.pgn(),
      final_fen: room.fen(),
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      duration_ms: endedAt - startedAt,
      white_elo_before: whiteEloBefore,
      white_elo_after: whiteEloAfter,
      black_elo_before: blackEloBefore,
      black_elo_after: blackEloAfter,
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ err: error }, 'failed to persist match');
    throw new Error('MATCH_PERSIST_FAILED');
  }

  if (room.settings.rated) {
    await Promise.all([
      supabaseAdmin.from('users').update({ elo: whiteEloAfter }).eq('id', room.white.userId),
      supabaseAdmin.from('users').update({ elo: blackEloAfter }).eq('id', room.black.userId),
    ]);
  }

  return { matchId: data.id as string, whiteEloAfter, blackEloAfter };
}
