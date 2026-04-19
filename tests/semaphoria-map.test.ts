/**
 * Semaphoria – map generator unit tests.
 *
 * Verifies that the procedural map generator produces valid, solvable maps
 * across different seeds and difficulty levels.
 */
import { test, expect } from "@playwright/test";
import { generateMap, makePRNG } from "../src/lib/semaphoria/map-generator";
import type { GameMap } from "../src/lib/semaphoria/map-generator";
import { GRID_COLS, GRID_ROWS, DIFFICULTY_CONFIG } from "../src/lib/semaphoria/constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPathConnected(map: GameMap): boolean {
  // BFS from start to harbor using path tiles only
  const start = `${map.startX},${map.startY}`;
  const goal = `${map.harborX},${map.harborY}`;
  const visited = new Set<string>([start]);
  const queue = [start];

  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) break;
    if (key === goal) return true;
    const parts = key.split(",");
    const xPart = parts[0];
    const yPart = parts[1];
    if (xPart === undefined || yPart === undefined) continue;
    const x = parseInt(xPart, 10);
    const y = parseInt(yPart, 10);
    if (isNaN(x) || isNaN(y)) break;

    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] satisfies [number, number][];

    for (const [nx, ny] of neighbours) {
      const nk = `${nx},${ny}`;
      if (!visited.has(nk) && map.tiles[ny]?.[nx]?.onPath) {
        visited.add(nk);
        queue.push(nk);
      }
    }
  }
  return false;
}

function countReefs(map: GameMap): number {
  return map.tiles.flat().filter((t) => t.type === "reef").length;
}

// ── Basic structure ────────────────────────────────────────────────────────────

test.describe("Semaphoria map generator – structure", () => {
  test("returns a map with correct dimensions", () => {
    const map = generateMap(42, 0);
    expect(map.cols).toBe(GRID_COLS);
    expect(map.rows).toBe(GRID_ROWS);
    expect(map.tiles.length).toBe(GRID_ROWS);
    for (const row of map.tiles) {
      expect(row.length).toBe(GRID_COLS);
    }
  });

  test("all tiles have valid types", () => {
    const map = generateMap(42, 0);
    const validTypes = new Set(["water", "reef", "harbor", "start"]);
    for (const tile of map.tiles.flat()) {
      expect(validTypes.has(tile.type)).toBe(true);
    }
  });

  test("there is exactly one start tile", () => {
    const map = generateMap(42, 0);
    const starts = map.tiles.flat().filter((t) => t.type === "start");
    expect(starts.length).toBe(1);
  });

  test("there is exactly one harbor tile", () => {
    const map = generateMap(42, 0);
    const harbors = map.tiles.flat().filter((t) => t.type === "harbor");
    expect(harbors.length).toBe(1);
  });

  test("start tile is at the recorded startX/startY position", () => {
    const map = generateMap(42, 0);
    expect(map.tiles[map.startY]?.[map.startX]?.type).toBe("start");
  });

  test("harbor tile is at the recorded harborX/harborY position", () => {
    const map = generateMap(42, 0);
    expect(map.tiles[map.harborY]?.[map.harborX]?.type).toBe("harbor");
  });

  test("start and harbor are on opposite ends of the grid", () => {
    const map = generateMap(42, 0);
    expect(map.startY).toBeGreaterThan(map.harborY);
  });

  test("tile coordinates match their array position", () => {
    const map = generateMap(42, 0);
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        expect(map.tiles[y]?.[x]?.x).toBe(x);
        expect(map.tiles[y]?.[x]?.y).toBe(y);
      }
    }
  });
});

// ── Path validity ─────────────────────────────────────────────────────────────

test.describe("Semaphoria map generator – path", () => {
  test("the safe path is non-empty", () => {
    const map = generateMap(42, 0);
    expect(map.path.length).toBeGreaterThan(0);
  });

  test("path starts at the start tile", () => {
    const map = generateMap(42, 0);
    const first = map.path[0];
    expect(first).toBeDefined();
    expect(first?.x).toBe(map.startX);
    expect(first?.y).toBe(map.startY);
  });

  test("path ends at the harbor tile", () => {
    const map = generateMap(42, 0);
    const last = map.path[map.path.length - 1];
    expect(last).toBeDefined();
    expect(last?.x).toBe(map.harborX);
    expect(last?.y).toBe(map.harborY);
  });

  test("path tiles are marked as onPath", () => {
    const map = generateMap(42, 0);
    for (const pt of map.path) {
      expect(map.tiles[pt.y]?.[pt.x]?.onPath).toBe(true);
    }
  });

  test("no path tile is a reef", () => {
    const map = generateMap(42, 0);
    for (const pt of map.path) {
      const tile = map.tiles[pt.y]?.[pt.x];
      expect(tile?.type).not.toBe("reef");
    }
  });

  test("path is navigable (BFS-connected from start to harbor)", () => {
    // Test multiple seeds
    for (const seed of [0, 1, 42, 1234, 99999]) {
      const map = generateMap(seed, 0);
      expect(isPathConnected(map)).toBe(true);
    }
  });

  test("path is navigable at all difficulty levels", () => {
    for (let diff = 0; diff < DIFFICULTY_CONFIG.length; diff++) {
      if (diff !== 0 && diff !== 1 && diff !== 2) continue;
      const map = generateMap(777, diff satisfies 0 | 1 | 2);
      expect(isPathConnected(map)).toBe(true);
    }
  });
});

// ── Reef density ──────────────────────────────────────────────────────────────

test.describe("Semaphoria map generator – reef density", () => {
  test("harder difficulty produces more reefs", () => {
    const easyMap = generateMap(42, 0);
    const hardMap = generateMap(42, 2);
    const easyReefs = countReefs(easyMap);
    const hardReefs = countReefs(hardMap);
    expect(hardReefs).toBeGreaterThan(easyReefs);
  });

  test("start buffer zone has no reefs", () => {
    const map = generateMap(42, 2);
    // 2-tile buffer around start
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tile = map.tiles[map.startY + dy]?.[map.startX + dx];
        if (tile) {
          expect(tile.type).not.toBe("reef");
        }
      }
    }
  });

  test("harbor buffer zone has no reefs", () => {
    const map = generateMap(42, 2);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tile = map.tiles[map.harborY + dy]?.[map.harborX + dx];
        if (tile) {
          expect(tile.type).not.toBe("reef");
        }
      }
    }
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

test.describe("Semaphoria map generator – determinism", () => {
  test("same seed produces identical maps", () => {
    const a = generateMap(12345, 1);
    const b = generateMap(12345, 1);
    // Compare tile types as a flat string
    const serialise = (m: GameMap) =>
      m.tiles
        .flat()
        .map((t) => t.type[0])
        .join("");
    expect(serialise(a)).toBe(serialise(b));
  });

  test("different seeds produce different maps", () => {
    const a = generateMap(1, 0);
    const b = generateMap(2, 0);
    const serialise = (m: GameMap) =>
      m.tiles
        .flat()
        .map((t) => t.type[0])
        .join("");
    expect(serialise(a)).not.toBe(serialise(b));
  });

  test("makePRNG is deterministic", () => {
    const rngA = makePRNG(999);
    const rngB = makePRNG(999);
    for (let i = 0; i < 100; i++) {
      expect(rngA()).toBe(rngB());
    }
  });

  test("makePRNG produces values in [0, 1)", () => {
    const rng = makePRNG(42);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
