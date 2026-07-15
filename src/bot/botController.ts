import { Server } from 'socket.io';
import { GameRoom, GameRoomError } from '../engine/GameRoom';
import { finishAndBroadcast } from '../socket/broadcast';
import { ServerEvents } from '../socket/events';
import { pickBotMove, thinkingDelayMs, shouldAcceptDraw } from './botEngine';
import { logger } from '../utils/logger';
import { Color } from '../types';

interface BotRoomInfo {
  botUserId: string;
  botColor: Color;
  botElo: number;
}

/**
 * roomId -> bot info, for rooms created by matchmaking's AI-fallback (see
 * matchmaking.ts). A room is only ever in here if one of its two seats is a
 * bot account; everything else in game.ts behaves exactly as it does for a
 * normal two-human room.
 */
const botRooms = new Map<string, BotRoomInfo>();

export function registerBotRoom(roomId: string, botUserId: string, botColor: Color, botElo: number): void {
  botRooms.set(roomId, { botUserId, botColor, botElo });
}

export function roomHasBot(roomId: string): boolean {
  return botRooms.has(roomId);
}

function cleanupIfFinished(room: GameRoom): void {
  if (room.status !== 'active') botRooms.delete(room.id);
}

/**
 * Call after any successful human move, and once right after a bot-backed
 * room is created (in case the bot was assigned White and needs an opening
 * move). No-ops for rooms without a bot, or when it isn't the bot's turn.
 *
 * Deliberately does NOT re-call itself after the bot's own move: once the
 * bot moves, it becomes the human's turn, and their next real move re-enters
 * this same hook from game.ts - no self-scheduling loop needed.
 */
export function maybeTriggerBotMove(io: Server, room: GameRoom): void {
  const info = botRooms.get(room.id);
  if (!info) return;
  if (room.status !== 'active') {
    cleanupIfFinished(room);
    return;
  }
  if (room.publicState().turn !== info.botColor) return;

  setTimeout(() => {
    try {
      if (room.status !== 'active') {
        cleanupIfFinished(room);
        return;
      }

      const choice = pickBotMove(room.fen(), info.botElo);
      if (!choice) return; // no legal moves - checkAutomaticEndConditions will have already finished the room

      const move = room.applyMove({
        userId: info.botUserId,
        from: choice.from,
        to: choice.to,
        promotion: choice.promotion,
      });

      io.to(room.id).emit(ServerEvents.GAME_MOVE_APPLIED, { roomId: room.id, move, state: room.publicState() });
      logger.debug({ roomId: room.id, botUserId: info.botUserId, san: choice.san }, 'bot move applied');

      // Cast: TS narrows room.status to the literal 'active' from the guard
      // above and doesn't know room.applyMove() can mutate it internally
      // (e.g. on checkmate), so it otherwise flags this as an impossible
      // comparison. It isn't - status is genuinely re-read after the call.
      if ((room.status as string) === 'finished') {
        void finishAndBroadcast(io, room);
        botRooms.delete(room.id);
      }
    } catch (err) {
      // Should be rare (e.g. a human resigned in the same instant the bot's
      // move was about to land) - log and drop rather than crash the server.
      if (err instanceof GameRoomError) {
        logger.warn({ roomId: room.id, code: err.code }, 'bot move rejected, dropping');
      } else {
        logger.error({ err, roomId: room.id }, 'unexpected error applying bot move');
      }
    }
  }, thinkingDelayMs(info.botElo));
}

/**
 * Call right after a human's GAME_DRAW_OFFER is applied. If the room has a
 * bot opponent, it decides immediately (short delay for realism) instead of
 * the offer sitting unanswered forever, since a bot never opens the real
 * "accept/decline" UI a human opponent would.
 */
export function maybeRespondToDrawOffer(io: Server, room: GameRoom): void {
  const info = botRooms.get(room.id);
  if (!info) return;
  if (room.status !== 'active') return;

  setTimeout(() => {
    try {
      if (room.status !== 'active') return;
      const accept = shouldAcceptDraw(room.fen(), info.botColor);
      room.respondDraw(info.botUserId, accept);

      // See the comment in maybeTriggerBotMove - same TS narrowing quirk.
      if ((room.status as string) === 'finished') {
        void finishAndBroadcast(io, room);
        botRooms.delete(room.id);
      } else {
        io.to(room.id).emit(ServerEvents.GAME_STATE, room.publicState());
      }
    } catch (err) {
      if (err instanceof GameRoomError) {
        logger.warn({ roomId: room.id, code: err.code }, 'bot draw response rejected, dropping');
      } else {
        logger.error({ err, roomId: room.id }, 'unexpected error responding to draw offer');
      }
    }
  }, 900 + Math.random() * 1600);
}
