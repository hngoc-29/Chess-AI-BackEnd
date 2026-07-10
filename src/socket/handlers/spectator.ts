import { Server, Socket } from 'socket.io';
import { roomManager } from '../../engine/RoomManager';
import { GameRoomError } from '../../engine/GameRoom';
import { ClientEvents, ServerEvents } from '../events';
import { SpectateRoomSchema, parseOrError } from '../../utils/validation';
import { supabaseAdmin } from '../../db/supabase';
import { logger } from '../../utils/logger';

const SPECTATOR_ROOM_PREFIX = 'spectators:';

export function registerSpectatorHandlers(io: Server, socket: Socket) {
  socket.on(ClientEvents.SPECTATE_JOIN, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(SpectateRoomSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });
    if (room.isParticipant(socket.data.userId)) {
      return ack?.({ ok: false, error: 'Players cannot spectate their own game.' });
    }

    try {
      room.addSpectator({
        userId: socket.data.userId,
        socketId: socket.id,
        displayName: socket.data.profile.display_name,
      });
    } catch (err) {
      if (err instanceof GameRoomError) {
        return ack?.({ ok: false, error: err.message, code: err.code });
      }
      throw err;
    }

    socket.join(`${SPECTATOR_ROOM_PREFIX}${room.id}`);
    // Spectators receive the same public state as players (no hidden info exists in chess).
    socket.join(room.id);

    ack?.({ ok: true, room: room.publicState(), moves: room.moveHistory() });
    io.to(room.id).emit(ServerEvents.SPECTATE_STATE, { spectatorCount: room.spectatorCount() });

    // Best-effort audit log — spectator_logs table (see schema). Not on the critical path.
    supabaseAdmin
      .from('spectator_logs')
      .insert({ room_id: room.id, user_id: socket.data.userId, joined_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) logger.warn({ err: error }, 'failed to write spectator_logs row');
      });
  });

  socket.on(ClientEvents.SPECTATE_LEAVE, (payload: { roomId?: string }) => {
    if (!payload?.roomId) return;
    const room = roomManager.get(payload.roomId);
    if (!room) return;
    room.removeSpectator(socket.id);
    socket.leave(`${SPECTATOR_ROOM_PREFIX}${room.id}`);
    socket.leave(room.id);
    io.to(room.id).emit(ServerEvents.SPECTATE_STATE, { spectatorCount: room.spectatorCount() });
  });

  socket.on('disconnect', () => {
    for (const room of roomManager.allActiveRooms()) {
      if (room.spectatorSocketIds().includes(socket.id)) {
        room.removeSpectator(socket.id);
        io.to(room.id).emit(ServerEvents.SPECTATE_STATE, { spectatorCount: room.spectatorCount() });
      }
    }
  });
}
