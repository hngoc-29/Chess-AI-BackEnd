import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface QueueEntry {
  userId: string;
  socketId: string;
  displayName: string;
  elo: number;
  timeControlKey: string; // e.g. "600+5" — only match within the same time control
  joinedAt: number;
}

export type MatchFoundHandler = (a: QueueEntry, b: QueueEntry) => void;
export type TimeoutHandler = (entry: QueueEntry) => void;

export class MatchmakingQueue {
  private waiting = new Map<string, QueueEntry>(); // key = userId, one queue ticket per user
  private onMatch: MatchFoundHandler;
  private onTimeout: TimeoutHandler;

  constructor(onMatch: MatchFoundHandler, onTimeout: TimeoutHandler) {
    this.onMatch = onMatch;
    this.onTimeout = onTimeout;
  }

  enqueue(entry: QueueEntry) {
    this.waiting.set(entry.userId, entry);
    logger.debug({ userId: entry.userId, elo: entry.elo }, 'joined matchmaking queue');
    this.tryMatch(entry.timeControlKey);
  }

  dequeue(userId: string) {
    this.waiting.delete(userId);
  }

  isQueued(userId: string): boolean {
    return this.waiting.has(userId);
  }

  private currentEloRange(entry: QueueEntry): number {
    const waitedMs = Date.now() - entry.joinedAt;
    // Widen the acceptable Elo gap by 50 points every 5 seconds waited, capped at MAX.
    const widened = env.MATCHMAKING_INITIAL_ELO_RANGE + Math.floor(waitedMs / 5000) * 50;
    return Math.min(widened, env.MATCHMAKING_MAX_ELO_RANGE);
  }

  private tryMatch(timeControlKey: string) {
    const candidates = [...this.waiting.values()].filter((e) => e.timeControlKey === timeControlKey);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        const gap = Math.abs(a.elo - b.elo);
        const allowedGap = Math.min(this.currentEloRange(a), this.currentEloRange(b));
        if (gap <= allowedGap) {
          this.waiting.delete(a.userId);
          this.waiting.delete(b.userId);
          this.onMatch(a, b);
          return;
        }
      }
    }
  }

  /** Call periodically (e.g. every 1s) from a global tick loop. */
  tick() {
    const now = Date.now();
    const byTimeControl = new Map<string, boolean>();

    for (const entry of this.waiting.values()) {
      if (now - entry.joinedAt >= env.MATCHMAKING_TIMEOUT_MS) {
        this.waiting.delete(entry.userId);
        this.onTimeout(entry);
      } else {
        byTimeControl.set(entry.timeControlKey, true);
      }
    }

    for (const tc of byTimeControl.keys()) {
      this.tryMatch(tc);
    }
  }

  size(): number {
    return this.waiting.size;
  }
}
