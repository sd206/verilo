/** Fuzzy name matching (7.6 NAME_MISMATCH, 8.6) and perceptual-hash distance (7.6 DUPLICATE_EVIDENCE). */

function tokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  // An initial ("K") matches a token starting with it.
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 0.8;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Token similarity in [0, 1]: tokens are paired greedily by best similarity (order doesn't matter),
 * then scored like a Dice coefficient, 2·Σ(pair similarity) / (|A| + |B|).
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const pairs: { i: number; j: number; s: number }[] = [];
  ta.forEach((x, i) => tb.forEach((y, j) => pairs.push({ i, j, s: tokenSimilarity(x, y) })));
  pairs.sort((p, q) => q.s - p.s);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let sum = 0;
  for (const p of pairs) {
    if (usedA.has(p.i) || usedB.has(p.j)) continue;
    usedA.add(p.i);
    usedB.add(p.j);
    sum += p.s;
  }
  return Math.round(((2 * sum) / (ta.length + tb.length)) * 1000) / 1000;
}

/** Bits that differ between two equal-length hex hashes; null if they can't be compared. */
export function hammingDistanceHex(a: string, b: string): number | null {
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return null;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}
