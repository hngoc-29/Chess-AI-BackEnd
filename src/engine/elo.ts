/**
 * Standard Elo update. K=32 is a common default for online rapid/blitz play;
 * tune per time control later if desired (see Roadmap).
 */
const K_FACTOR = 32;

export type EloOutcome = 1 | 0.5 | 0; // win / draw / loss, from the perspective of `rating`

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function updateElo(rating: number, opponentRating: number, outcome: EloOutcome): number {
  const expected = expectedScore(rating, opponentRating);
  const newRating = rating + K_FACTOR * (outcome - expected);
  return Math.round(newRating);
}

export function computeEloDelta(
  whiteElo: number,
  blackElo: number,
  result: 'white' | 'black' | 'draw',
): { whiteAfter: number; blackAfter: number } {
  const whiteOutcome: EloOutcome = result === 'white' ? 1 : result === 'draw' ? 0.5 : 0;
  const blackOutcome: EloOutcome = result === 'black' ? 1 : result === 'draw' ? 0.5 : 0;
  return {
    whiteAfter: updateElo(whiteElo, blackElo, whiteOutcome),
    blackAfter: updateElo(blackElo, whiteElo, blackOutcome),
  };
}
