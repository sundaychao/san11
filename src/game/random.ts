export interface RandomResult {
  value: number;
  cursor: number;
}

export function nextRandom(seed: number, cursor: number): RandomResult {
  let value = (seed + Math.imul(cursor, 0x9e3779b9)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return { value: (value >>> 0) / 0x100000000, cursor: cursor + 1 };
}
