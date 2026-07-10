import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const httpRateLimiter = rateLimit({
  windowMs: env.HTTP_RATE_LIMIT_WINDOW_MS,
  max: env.HTTP_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

/**
 * Lightweight per-socket sliding-window limiter for high-frequency events
 * like "move". Not a replacement for httpRateLimiter — this guards the
 * Socket.IO transport, which express-rate-limit never sees.
 */
export class SocketEventLimiter {
  private hits = new Map<string, number[]>();
  constructor(private maxPerWindow: number, private windowMs: number = 1000) {}

  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.maxPerWindow) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}
