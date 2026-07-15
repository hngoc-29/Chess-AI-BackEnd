import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { execute, query } from '../db/turso';
import { hashPassword } from '../auth/jwt';
import { pickUniqueNames } from './botNames';
import { logger } from '../utils/logger';

export interface BotAccount {
  id: string;
  displayName: string;
  elo: number;
}

/**
 * Elo values for the seeded bot pool. Spans wider than a single player's
 * likely rating so "closest available bot" stays reasonably close even for
 * players well outside the 1200 default. Values repeat around the middle
 * on purpose - most real players will land there early on, and a slightly
 * denser pool at the center keeps the elo gap small for the common case.
 */
const TARGET_ELO_SPREAD = [
  600, 750, 900, 1000, 1100, 1200, 1200, 1300, 1400, 1500, 1650, 1800, 1950, 2100, 2300, 2500,
];

/**
 * Bot accounts are real `users` rows (is_bot = 1) so they flow through
 * existing match persistence / Elo updates unchanged - see matchService.ts.
 * This is idempotent: call it once at server boot (see index.ts). Requires
 * the is_bot column - run sql/migrations/001_add_is_bot_to_users.sql once
 * against any database created before this feature existed.
 */
export async function ensureBotPool(): Promise<void> {
  const rows = await query<{ count: number }>('SELECT COUNT(*) as count FROM users WHERE is_bot = 1', []);
  const currentCount = Number(rows[0]?.count ?? 0);
  const needed = TARGET_ELO_SPREAD.length - currentCount;
  if (needed <= 0) {
    logger.debug({ currentCount }, 'bot pool already at target size');
    return;
  }

  const names = pickUniqueNames(needed);
  // Random, never-used password - bots don't log in through the normal
  // auth flow, this only exists to satisfy the NOT NULL column.
  const throwawayHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());

  for (let i = 0; i < needed; i++) {
    const id = nanoid();
    const elo = TARGET_ELO_SPREAD[currentCount + i] ?? 1200;
    const displayName = names[i] ?? `Player${id.slice(0, 4)}`;
    await execute(
      `INSERT INTO users (id, email, password_hash, display_name, elo, is_bot)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, `bot.${id}@internal.kingsgambit.local`, throwawayHash, displayName, elo],
    );
  }
  logger.info({ created: needed, totalPoolSize: TARGET_ELO_SPREAD.length }, 'topped up bot account pool');
}

/**
 * Picks a bot account close to `targetElo`. Bots may be reused across
 * concurrent rooms (unlike real players, there's no reason a fake account
 * can't be "playing" more than one game at once from the server's
 * perspective) so this never excludes an already-in-use bot.
 */
export async function pickBotForMatch(targetElo: number): Promise<BotAccount | null> {
  const rows = await query<{ id: string; display_name: string; elo: number }>(
    `SELECT id, display_name, elo FROM users
     WHERE is_bot = 1
     ORDER BY ABS(elo - ?) ASC
     LIMIT 5`,
    [targetElo],
  );
  if (rows.length === 0) {
    logger.warn('pickBotForMatch called but bot pool is empty - did ensureBotPool() run at boot?');
    return null;
  }
  // A little variety among the closest few rather than always the single
  // nearest account, so the same player doesn't always meet the same "person".
  const candidate = rows[Math.floor(Math.random() * Math.min(rows.length, 3))];
  return { id: candidate.id, displayName: candidate.display_name, elo: candidate.elo };
}
