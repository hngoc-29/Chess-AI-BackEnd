import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { GameClock } from './clock';
import {
  Color,
  GameResultType,
  MoveRecord,
  PlayerSlot,
  RoomSettings,
} from '../types';

export interface GameResult {
  resultType: GameResultType;
  winnerColor: Color | null; // null = draw
}

export type RoomStatus = 'waiting' | 'active' | 'finished';

interface SpectatorSlot {
  userId: string;
  socketId: string;
  displayName: string;
}

/**
 * One instance per live match. Lives only in server RAM while the game is
 * in progress — nothing here is ever trusted from the client. The client
 * sends *intents* (move from->to, resign, offer draw); this class is the
 * only thing that decides what actually happened.
 */
export class GameRoom {
  readonly id: string = nanoid(10);
  readonly settings: RoomSettings;
  readonly createdAt = Date.now();

  private chess = new Chess();
  private clock: GameClock;
  private moves: MoveRecord[] = [];
  private spectators = new Map<string, SpectatorSlot>();
  private drawOfferedBy: Color | null = null;

  status: RoomStatus = 'waiting';
  result: GameResult | null = null;
  startedAt: number | null = null;
  endedAt: number | null = null;

  white: PlayerSlot;
  black: PlayerSlot;

  constructor(white: PlayerSlot, black: PlayerSlot, settings: RoomSettings) {
    this.white = white;
    this.black = black;
    this.settings = settings;
    this.clock = new GameClock(settings.timeControl);
  }

  private slotFor(color: Color): PlayerSlot {
    return color === 'w' ? this.white : this.black;
  }

  slotForUser(userId: string): PlayerSlot | null {
    if (this.white.userId === userId) return this.white;
    if (this.black.userId === userId) return this.black;
    return null;
  }

  isParticipant(userId: string): boolean {
    return this.white.userId === userId || this.black.userId === userId;
  }

  start() {
    this.status = 'active';
    this.startedAt = Date.now();
    this.clock.start();
  }

  /**
   * Attempt to apply a move on behalf of `userId`. Throws GameRoomError on
   * anything invalid — wrong turn, wrong player, illegal move, game already
   * over, etc. Never trust `expectedMoveIndex` blindly: it is only used to
   * reject stale/duplicate client retries, the legality check itself always
   * comes from chess.js's own board state.
   */
  applyMove(params: {
    userId: string;
    from: string;
    to: string;
    promotion?: string;
    expectedMoveIndex?: number;
    clientTimestamp?: number;
  }): MoveRecord {
    if (this.status !== 'active') {
      throw new GameRoomError('ROOM_NOT_ACTIVE', 'Room is not active.');
    }

    const slot = this.slotForUser(params.userId);
    if (!slot) throw new GameRoomError('NOT_A_PLAYER', 'You are not a player in this room.');

    const turnColor = this.chess.turn() as Color;
    if (slot.color !== turnColor) {
      throw new GameRoomError('NOT_YOUR_TURN', 'It is not your turn.');
    }

    if (
      params.expectedMoveIndex !== undefined &&
      params.expectedMoveIndex !== this.moves.length
    ) {
      // Client is out of sync (stale UI, replayed event, etc.) — reject rather
      // than silently accept, and let the client resync from server state.
      throw new GameRoomError('STALE_MOVE_INDEX', 'Move index out of sync with server.');
    }

    // Flag check happens before the move is even attempted — you cannot move
    // your way out of having already run out of time.
    const flagged = this.clock.isFlagged();
    if (flagged) {
      this.finish({ resultType: 'timeout', winnerColor: flagged === 'w' ? 'b' : 'w' });
      throw new GameRoomError('FLAGGED', 'Time has run out.');
    }

    let moveResult;
    try {
      moveResult = this.chess.move({ from: params.from, to: params.to, promotion: params.promotion });
    } catch {
      throw new GameRoomError('ILLEGAL_MOVE', 'That move is not legal.');
    }

    this.drawOfferedBy = null; // any move implicitly declines a pending draw offer
    this.clock.applyMoveAndSwitchTurn();

    const { whiteTimeLeftMs, blackTimeLeftMs } = this.clock.snapshot();
    const record: MoveRecord = {
      index: this.moves.length,
      san: moveResult.san,
      fen: this.chess.fen(),
      byUserId: params.userId,
      clientTimestamp: params.clientTimestamp,
      serverTimestamp: Date.now(),
      whiteTimeLeftMs,
      blackTimeLeftMs,
    };
    this.moves.push(record);

    this.checkAutomaticEndConditions();

    return record;
  }

