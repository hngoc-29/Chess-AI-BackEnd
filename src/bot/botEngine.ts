import { Chess } from 'chess.js';

/**
 * Move selection for AI-fallback opponents. This is a plain minimax +
 * alpha-beta search over chess.js, NOT the Maia ONNX model the Flutter app
 * uses for single-player - porting those models server-side (onnxruntime-node
 * + reimplementing the board encoder in TS) is a much bigger, separate
 * project. This gives a reasonably human-shaped opponent (tunable strength,
 * occasional blunders, non-instant replies) without new native dependencies
 * or model assets in the backend. See docs/ROADMAP.md.
 *
 * Perf note: this runs synchronously on the main event loop. Depth is
 * capped at 3 specifically so a single move search stays well under ~200ms
 * in typical middlegame positions and doesn't stall other players' socket
 * events for long. If concurrent bot games become a meaningful share of
 * traffic, move this into a worker_threads pool rather than raising depth
 * further.
 */

const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Mild center-control bonus for knights/bishops - keeps play from looking
// purely materialistic even at low search depth.
const CENTER_BONUS = [
  [0, 1, 2, 3, 3, 2, 1, 0],
  [1, 2, 3, 4, 4, 3, 2, 1],
  [2, 3, 4, 5, 5, 4, 3, 2],
  [3, 4, 5, 6, 6, 5, 4, 3],
  [3, 4, 5, 6, 6, 5, 4, 3],
  [2, 3, 4, 5, 5, 4, 3, 2],
  [1, 2, 3, 4, 4, 3, 2, 1],
  [0, 1, 2, 3, 3, 2, 1, 0],
] as const;

export interface BotMoveChoice {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
  san: string;
}

interface Tier {
  depth: number;
  blunderChance: number; // probability of playing a uniformly random legal move instead
}

/** Search depth / blunder rate by target elo. Tune freely - see docs/ROADMAP.md. */
function tierFor(elo: number): Tier {
  if (elo < 900) return { depth: 1, blunderChance: 0.35 };
  if (elo < 1300) return { depth: 2, blunderChance: 0.18 };
  if (elo < 1700) return { depth: 2, blunderChance: 0.08 };
  if (elo < 2100) return { depth: 3, blunderChance: 0.03 };
  return { depth: 3, blunderChance: 0 };
}

function evaluate(chess: Chess): number {
  if (chess.isCheckmate()) {
    // Side to move has just been checkmated - very bad for them.
    return chess.turn() === 'w' ? -100_000 : 100_000;
  }
  if (chess.isDraw() || chess.isStalemate()) return 0;

  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      const positional = sq.type === 'n' || sq.type === 'b' ? CENTER_BONUS[r][f] : 0;
      const value = PIECE_VALUES[sq.type] + positional;
      score += sq.color === 'w' ? value : -value;
    }
  }
  // Small noise keeps "best" move from being bit-for-bit deterministic
  // across otherwise-identical positions.
  score += (Math.random() - 0.5) * 6;
  return score;
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess);

  const moves = chess.moves({ verbose: true });
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta, false));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of moves) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    best = Math.min(best, minimax(chess, depth - 1, alpha, beta, true));
    chess.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

/** Picks a move for the side to move in `fen`, tuned toward playing like `elo`. */
export function pickBotMove(fen: string, elo: number): BotMoveChoice | null {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;

  const { depth, blunderChance } = tierFor(elo);

  if (Math.random() < blunderChance) {
    const m = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    return { from: m.from, to: m.to, promotion: m.promotion as BotMoveChoice['promotion'], san: m.san };
  }

  const maximizingIsWhite = chess.turn() === 'w';
  let bestMove = legalMoves[0];
  let bestScore = maximizingIsWhite ? -Infinity : Infinity;

  for (const m of legalMoves) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !maximizingIsWhite);
    chess.undo();

    const better = maximizingIsWhite ? score > bestScore : score < bestScore;
    if (better) {
      bestScore = score;
      bestMove = m;
    }
  }

  return {
    from: bestMove.from,
    to: bestMove.to,
    promotion: bestMove.promotion as BotMoveChoice['promotion'],
    san: bestMove.san,
  };
}

/** Randomized "thinking" pause so a bot reply never lands suspiciously instantly. */
export function thinkingDelayMs(elo: number): number {
  const base = 700 + Math.random() * 2200;
  const strongerTierBonus = elo >= 1700 ? 400 : 0;
  return Math.round(base + strongerTierBonus);
}

/** Whether the bot accepts a draw offer - only when it isn't clearly winning. */
export function shouldAcceptDraw(fen: string, botColor: 'w' | 'b'): boolean {
  const chess = new Chess(fen);
  let material = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      const value = PIECE_VALUES[sq.type];
      material += sq.color === 'w' ? value : -value;
    }
  }
  const botMaterial = botColor === 'w' ? material : -material;
  return botMaterial <= 50; // roughly "not up more than half a pawn"
}
