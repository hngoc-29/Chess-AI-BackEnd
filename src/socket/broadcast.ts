import { Server } from 'socket.io';
import { GameRoom } from '../engine/GameRoom';
import { persistFinishedMatch } from '../services/matchService';
import { ServerEvents } from './events';
import { logger } from '../utils/logger';

/**
 * Broadcasts GAME_OVER and persists the finished match. Shared by game.ts
 * (human resign/checkmate/timeout) and botController.ts (bot-caused
 * checkmate/stalemate) so both game-ending paths behave identically -
 * a bot-backed game is persisted and Elo-updated exactly like a real one.
 */
export async function finishAndBroadcast(io: Server, room: GameRoom): Promise<void> {
  io.to(room.id).emit(ServerEvents.GAME_OVER, {
    roomId: room.id,
    result: room.result,
    pgn: room.pgn(),
    finalFen: room.fen(),
  });
  try {
    if (room.settings.mode !== 'campaign') {
      const persisted = await persistFinishedMatch(room);
      io.to(room.id).emit(ServerEvents.GAME_STATE, { ...room.publicState(), ...persisted });
    }
  } catch (err) {
    logger.error({ err, roomId: room.id }, 'failed to persist finished match');
  }
}
