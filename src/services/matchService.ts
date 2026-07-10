import { execute, transaction } from '../db/turso';
import { GameRoom } from '../engine/GameRoom';
import { computeEloDelta } from '../engine/elo';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

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
  const matchId = nanoid();

  try {
    await transaction(async () => {
      // Insert match record
      await execute(
        `INSERT INTO matches (
          id, white_id, black_id, winner_id, result_type, rated,
          time_control, white_time_left_ms, black_time_left_ms, moves_count,
          pgn, final_fen, started_at, ended_at, duration_ms,
          white_elo_before, white_elo_after, black_elo_before, black_elo_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matchId,
          room.white.userId,
          room.black.userId,
          winnerId,
          resultType,
          room.settings.rated ? 1 : 0,
          `${room.settings.timeControl.initialMs / 1000}+${room.settings.timeControl.incrementMs / 1000}`,
          room.clockSnapshot().whiteTimeLeftMs,
          room.clockSnapshot().blackTimeLeftMs,
          room.moveHistory().length,
          room.pgn(),
          room.fen(),
          new Date(startedAt).toISOString(),
          new Date(endedAt).toISOString(),
          endedAt - startedAt,
          whiteEloBefore,
          whiteEloAfter,
          blackEloBefore,
          blackEloAfter,
        ]
      );

      // Update player Elos if rated
      if (room.settings.rated) {
        await execute('UPDATE users SET elo = ? WHERE id = ?', [whiteEloAfter, room.white.userId]);
        await execute('UPDATE users SET elo = ? WHERE id = ?', [blackEloAfter, room.black.userId]);
      }
    });

    return { matchId, whiteEloAfter, blackEloAfter };
  } catch (error) {
    logger.error({ err: error }, 'failed to persist match');
    throw new Error('MATCH_PERSIST_FAILED');
  }
}
