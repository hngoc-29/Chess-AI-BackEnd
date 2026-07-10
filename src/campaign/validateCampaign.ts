import { Chess } from 'chess.js';
import { CampaignLevel, getLevel } from './levels';

export interface CampaignSubmission {
  levelId: string;
  moves: string[]; // SAN, in play order, both sides
  playerColor: 'w' | 'b';
  durationMs: number;
  resigned: boolean;
}

export interface CampaignValidationResult {
  valid: boolean;
  reason?: string;
  completed: boolean;
  stars: 0 | 1 | 2 | 3;
  finalFen: string;
  pgn: string;
  suspicious: boolean; // flagged for manual review, but not auto-rejected
}

const MIN_MS_PER_MOVE = 150; // floor for "is this humanly possible" sanity check

/**
 * Re-plays the submitted move list against the real chess rules starting
 * from the level's position. This guarantees the final result is at least a
 * *legally reachable* position — the client cannot fabricate an illegal jump
 * straight to "checkmate".
 *
 * IMPORTANT LIMITATION (documented in docs/SECURITY.md): the on-device AI
 * (Maia via ONNX) runs entirely on the client, so the server has no way to
 * confirm the AI's half of the moves were actually what the model played —
 * only that the full sequence is legal chess and reaches a position that
 * satisfies the level's win condition. See SECURITY.md for the mitigations
 * this function applies (duration sanity check + suspicious flag) and what
 * is intentionally left as a "can't fully solve on APK" gap.
 */
export function validateCampaignSubmission(sub: CampaignSubmission): CampaignValidationResult {
  const level = getLevel(sub.levelId);
  if (!level) {
    return { valid: false, reason: 'UNKNOWN_LEVEL', completed: false, stars: 0, finalFen: '', pgn: '', suspicious: false };
  }
  if (sub.playerColor !== level.playerColor) {
    return { valid: false, reason: 'WRONG_COLOR', completed: false, stars: 0, finalFen: '', pgn: '', suspicious: false };
  }
  if (sub.moves.length === 0 || sub.moves.length > level.maxMoves * 2) {
    return { valid: false, reason: 'MOVE_COUNT_OUT_OF_RANGE', completed: false, stars: 0, finalFen: '', pgn: '', suspicious: false };
  }

  const chess = new Chess(level.startFen);
  for (const san of sub.moves) {
    try {
      chess.move(san);
    } catch {
      return { valid: false, reason: 'ILLEGAL_MOVE_SEQUENCE', completed: false, stars: 0, finalFen: '', pgn: '', suspicious: false };
    }
  }

  const completed = evaluateWinCondition(level, chess, sub);
  const playerPly = sub.moves.length; // total plies by both sides, used for star grading
  const stars = completed ? starsFor(level, playerPly) : 0;

  const expectedMinDuration = sub.moves.length * MIN_MS_PER_MOVE;
  const suspicious = sub.durationMs < expectedMinDuration;

  return {
    valid: true,
    completed,
    stars,
    finalFen: chess.fen(),
    pgn: chess.pgn(),
    suspicious,
  };
}

function evaluateWinCondition(level: CampaignLevel, chess: Chess, sub: CampaignSubmission): boolean {
  if (sub.resigned) return false;

  if (level.winCondition.type === 'checkmate') {
    if (!chess.isCheckmate()) return false;
    // The side to move is the one checkmated — the player must be the winner, not the loser.
    const checkmatedColor = chess.turn();
    const playerDeliveredMate = checkmatedColor !== level.playerColor;
    return playerDeliveredMate;
  }

  if (level.winCondition.type === 'survive') {
    if (chess.isCheckmate()) {
      const checkmatedColor = chess.turn();
      if (checkmatedColor === level.playerColor) return false; // player got mated — fail
    }
    return sub.moves.length >= level.winCondition.minPly;
  }

  return false;
}

function starsFor(level: CampaignLevel, plyCount: number): 1 | 2 | 3 {
  if (plyCount <= level.starThresholds.threeStar) return 3;
  if (plyCount <= level.starThresholds.twoStar) return 2;
  return 1;
}
