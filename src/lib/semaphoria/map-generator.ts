import { GRID_COLS, GRID_ROWS, DIFFICULTY_CONFIG } from "./constants";
import type { Difficulty } from "./constants";

// ── TYPES ────────────────────────────────────────────────────────────────────

export type TileType = "water" | "reef" | "harbor" | "start";

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  /** Whether this tile is part of the guaranteed safe path. */
  onPath: boolean;
}

export interface GameMap {
  cols: number;
  rows: number;
  /** Row-major 2-D grid: tiles[y][x]. */
  tiles: Tile[][];
  startX: number;
  startY: number;
  harborX: number;
  harborY: number;
  /** Ordered sequence of tile coordinates forming the safe path, start → harbor. */
  path: readonly { x: number; y: number }[];
}

// ── SEEDED RNG ────────────────────────────────────────────────────────────────

/** Return values in [0, 1). `seed` is coerced to a 32-bit integer. */
export function makePRNG(seed: number): () => number {
  let s = Math.trunc(seed);
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

// ── PATH GENERATION ───────────────────────────────────────────────────────────

/**
 * Generate a path from (startX, startY) to (harborX, harborY) with a given
 * number of turns. The path is made of horizontal then vertical segments
 * between random waypoints, ensuring it stays within the grid.
 */
function generatePath(
  startX: number,
  startY: number,
  harborX: number,
  harborY: number,
  cols: number,
  turns: number,
  rng: () => number
): { x: number; y: number }[] {
  // Create intermediate waypoints within the grid interior
  const margin = 2;
  const waypoints: { x: number; y: number }[] = [{ x: startX, y: startY }];

  for (let i = 0; i < turns; i++) {
    // Progress from bottom to top proportionally
    const fraction = (i + 1) / (turns + 1);
    const targetY = Math.round(startY - (startY - harborY) * fraction);
    const targetX = margin + Math.floor(rng() * (cols - margin * 2));
    waypoints.push({ x: targetX, y: targetY });
  }

  waypoints.push({ x: harborX, y: harborY });

  // Connect consecutive waypoints: first horizontal, then vertical
  const pathTiles: { x: number; y: number }[] = [];
  for (let wi = 0; wi < waypoints.length - 1; wi++) {
    const from = waypoints[wi];
    const to = waypoints[wi + 1];
    if (!from || !to) continue;

    // Horizontal segment
    const xDir = to.x > from.x ? 1 : to.x < from.x ? -1 : 0;
    let cx = from.x;
    while (cx !== to.x) {
      pathTiles.push({ x: cx, y: from.y });
      cx += xDir;
    }

    // Vertical segment
    const yDir = to.y > from.y ? 1 : to.y < from.y ? -1 : 0;
    let cy = from.y;
    while (cy !== to.y) {
      pathTiles.push({ x: to.x, y: cy });
      cy += yDir;
    }
  }
  // Include the final waypoint
  pathTiles.push({ x: harborX, y: harborY });

  // De-duplicate consecutive tiles
  const seen = new Set<string>();
  return pathTiles.filter((pt) => {
    const key = `${pt.x},${pt.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── MAP GENERATION ────────────────────────────────────────────────────────────

/**
 * Procedurally generate a map for the given `seed` and `difficulty` level.
 * The map guarantees:
 * - A clear path from the start tile to the harbor tile.
 * - A 1-tile buffer around the start and harbor, free of reefs.
 */
export function generateMap(seed: number, difficulty: Difficulty): GameMap {
  const rng = makePRNG(seed);
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const config = DIFFICULTY_CONFIG[difficulty];

  // Start at bottom-centre, harbor at top-centre
  const startX = Math.floor(cols / 2);
  const startY = rows - 1;
  const harborX = Math.floor(cols / 2);
  const harborY = 0;

  // Initialise all tiles as water
  const tiles: Tile[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => ({
      x,
      y,
      type: "water" as const,
      onPath: false,
    }))
  );

  // Generate the safe path and mark its tiles
  const path = generatePath(startX, startY, harborX, harborY, cols, config.pathTurns, rng);
  const pathSet = new Set(path.map((p) => `${p.x},${p.y}`));
  for (const pt of path) {
    const tile = tiles[pt.y]?.[pt.x];
    if (tile) tile.onPath = true;
  }

  // Build a set of buffer tiles around start and harbor (not allowed to be reefs)
  const bufferSet = new Set<string>();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      bufferSet.add(`${startX + dx},${startY + dy}`);
      bufferSet.add(`${harborX + dx},${harborY + dy}`);
    }
  }

  // Fill non-path tiles with reefs according to density
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const key = `${x},${y}`;
      if (pathSet.has(key) || bufferSet.has(key)) continue;
      if (rng() < config.reefDensity) {
        const tile = tiles[y]?.[x];
        if (tile) tile.type = "reef";
      }
    }
  }

  // Mark start and harbor tiles
  const startTile = tiles[startY]?.[startX];
  if (startTile) startTile.type = "start";
  const harborTile = tiles[harborY]?.[harborX];
  if (harborTile) harborTile.type = "harbor";

  return { cols, rows, tiles, startX, startY, harborX, harborY, path };
}
