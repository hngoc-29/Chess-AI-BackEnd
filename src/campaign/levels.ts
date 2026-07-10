export type WinCondition =
  | { type: 'checkmate' } // player must deliver checkmate
  | { type: 'survive'; minPly: number }; // player must not lose for at least N plies (vs on-device AI)

export interface CampaignLevel {
  id: string;
  order: number;
  title: string;
  startFen: string; // usually the standard starting position, but puzzle-style levels can override
  playerColor: 'w' | 'b';
  winCondition: WinCondition;
  maxMoves: number; // hard cap — also guards against absurdly long submitted move lists
  starThresholds: { threeStar: number; twoStar: number }; // move-count thresholds (lower = better)
}

/**
 * Example seed data — replace/extend with the game's real level design.
 * Kept in code (not a DB table) because level design changes go through a
 * release anyway; see docs/ROADMAP.md for moving this to a `campaign_levels`
 * table if you want to ship new levels without a redeploy.
 */
export const CAMPAIGN_LEVELS: CampaignLevel[] = [
  {
    id: 'level-01',
    order: 1,
    title: 'First Steps',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playerColor: 'w',
    winCondition: { type: 'checkmate' },
    maxMoves: 60,
    starThresholds: { threeStar: 20, twoStar: 35 },
  },
  {
    id: 'level-02',
    order: 2,
    title: 'Hold Your Ground',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playerColor: 'b',
    winCondition: { type: 'survive', minPly: 40 },
    maxMoves: 60,
    starThresholds: { threeStar: 50, twoStar: 45 },
  },
];

export function getLevel(levelId: string): CampaignLevel | undefined {
  return CAMPAIGN_LEVELS.find((l) => l.id === levelId);
}
