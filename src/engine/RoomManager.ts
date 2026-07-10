import { customAlphabet } from 'nanoid';
import { GameRoom } from './GameRoom';
import { PlayerSlot, RoomSettings } from '../types';
import { logger } from '../utils/logger';

// Unambiguous alphabet (no 0/O/1/I) for human-typed room codes.
const roomCodeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private codeToRoomId = new Map<string, string>();
  private userToRoomId = new Map<string, string>(); // one active room per user

  createRoom(white: PlayerSlot, black: PlayerSlot, settings: RoomSettings): GameRoom {
    const room = new GameRoom(white, black, settings);
    this.rooms.set(room.id, room);
    this.userToRoomId.set(white.userId, room.id);
    this.userToRoomId.set(black.userId, room.id);

    if (settings.mode === 'custom') {
      const code = roomCodeGen();
      this.codeToRoomId.set(code, room.id);
      (room as any).joinCode = code; // attached for custom rooms only
    }

    room.start();
    logger.info({ roomId: room.id, mode: settings.mode }, 'room created');
    return room;
  }

  get(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  getByCode(code: string): GameRoom | undefined {
    const id = this.codeToRoomId.get(code.toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  getActiveRoomForUser(userId: string): GameRoom | undefined {
    const id = this.userToRoomId.get(userId);
    if (!id) return undefined;
    const room = this.rooms.get(id);
    if (room && room.status !== 'finished') return room;
    return undefined;
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.userToRoomId.delete(room.white.userId);
    this.userToRoomId.delete(room.black.userId);
    for (const [code, id] of this.codeToRoomId.entries()) {
      if (id === roomId) this.codeToRoomId.delete(code);
    }
    this.rooms.delete(roomId);
  }

  allActiveRooms(): GameRoom[] {
    return [...this.rooms.values()].filter((r) => r.status === 'active');
  }

  stats() {
    return { totalRooms: this.rooms.size, activeRooms: this.allActiveRooms().length };
  }
}

export const roomManager = new RoomManager();