  private checkAutomaticEndConditions() {
    if (this.chess.isCheckmate()) {
      const winner: Color = this.chess.turn() === 'w' ? 'b' : 'w'; // side to move is checkmated
      this.finish({ resultType: 'checkmate', winnerColor: winner });
    } else if (this.chess.isStalemate()) {
      this.finish({ resultType: 'stalemate', winnerColor: null });
    } else if (this.chess.isThreefoldRepetition()) {
      this.finish({ resultType: 'threefold_repetition', winnerColor: null });
    } else if (this.chess.isDrawByFiftyMoves()) {
      this.finish({ resultType: 'fifty_move_rule', winnerColor: null });
    } else if (this.chess.isInsufficientMaterial()) {
      this.finish({ resultType: 'insufficient_material', winnerColor: null });
    }
  }

  /** Called by the room manager's tick loop — never trust a client "I ran out of time" claim. */
  checkTimeout(): boolean {
    if (this.status !== 'active') return false;
    const flagged = this.clock.isFlagged();
    if (flagged) {
      this.finish({ resultType: 'timeout', winnerColor: flagged === 'w' ? 'b' : 'w' });
      return true;
    }
    return false;
  }

  resign(userId: string) {
    if (this.status !== 'active') throw new GameRoomError('ROOM_NOT_ACTIVE', 'Room is not active.');
    const slot = this.slotForUser(userId);
    if (!slot) throw new GameRoomError('NOT_A_PLAYER', 'You are not a player in this room.');
    const winner: Color = slot.color === 'w' ? 'b' : 'w';
    this.finish({ resultType: 'resign', winnerColor: winner });
  }

  offerDraw(userId: string): Color {
    if (this.status !== 'active') throw new GameRoomError('ROOM_NOT_ACTIVE', 'Room is not active.');
    const slot = this.slotForUser(userId);
    if (!slot) throw new GameRoomError('NOT_A_PLAYER', 'You are not a player in this room.');
    this.drawOfferedBy = slot.color;
    return slot.color;
  }

  respondDraw(userId: string, accept: boolean) {
    if (this.status !== 'active') throw new GameRoomError('ROOM_NOT_ACTIVE', 'Room is not active.');
    const slot = this.slotForUser(userId);
    if (!slot) throw new GameRoomError('NOT_A_PLAYER', 'You are not a player in this room.');
    if (!this.drawOfferedBy || this.drawOfferedBy === slot.color) {
      throw new GameRoomError('NO_PENDING_OFFER', 'There is no draw offer for you to respond to.');
    }
    if (accept) {
      this.finish({ resultType: 'draw_agreement', winnerColor: null });
    } else {
      this.drawOfferedBy = null;
    }
  }

  /** A player disconnecting for too long during an active game forfeits (soft anti-abandon). */
  forfeitByAbandon(userId: string) {
    if (this.status !== 'active') return;
    const slot = this.slotForUser(userId);
    if (!slot) return;
    const winner: Color = slot.color === 'w' ? 'b' : 'w';
    this.finish({ resultType: 'abandoned', winnerColor: winner });
  }

  private finish(result: GameResult) {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.result = result;
    this.endedAt = Date.now();
    this.clock.stop();
  }

  addSpectator(spec: SpectatorSlot) {
    if (!this.settings.allowSpectators) {
      throw new GameRoomError('SPECTATORS_DISABLED', 'Spectators are disabled for this room.');
    }
    if (this.spectators.size >= this.settings.maxSpectators) {
      throw new GameRoomError('SPECTATOR_LIMIT', 'Spectator limit reached.');
    }
    this.spectators.set(spec.socketId, spec);
  }

  removeSpectator(socketId: string) {
    this.spectators.delete(socketId);
  }

  spectatorCount(): number {
    return this.spectators.size;
  }

  spectatorSocketIds(): string[] {
    return [...this.spectators.keys()];
  }

  pgn(): string {
    return this.chess.pgn();
  }

  fen(): string {
    return this.chess.fen();
  }

  moveHistory(): MoveRecord[] {
    return this.moves;
  }

  clockSnapshot() {
    return this.clock.snapshot();
  }

  /** Public state safe to broadcast to players AND spectators (no secrets). */
  publicState() {
    return {
      roomId: this.id,
      status: this.status,
      fen: this.fen(),
      turn: this.chess.turn(),
      moveCount: this.moves.length,
      lastMove: this.moves[this.moves.length - 1] ?? null,
      ...this.clockSnapshot(),
      white: { userId: this.white.userId, displayName: this.white.displayName, elo: this.white.elo, connected: this.white.connected },
      black: { userId: this.black.userId, displayName: this.black.displayName, elo: this.black.elo, connected: this.black.connected },
      drawOfferedBy: this.drawOfferedBy,
      result: this.result,
      settings: this.settings,
      spectatorCount: this.spectatorCount(),
    };
  }
}

export class GameRoomError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
