export type Color = 'w' | 'b';

export type GameResultType =
  | 'checkmate'
  | 'resign'
  | 'timeout'
  | 'stalemate'
  | 'draw_agreement'
  | 'threefold_repetition'
  | 'fifty_move_rule'
  | 'insufficient_material'
  | 'abandoned';

export type RoomMode = 'ranked' | 'custom' | 'campaign';

export interface AuthedUser {
  id: string; // Supabase auth.users.id (uuid)
  email?: string | null;
}

export interface PlayerSlot {
  userId: string;
  socketId: string | null; // null while disconnected (grace period)
  color: Color;
  displayName: string;
  elo: number;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface TimeControl {
  initialMs: number;
  incrementMs: number;
}

export interface MoveRecord {
  index: number; // 0-based ply index — used as an anti-replay / ordering guard
  san: string;
  fen: string; // resulting FEN after the move
  byUserId: string;
  clientTimestamp?: number;
  serverTimestamp: number;
  whiteTimeLeftMs: number;
  blackTimeLeftMs: number;
}

export interface RoomSettings {
  mode: RoomMode;
  rated: boolean;
  timeControl: TimeControl;
  allowSpectators: boolean;
  maxSpectators: number;
  password?: string | null;
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}
