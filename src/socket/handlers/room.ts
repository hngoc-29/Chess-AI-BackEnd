import { Server, Socket } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { roomManager } from '../../engine/RoomManager';
import { GameRoom } from '../../engine/GameRoom';
import { PlayerSlot, RoomSettings } from '../../types';
import { ClientEvents, ServerEvents } from '../events';
import { CreateRoomSchema, JoinRoomSchema, parseOrError } from '../../utils/validation';
import { logger } from '../../utils/logger';

const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const PENDING_TTL_MS = 10 * 60_000;

interface PendingRoom {
  code: string;
  host: PlayerSlot;
  settings: RoomSettings;
  createdAt: number;
}

// code -> pending room waiting for a second player. Cleared on join/expiry/host disconnect.
const pendingRooms = new Map<string, PendingRoom>();

function slotFromSocket(socket: Socket, color: 'w' | 'b'): PlayerSlot {
  return {
    userId: socket.data.userId,
    socketId: socket.id,
    color,
    displayName: socket.data.profile.display_name,
    elo: socket.data.profile.elo,
    connected: true,
    disconnectedAt: null,
  };
}

function emitRoomError(socket: Socket, message: string) {
  socket.emit(ServerEvents.ROOM_ERROR, { code: 'ROOM_ERROR', message });
}

export function cleanupExpiredPendingRooms() {
  const now = Date.now();
  for (const [code, pending] of pendingRooms.entries()) {
    if (now - pending.createdAt > PENDING_TTL_MS) pendingRooms.delete(code);
  }
}

export function registerRoomHandlers(io: Server, socket: Socket) {
  socket.on(ClientEvents.ROOM_CREATE, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(CreateRoomSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    if (roomManager.getActiveRoomForUser(socket.data.userId)) {
      return ack?.({ ok: false, error: 'You already have an active game.' });
    }

    const hostColor = Math.random() < 0.5 ? 'w' : 'b';
    const host = slotFromSocket(socket, hostColor);
    const settings: RoomSettings = {
      mode: 'custom',
      rated: parsed.data.rated,
      timeControl: {
        initialMs: parsed.data.timeControlMinutes * 60_000,
        incrementMs: parsed.data.incrementSeconds * 1000,
      },
      allowSpectators: parsed.data.allowSpectators,
      maxSpectators: parsed.data.maxSpectators,
      password: parsed.data.password ?? null,
    };

    const code = codeGen();
    pendingRooms.set(code, { code, host, settings, createdAt: Date.now() });
    socket.join(`pending:${code}`);

    ack?.({ ok: true, code });
    socket.emit(ServerEvents.ROOM_CREATED, { code });
  });

  socket.on(ClientEvents.ROOM_JOIN, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(JoinRoomSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    const pending = pendingRooms.get(parsed.data.code.toUpperCase());
    if (!pending) return ack?.({ ok: false, error: 'Room not found or already started.' });

    if (pending.settings.password && pending.settings.password !== parsed.data.password) {
      return ack?.({ ok: false, error: 'Incorrect room password.' });
    }
    if (pending.host.userId === socket.data.userId) {
      return ack?.({ ok: false, error: 'You cannot join your own room.' });
    }
    if (roomManager.getActiveRoomForUser(socket.data.userId)) {
      return ack?.({ ok: false, error: 'You already have an active game.' });
    }

    pendingRooms.delete(pending.code);

    const joinerColor = pending.host.color === 'w' ? 'b' : 'w';
    const joiner = slotFromSocket(socket, joinerColor);
    const white = pending.host.color === 'w' ? pending.host : joiner;
    const black = pending.host.color === 'w' ? joiner : pending.host;

    const room = roomManager.createRoom(white, black, pending.settings);

    const hostSocket = io.sockets.sockets.get(pending.host.socketId!);
    hostSocket?.leave(`pending:${pending.code}`);
    hostSocket?.join(room.id);
    socket.join(room.id);

    ack?.({ ok: true, room: room.publicState(), yourColor: joinerColor });
    hostSocket?.emit(ServerEvents.ROOM_JOINED, { room: room.publicState(), yourColor: pending.host.color });

    logger.info({ roomId: room.id, code: pending.code }, 'custom room started');
  });

  socket.on(ClientEvents.ROOM_LEAVE, (payload: { roomId?: string }) => {
    // Only meaningful before a match starts (leaving a pending room you host).
    for (const [code, pending] of pendingRooms.entries()) {
      if (pending.host.userId === socket.data.userId) pendingRooms.delete(code);
    }
    if (payload?.roomId) socket.leave(payload.roomId);
  });

  socket.on(ClientEvents.ROOM_REMATCH_REQUEST, (payload: { roomId: string }, ack?: (res: any) => void) => {
    const room = roomManager.get(payload?.roomId);
    if (!room || room.status !== 'finished') return ack?.({ ok: false, error: 'Room not finished yet.' });
    if (!room.isParticipant(socket.data.userId)) return ack?.({ ok: false, error: 'Not a participant.' });

    const opponent = room.white.userId === socket.data.userId ? room.black : room.white;
    const opponentSocket = opponent.socketId ? io.sockets.sockets.get(opponent.socketId) : undefined;
    ack?.({ ok: true });
    opponentSocket?.emit(ServerEvents.ROOM_REMATCH_OFFERED, { roomId: room.id, from: socket.data.userId });
  });

  socket.on(
    ClientEvents.ROOM_REMATCH_RESPOND,
    (payload: { roomId: string; accept: boolean }, ack?: (res: any) => void) => {
      const oldRoom = roomManager.get(payload?.roomId);
      if (!oldRoom || oldRoom.status !== 'finished') return ack?.({ ok: false, error: 'Room not finished yet.' });
      if (!payload.accept) return ack?.({ ok: true });

      // Swap colors for the rematch.
      const newWhiteSlot = slotFromSocket(
        io.sockets.sockets.get(oldRoom.black.socketId!) ?? socket,
        'w',
      );
      const newBlackSlot = slotFromSocket(
        io.sockets.sockets.get(oldRoom.white.socketId!) ?? socket,
        'b',
      );
      newWhiteSlot.userId = oldRoom.black.userId;
      newWhiteSlot.displayName = oldRoom.black.displayName;
      newWhiteSlot.elo = oldRoom.black.elo;
      newBlackSlot.userId = oldRoom.white.userId;
      newBlackSlot.displayName = oldRoom.white.displayName;
      newBlackSlot.elo = oldRoom.white.elo;

      const newRoom: GameRoom = roomManager.createRoom(newWhiteSlot, newBlackSlot, oldRoom.settings);

      const whiteSocket = newWhiteSlot.socketId ? io.sockets.sockets.get(newWhiteSlot.socketId) : undefined;
      const blackSocket = newBlackSlot.socketId ? io.sockets.sockets.get(newBlackSlot.socketId) : undefined;
      whiteSocket?.join(newRoom.id);
      blackSocket?.join(newRoom.id);

      whiteSocket?.emit(ServerEvents.MATCH_FOUND, { room: newRoom.publicState(), yourColor: 'w' });
      blackSocket?.emit(ServerEvents.MATCH_FOUND, { room: newRoom.publicState(), yourColor: 'b' });
      ack?.({ ok: true, roomId: newRoom.id });
    },
  );

  socket.on('disconnect', () => {
    for (const [code, pending] of pendingRooms.entries()) {
      if (pending.host.userId === socket.data.userId) pendingRooms.delete(code);
    }
  });
}
