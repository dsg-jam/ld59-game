import {
  SHIP_BASE_SPEED,
  SHIP_TURN_RATE,
  DRIFT_SPEED,
  WIND_ANGLE,
  FOG_RADIUS,
  KEEPER_AREA_COARSENESS,
  PROXIMITY_WARN_DIST,
  WRECK_RESCUE_DIST,
  GRID_COLS,
  GRID_ROWS,
} from "./constants";
import type { GameMap, Shipwreck } from "./map-generator";

// ── TYPES ────────────────────────────────────────────────────────────────────

export interface ShipState {
  /** X position in tile coordinates (float). */
  x: number;
  /** Y position in tile coordinates (float). 0 = north/top, rows-1 = south/bottom. */
  y: number;
  /**
   * Heading in radians.  0 = north (toward y=0), π/2 = east, π = south, -π/2 = west.
   */
  heading: number;
  /** Current forward speed in tiles per second. */
  speed: number;
}

export type TurnDirection = "left" | "right" | "none";

// ── FACTORY ───────────────────────────────────────────────────────────────────

export function createInitialShip(startX: number, startY: number): ShipState {
  return {
    x: startX,
    y: startY,
    heading: 0, // 0 = north, ship starts facing the harbor
    speed: SHIP_BASE_SPEED,
  };
}

// ── MOVEMENT ──────────────────────────────────────────────────────────────────

/**
 * Apply a turning input to the ship, clamped to the maximum turn rate.
 * Returns a new ShipState with updated heading.
 */
export function applyTurn(ship: ShipState, dir: TurnDirection, dt: number): ShipState {
  if (dir === "none") return ship;
  const delta = (dir === "left" ? -1 : 1) * SHIP_TURN_RATE * dt;
  return { ...ship, heading: ship.heading + delta };
}

/**
 * Advance the ship position by one frame.
 * When `moving` is true the ship moves forward at its speed.
 * When false it drifts with the ocean current.
 */
export function moveShip(ship: ShipState, dt: number, moving: boolean): ShipState {
  let vx: number;
  let vy: number;

  if (moving) {
    // Forward movement along heading direction
    vx = Math.sin(ship.heading) * ship.speed;
    vy = -Math.cos(ship.heading) * ship.speed; // negative Y = north
  } else {
    // Ocean current / drift
    vx = Math.sin(WIND_ANGLE) * DRIFT_SPEED;
    vy = -Math.cos(WIND_ANGLE) * DRIFT_SPEED;
  }

  return {
    ...ship,
    x: Math.max(0, Math.min(GRID_COLS - 1, ship.x + vx * dt)),
    y: Math.max(0, Math.min(GRID_ROWS - 1, ship.y + vy * dt)),
  };
}

// ── COLLISION ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the ship's current position overlaps a reef tile.
 * Uses the rounded tile index of the ship's float position.
 */
export function checkCollision(ship: ShipState, map: GameMap): boolean {
  const tx = Math.round(ship.x);
  const ty = Math.round(ship.y);
  return map.tiles[ty]?.[tx]?.type === "reef";
}

/**
 * Returns true if the ship has reached the harbor tile.
 */
export function checkHarborReached(ship: ShipState, map: GameMap): boolean {
  const tx = Math.round(ship.x);
  const ty = Math.round(ship.y);
  return tx === map.harborX && ty === map.harborY;
}

// ── FOG OF WAR ────────────────────────────────────────────────────────────────

/**
 * Returns the set of tile keys ("x,y") visible to the Captain — those within
 * FOG_RADIUS of the ship's current position.
 */
export function getRevealedTileKeys(ship: ShipState): ReadonlySet<string> {
  const result = new Set<string>();
  const cx = Math.round(ship.x);
  const cy = Math.round(ship.y);
  const r = Math.ceil(FOG_RADIUS);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) <= FOG_RADIUS) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS) {
          result.add(`${tx},${ty}`);
        }
      }
    }
  }
  return result;
}

/**
 * Returns a coarsened position shown to the Keeper — the ship's tile coordinates
 * snapped to the nearest multiple of KEEPER_AREA_COARSENESS.  This prevents the
 * Keeper from knowing the exact position, keeping the communication challenge.
 */
export function getKeeperAreaTile(ship: ShipState): { x: number; y: number } {
  const snap = KEEPER_AREA_COARSENESS;
  return {
    x: Math.round(ship.x / snap) * snap,
    y: Math.round(ship.y / snap) * snap,
  };
}

// ── PROXIMITY ─────────────────────────────────────────────────────────────────

/**
 * Returns the Euclidean distance (in tiles) to the nearest reef tile.
 * Used to trigger proximity warning audio.
 */
export function getNearestReefDistance(ship: ShipState, map: GameMap): number {
  const searchR = Math.ceil(PROXIMITY_WARN_DIST) + 1;
  const cx = Math.round(ship.x);
  const cy = Math.round(ship.y);
  let minDist = Infinity;

  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      if (map.tiles[cy + dy]?.[cx + dx]?.type === "reef") {
        // Include the fractional tile offset so distance is from the ship's exact position
        const offsetX = ship.x - cx;
        const offsetY = ship.y - cy;
        const d = Math.hypot(dx - offsetX, dy - offsetY);
        if (d < minDist) minDist = d;
      }
    }
  }
  return minDist;
}

/**
 * Returns true when the ship is dangerously close to a reef.
 */
export function isNearReef(ship: ShipState, map: GameMap): boolean {
  return getNearestReefDistance(ship, map) <= PROXIMITY_WARN_DIST;
}

// ── SHIPWRECK RESCUE ──────────────────────────────────────────────────────────

/**
 * Returns the first unrescued wreck within {@link WRECK_RESCUE_DIST} of the
 * ship, or `null` if none are in range.  The captain rescues a wreck by
 * sailing within this radius.
 */
export function findRescueableWreck(
  ship: ShipState,
  wrecks: readonly Shipwreck[],
  rescued: ReadonlySet<number>
): Shipwreck | null {
  for (const w of wrecks) {
    if (rescued.has(w.id)) continue;
    const d = Math.hypot(ship.x - w.x, ship.y - w.y);
    if (d <= WRECK_RESCUE_DIST) return w;
  }
  return null;
}
