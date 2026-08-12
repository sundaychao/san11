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

export function coordsWithinRange(center: GridCoord, range: number): GridCoord[] {
  const seen = new Set<string>([gridKey(center)]);
  const coords: GridCoord[] = [center];
  let frontier: GridCoord[] = [center];

  for (let distance = 1; distance <= range; distance += 1) {
    const nextFrontier: GridCoord[] = [];
    for (const current of frontier) {
      for (const neighbor of neighborsOf(current.q, current.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        seen.add(key);
        coords.push(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return coords;
}

export function sevenCellCityFootprint(center: GridCoord): GridCoord[] {
  return [center, ...neighborsOf(center.q, center.r)];
}
