// ── TYPES ────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  alive: boolean;
  spectator: boolean;
}

export interface Tower {
  id: string;
  x: number;
  y: number;
  progress: number;
}

export type Role = "mimic" | "researcher";

export type Winner = "mimic" | "researchers";

export interface VoteState {
  active: boolean;
  endsAt: number;
  votes: Record<string, string>;
  caller: string;
}

export interface VoteResult {
  eliminated: string | null;
  correct: boolean;
  tie: boolean;
}

// ── CONSTANTS ────────────────────────────────────────────────────────────────

export const WORLD_W = 1400;
export const WORLD_H = 900;
export const PLAYER_SPEED = 150;
export const PLAYER_COLORS = ["#ffb800", "#66d9ff", "#ff66cc", "#95ff66", "#ff8a66", "#b19dff"];
export const MAX_PLAYERS = 6;
export const TOWER_REQUIRED = 30;
export const REPAIR_RADIUS = 40;
export const WARM_X = WORLD_W * 0.5;
export const WARM_Y = WORLD_H * 0.5;
export const WARM_R = 170;
export const DARK_CHECK_RADIUS = 300;
export const VOTE_DURATION_MS = 30_000;
export const ELIM_COOLDOWN_MS = 20_000;
export const PLAYBACK_COOLDOWN_MS = 8_000;
export const SNIPPET_DURATION_MS = 3_000;

export const DEFAULT_TOWERS: readonly Readonly<Tower>[] = [
  { id: "A", x: WORLD_W * 0.5, y: 140, progress: 0 },
  { id: "B", x: 250, y: WORLD_H - 200, progress: 0 },
  { id: "C", x: WORLD_W - 250, y: WORLD_H - 200, progress: 0 },
] as const;

// ── UTILITIES ────────────────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// ── FACTORIES ────────────────────────────────────────────────────────────────

export function createDefaultTowers(): Tower[] {
  return DEFAULT_TOWERS.map((t) => ({ ...t }));
}

export function createPlayer(id: string, name: string, index: number): Player {
  return {
    id,
    name,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length] ?? "#ffffff",
    x: WARM_X + Math.cos(index * 1.7) * 30,
    y: WARM_Y + Math.sin(index * 1.7) * 30,
    alive: true,
    spectator: false,
  };
}

// ── ROLE ASSIGNMENT ──────────────────────────────────────────────────────────

/**
 * Assign one random player as the mimic; all others are researchers.
 * Accepts an optional `rng` (returns [0,1)) for deterministic tests.
 */
export function assignRoles(
  playerIds: readonly string[],
  rng: () => number = Math.random
): Map<string, Role> {
  if (playerIds.length === 0) {
    return new Map();
  }
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = shuffled[i] ?? "";
    shuffled[i] = shuffled[j] ?? "";
    shuffled[j] = tmp;
  }
  const mimicId = shuffled[0] ?? playerIds[0];
  if (mimicId === undefined) return new Map();
  const roles = new Map<string, Role>();
  for (const id of playerIds) {
    roles.set(id, id === mimicId ? "mimic" : "researcher");
  }
  return roles;
}

// ── WIN CONDITIONS ───────────────────────────────────────────────────────────

/**
 * Check if the game has a winner.
 *
 * - **researchers** win when all 3 towers are fully repaired, or the mimic
 *   is no longer alive (voted out).
 * - **mimic** wins when **all** researchers have been eliminated.
 *
 * Returns `null` when the game is still in progress.
 */
export function checkWinConditions(
  players: ReadonlyMap<string, Player>,
  roles: ReadonlyMap<string, Role>,
  towers: readonly Tower[]
): Winner | null {
  const towersDone = towers.every((t) => t.progress >= TOWER_REQUIRED);
  if (towersDone) return "researchers";

  const mimicAlive = [...players.values()].some((p) => p.alive && roles.get(p.id) === "mimic");
  if (!mimicAlive) return "researchers";

  const researchersAlive = [...players.values()].filter(
    (p) => p.alive && roles.get(p.id) === "researcher"
  ).length;
  if (researchersAlive === 0) return "mimic";

  return null;
}

// ── TOWER REPAIR ─────────────────────────────────────────────────────────────

/**
 * Advance tower repair progress for every tower that has an alive researcher
 * within `REPAIR_RADIUS`.  Mutates `towers` in-place and returns the count
 * of towers that were being repaired this tick.
 */
export function updateTowers(
  towers: Tower[],
  players: ReadonlyMap<string, Player>,
  roles: ReadonlyMap<string, Role>,
  dt: number
): number {
  let repairing = 0;
  for (const tower of towers) {
    if (tower.progress >= TOWER_REQUIRED) continue;
    const hasRepairer = [...players.values()].some((p) => {
      if (!p.alive) return false;
      if (roles.get(p.id) !== "researcher") return false;
      return dist(p.x, p.y, tower.x, tower.y) <= REPAIR_RADIUS;
    });
    if (hasRepairer) {
      tower.progress = Math.min(TOWER_REQUIRED, tower.progress + dt);
      repairing++;
    }
  }
  return repairing;
}

// ── ISOLATION CHECK ──────────────────────────────────────────────────────────

/**
 * A player is "isolated in dark" when they are far from every tower AND
 * far from every other alive non-mimic player.  The mimic can only eliminate
 * targets that satisfy this condition.
 */
export function isIsolatedInDark(
  targetId: string,
  players: ReadonlyMap<string, Player>,
  roles: ReadonlyMap<string, Role>,
  towers: readonly Tower[]
): boolean {
  const target = players.get(targetId);
  if (!target || !target.alive) return false;
  for (const t of towers) {
    if (dist(target.x, target.y, t.x, t.y) <= DARK_CHECK_RADIUS) return false;
  }
  const others = [...players.values()].filter(
    (p) => p.id !== targetId && p.alive && roles.get(p.id) !== "mimic"
  );
  for (const p of others) {
    if (dist(target.x, target.y, p.x, p.y) <= DARK_CHECK_RADIUS) return false;
  }
  return true;
}

// ── VOTE RESOLUTION ──────────────────────────────────────────────────────────

/**
 * Tally votes and return the result.  Does NOT mutate game state — the
 * caller decides what to do with the result (eliminate, announce, etc.).
 */
export function resolveVote(
  vote: VoteState,
  players: ReadonlyMap<string, Player>,
  roles: ReadonlyMap<string, Role>
): VoteResult {
  const tally = new Map<string, number>();
  for (const target of Object.values(vote.votes)) {
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  let winnerId: string | null = null;
  let top = -1;
  let tie = false;
  for (const [id, count] of tally) {
    if (count > top) {
      top = count;
      winnerId = id;
      tie = false;
    } else if (count === top) {
      tie = true;
    }
  }

  if (tie || !winnerId || !players.has(winnerId)) {
    return { eliminated: null, correct: false, tie: true };
  }

  const isMimic = roles.get(winnerId) === "mimic";
  return { eliminated: winnerId, correct: isMimic, tie: false };
}

// ── MOVEMENT ─────────────────────────────────────────────────────────────────

/**
 * Apply directional input to a player.  Returns the new position (clamped
 * to world bounds).  Does NOT mutate the player — the caller writes back.
 */
export function applyMovement(
  x: number,
  y: number,
  dx: number,
  dy: number,
  dt: number,
  speed: number = PLAYER_SPEED
): { x: number; y: number } {
  if (dx === 0 && dy === 0) return { x, y };
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: clamp(x + (dx / len) * speed * dt, 0, WORLD_W),
    y: clamp(y + (dy / len) * speed * dt, 0, WORLD_H),
  };
}
