/**
 * Display names for bot accounts. Deliberately ordinary — the entire point
 * is that a waiting player cannot tell these apart from real opponents.
 * No "Bot", "AI", "CPU", etc. anywhere in here.
 */
export const BOT_DISPLAY_NAMES: readonly string[] = [
  'Minh Quan',
  'Thu Ha',
  'Duc Anh',
  'Ngoc Linh',
  'Hoang Long',
  'Bao Tran',
  'Gia Huy',
  'Khanh Chi',
  'Van Toan',
  'Thanh Tung',
  'Phuong Anh',
  'Quang Vinh',
  'Mai Linh',
  'Tuan Kiet',
  'Hai Dang',
  'Le Vy',
  'Anh Duc',
  'Kim Ngan',
  'Trong Nghia',
  'Bich Ngoc',
  'D. Petrov',
  'M. Novak',
  'J. Kowalski',
  'A. Silva',
];

/** Pick n unique names without mutating the source pool. */
export function pickUniqueNames(n: number): string[] {
  const pool = [...BOT_DISPLAY_NAMES];
  const picked: string[] = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}
