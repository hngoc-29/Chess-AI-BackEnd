import { Color, TimeControl } from '../types';

/**
 * Authoritative clock. The client only ever displays what the server sends;
 * it never decides "time's up" for itself. We compute remaining time on
 * demand from a wall-clock timestamp rather than a setInterval countdown,
 * so it can't drift and doesn't depend on the process ticking at 60fps.
 */
export class GameClock {
  private whiteMs: number;
  private blackMs: number;
  private turn: Color = 'w';
  private turnStartedAt: number = Date.now();
  private readonly incrementMs: number;
  private running = false;

  constructor(tc: TimeControl) {
    this.whiteMs = tc.initialMs;
    this.blackMs = tc.initialMs;
    this.incrementMs = tc.incrementMs;
  }

  start() {
    this.running = true;
    this.turnStartedAt = Date.now();
  }

  /** Remaining ms for a color, accounting for time elapsed in the current turn. */
  remaining(color: Color): number {
    if (this.running && color === this.turn) {
      const elapsed = Date.now() - this.turnStartedAt;
      return Math.max(0, (color === 'w' ? this.whiteMs : this.blackMs) - elapsed);
    }
    return color === 'w' ? this.whiteMs : this.blackMs;
  }

  /** Call the instant a legal move is accepted for the side that just moved. */
  applyMoveAndSwitchTurn() {
    const elapsed = Date.now() - this.turnStartedAt;
    if (this.turn === 'w') {
      this.whiteMs = Math.max(0, this.whiteMs - elapsed) + this.incrementMs;
      this.turn = 'b';
    } else {
      this.blackMs = Math.max(0, this.blackMs - elapsed) + this.incrementMs;
      this.turn = 'w';
    }
    this.turnStartedAt = Date.now();
  }

  isFlagged(): Color | null {
    if (this.remaining('w') <= 0) return 'w';
    if (this.remaining('b') <= 0) return 'b';
    return null;
  }

  stop() {
    // Freeze remaining time at "now" so subsequent remaining() calls are stable.
    this.whiteMs = this.remaining('w');
    this.blackMs = this.remaining('b');
    this.running = false;
  }

  snapshot() {
    return { whiteTimeLeftMs: this.remaining('w'), blackTimeLeftMs: this.remaining('b') };
  }
}
