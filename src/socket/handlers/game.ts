import { Server, Socket } from 'socket.io';
import { roomManager } from '../../engine/RoomManager';
import { GameRoom, GameRoomError } from '../../engine/GameRoom';
import { finishAndBroadcast } from '../broadcast';
import { maybeTriggerBotMove, maybeRespondToDrawOffer } from '../../bot/botController';
import { ClientEvents, ServerEvents } from '../events';
import {
  DrawResponseSchema,
  MakeMoveSchema,
  RoomActionSchema,
  parseOrError,
} from '../../utils/validation';
import { SocketEventLimiter } from '../../middleware/rateLimiter';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const moveLimiter = new SocketEventLimiter(env.SOCKET_MOVE_RATE_LIMIT_PER_SEC);

// userId -> pending forfeit timer, so a reconnect within the grace period cancels it.
const abandonTimers = new Map<string, NodeJS.Timeout>();

export function registerGameHandlers(io: Server, socket: Socket) {
  // Cancel any pending abandon-forfeit for this user across their rooms on (re)connect.
  const existingTimer = abandonTimers.get(socket.data.userId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    abandonTimers.delete(socket.data.userId);
  }
  const activeRoom = roomManager.getActiveRoomForUser(socket.data.userId);
  if (activeRoom) {
    const slot = activeRoom.slotForUser(socket.data.userId);
    if (slot) {
      slot.socketId = socket.id;
      slot.connected = true;
      slot.disconnectedAt = null;
      socket.join(activeRoom.id);
      socket.emit(ServerEvents.GAME_STATE, activeRoom.publicState());
      io.to(activeRoom.id).emit(ServerEvents.GAME_STATE, activeRoom.publicState());
    }
  }

  socket.on(ClientEvents.GAME_SYNC_REQUEST, (payload: { roomId: string }, ack?: (res: any) => void) => {
    const room = roomManager.get(payload?.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });
    ack?.({ ok: true, room: room.publicState(), moves: room.moveHistory() });
  });

  socket.on(ClientEvents.GAME_MOVE, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(MakeMoveSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    if (!moveLimiter.allow(socket.data.userId)) {
      return ack?.({ ok: false, error: 'Too many moves too fast.' });
    }

    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });

    try {
      const move = room.applyMove({
        userId: socket.data.userId,
        from: parsed.data.from,
        to: parsed.data.to,
        // MakeMoveSchema accepts promotion as null (matching what real
        // clients send for a non-promotion move); GameRoom.applyMove only
        // distinguishes "no promotion" via undefined, so normalize here.
        promotion: parsed.data.promotion ?? undefined,
        expectedMoveIndex: parsed.data.expectedMoveIndex,
        clientTimestamp: parsed.data.clientTimestamp,
      });

      ack?.({ ok: true, move });
      io.to(room.id).emit(ServerEvents.GAME_MOVE_APPLIED, { roomId: room.id, move, state: room.publicState() });

      if (room.status === 'finished') {
        void finishAndBroadcast(io, room);
      } else {
        maybeTriggerBotMove(io, room);
      }
    } catch (err) {
      if (err instanceof GameRoomError) {
        ack?.({ ok: false, error: err.message, code: err.code });
        socket.emit(ServerEvents.GAME_ERROR, { code: err.code, message: err.message });
        if (err.code === 'FLAGGED') void finishAndBroadcast(io, room);
      } else {
        logger.error({ err }, 'unexpected error applying move');
        ack?.({ ok: false, error: 'Internal error.' });
      }
    }
  });

  socket.on(ClientEvents.GAME_RESIGN, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(RoomActionSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });
    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });
    try {
      room.resign(socket.data.userId);
      ack?.({ ok: true });
      void finishAndBroadcast(io, room);
    } catch (err) {
      if (err instanceof GameRoomError) ack?.({ ok: false, error: err.message, code: err.code });
    }
  });

  socket.on(ClientEvents.GAME_DRAW_OFFER, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(RoomActionSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });
    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });
    try {
      room.offerDraw(socket.data.userId);
      ack?.({ ok: true });
      io.to(room.id).emit(ServerEvents.GAME_STATE, room.publicState());
      maybeRespondToDrawOffer(io, room);
    } catch (err) {
      if (err instanceof GameRoomError) ack?.({ ok: false, error: err.message, code: err.code });
    }
  });

  socket.on(ClientEvents.GAME_DRAW_RESPOND, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(DrawResponseSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });
    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });
    try {
      room.respondDraw(socket.data.userId, parsed.data.accept);
      ack?.({ ok: true });
      if (room.status === 'finished') {
        void finishAndBroadcast(io, room);
      } else {
        io.to(room.id).emit(ServerEvents.GAME_STATE, room.publicState());
      }
    } catch (err) {
      if (err instanceof GameRoomError) ack?.({ ok: false, error: err.message, code: err.code });
    }
  });

  socket.on('disconnect', () => {
    const room = roomManager.getActiveRoomForUser(socket.data.userId);
    if (!room) return;
    const slot = room.slotForUser(socket.data.userId);
    if (!slot) return;

    slot.connected = false;
    slot.disconnectedAt = Date.now();
    io.to(room.id).emit(ServerEvents.GAME_STATE, room.publicState());

    const timer = setTimeout(() => {
      // Still disconnected after the grace period and the game is still active -> forfeit.
      if (!slot.connected && room.status === 'active') {
        room.forfeitByAbandon(socket.data.userId);
        void finishAndBroadcast(io, room);
      }
      abandonTimers.delete(socket.data.userId);
    }, env.RECONNECT_GRACE_MS);

    abandonTimers.set(socket.data.userId, timer);
  });
}
