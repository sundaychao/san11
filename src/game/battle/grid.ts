export interface GridCoord {
  q: number;
  r: number;
}

export function gridKey(coord: GridCoord) {
  return `${coord.q},${coord.r}`;
}

export function isSameCoord(a: GridCoord, b: GridCoord) {
  return a.q === b.q && a.r === b.r;
}

export function neighborsOf(q: number, r: number): GridCoord[] {
  if (q % 2 === 0) {
    return [
      { q, r: r - 1 },
      { q, r: r + 1 },
      { q: q - 1, r: r - 1 },
      { q: q - 1, r },
      { q: q + 1, r: r - 1 },
      { q: q + 1, r },
    ];
  }

  return [
    { q, r: r - 1 },
    { q, r: r + 1 },
    { q: q - 1, r },
    { q: q - 1, r: r + 1 },
    { q: q + 1, r },
    { q: q + 1, r: r + 1 },
  ];
}

export function sevenCellCityFootprint(center: GridCoord): GridCoord[] {
  return [center, ...neighborsOf(center.q, center.r)];
}
