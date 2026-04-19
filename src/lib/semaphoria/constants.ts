// ── GRID ─────────────────────────────────────────────────────────────────────

export const GRID_COLS = 20;
export const GRID_ROWS = 20;

// ── SHIP PHYSICS ──────────────────────────────────────────────────────────────

/** Forward speed in tiles per second. */
export const SHIP_BASE_SPEED = 2.0;

/** Maximum turn rate in radians per second. */
export const SHIP_TURN_RATE = Math.PI;

/** Drift/current speed in tiles per second (applied when ship is not moving). */
export const DRIFT_SPEED = 0.25;

/** Angle of the ocean current (radians from north, positive = clockwise). */
export const WIND_ANGLE = Math.PI * 0.15;

// ── FOG OF WAR ───────────────────────────────────────────────────────────────

/** Radius (tiles) visible to the Captain around the ship. */
export const FOG_RADIUS = 3.5;

/** Keeper's ship area indicator is coarsened to this many tiles per grid cell. */
export const KEEPER_AREA_COARSENESS = 4;

// ── TIMING ────────────────────────────────────────────────────────────────────

/** Countdown before the round starts, in seconds. */
export const COUNTDOWN_S = 3;

// ── SIGNALS ───────────────────────────────────────────────────────────────────

/** Duration of a "dot" (short flash) in seconds. */
export const SIG_DOT = 0.22;

/** Duration of a "dash" (long flash) in seconds. */
export const SIG_DASH = 0.65;

/** Gap between consecutive flashes within one signal, in seconds. */
export const SIG_INTER_GAP = 0.18;

/** Silence gap after the last flash of a signal before the next can be sent. */
export const SIG_WORD_GAP = 0.5;

/** Cooldown in seconds before the Keeper can queue another signal. */
export const SIG_COOLDOWN = 2.5;

// ── PROXIMITY WARNING ─────────────────────────────────────────────────────────

/** Distance in tiles to the nearest reef that triggers audio proximity warning. */
export const PROXIMITY_WARN_DIST = 2.0;

// ── SIGNAL COLORS ─────────────────────────────────────────────────────────────

/** Hex color values for lighthouse beam signal colours. */
export const SIG_COLOR_HEX = {
  white: 0xffffff,
  red: 0xff3333,
  green: 0x44ff88,
  yellow: 0xffdd00,
} as const;

export type SigColor = keyof typeof SIG_COLOR_HEX;

// ── DIFFICULTY ────────────────────────────────────────────────────────────────

export interface DifficultyConfig {
  reefDensity: number;
  timerS: number;
  pathTurns: number;
  label: string;
}

export const DIFFICULTY_CONFIG: readonly DifficultyConfig[] = [
  { reefDensity: 0.12, timerS: 150, pathTurns: 3, label: "CALM" },
  { reefDensity: 0.22, timerS: 120, pathTurns: 5, label: "CHOPPY" },
  { reefDensity: 0.32, timerS: 90, pathTurns: 7, label: "TEMPEST" },
];

export type Difficulty = 0 | 1 | 2;

/** Upper bound (exclusive) for the PRNG seed — 24-bit range gives 16M distinct maps. */
export const SEED_MAX = 0x1000000; // 16,777,216
