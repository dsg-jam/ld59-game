import {
  COUNTDOWN_S,
  DIFFICULTY_CONFIG,
  SIG_DOT,
  SIG_DASH,
  SIG_INTER_GAP,
  SIG_WORD_GAP,
  SIG_COOLDOWN,
} from "./constants";
import type { Difficulty, SigColor } from "./constants";
import { generateMap } from "./map-generator";
import type { GameMap } from "./map-generator";
import {
  createInitialShip,
  applyTurn,
  moveShip,
  checkCollision,
  checkHarborReached,
  findRescueableWreck,
  isNearReef,
  getRevealedTileKeys,
} from "./navigation";
import type { ShipState, TurnDirection } from "./navigation";
import type { SignalCommand, FlashPattern, Flash } from "./signals";
import { encodeSignal } from "./signals";

// ── TYPES ─────────────────────────────────────────────────────────────────────

export type GamePhase = "lobby" | "countdown" | "playing" | "success" | "failure";

export type PlayerRole = "captain" | "keeper";

export interface CaptainInput {
  turning: TurnDirection;
  moving: boolean;
}

/** A single flash event in progress on the lighthouse. */
export interface ActiveFlash {
  /** The flash currently being displayed (undefined = dark / inter-gap). */
  flash: Flash | null;
  /** Remaining time for this flash or gap, in seconds. */
  timeLeft: number;
  /** Index of the next flash to play in the pattern. */
  nextIndex: number;
}

export interface GameStats {
  timeTaken: number;
  signalsSent: number;
  nearMisses: number;
  wrecksRescued: number;
  wrecksTotal: number;
  result: "success" | "failure";
}

export interface GameState {
  phase: GamePhase;
  map: GameMap;
  ship: ShipState;
  /** Tile keys ("x,y") visible to the Captain. Updated each tick. */
  revealedTileKeys: ReadonlySet<string>;
  /** Signal currently being played by the lighthouse. */
  activeFlash: ActiveFlash | null;
  /** Remaining cooldown before the Keeper can send another signal, in seconds. */
  signalCooldown: number;
  /** Remaining round time in seconds. */
  timeRemaining: number;
  /** Remaining countdown time in seconds (only relevant in "countdown" phase). */
  countdownRemaining: number;
  /** Total signals sent this round. */
  signalsSent: number;
  /** Number of close reef encounters. */
  nearMisses: number;
  /** Whether the ship was near a reef last tick (for tracking near-misses). */
  wasNearReef: boolean;
  /** IDs of shipwrecks the captain has sailed close enough to rescue. */
  rescuedWreckIds: ReadonlySet<number>;
  /** ID of the most recently rescued wreck (for UI / audio cues). */
  lastRescuedWreckId: number | null;
  seed: number;
  difficulty: Difficulty;
}

// ── FACTORY ───────────────────────────────────────────────────────────────────

export function createInitialState(seed: number, difficulty: Difficulty): GameState {
  const map = generateMap(seed, difficulty);
  const config = DIFFICULTY_CONFIG[difficulty];
  return {
    phase: "lobby",
    map,
    ship: createInitialShip(map.startX, map.startY),
    revealedTileKeys: new Set(),
    activeFlash: null,
    signalCooldown: 0,
    timeRemaining: config.timerS,
    countdownRemaining: COUNTDOWN_S,
    signalsSent: 0,
    nearMisses: 0,
    wasNearReef: false,
    rescuedWreckIds: new Set<number>(),
    lastRescuedWreckId: null,
    seed,
    difficulty,
  };
}

// ── STATE MACHINE ─────────────────────────────────────────────────────────────

/** Transition from lobby → countdown. */
export function startCountdown(state: GameState): GameState {
  if (state.phase !== "lobby") return state;
  return { ...state, phase: "countdown", countdownRemaining: COUNTDOWN_S };
}

/** Advance the countdown by `dt` seconds; transitions to "playing" when done. */
function tickCountdown(state: GameState, dt: number): GameState {
  const next = state.countdownRemaining - dt;
  if (next <= 0) {
    return { ...state, phase: "playing", countdownRemaining: 0 };
  }
  return { ...state, countdownRemaining: next };
}

/** Advance the active flash animation by `dt` seconds. Returns updated state. */
function tickFlash(state: GameState, dt: number): GameState {
  if (!state.activeFlash) return state;

  const af = state.activeFlash;
  const remaining = af.timeLeft - dt;

  if (remaining > 0) {
    return { ...state, activeFlash: { ...af, timeLeft: remaining } };
  }

  // Current period ended — advance to next element
  const overflow = -remaining;

  // If we were showing a flash, transition to inter-gap
  if (af.flash !== null) {
    if (af.nextIndex < 0) {
      // Negative nextIndex signals that this was the last flash; enter word-gap (dark)
      return {
        ...state,
        activeFlash: { flash: null, timeLeft: SIG_WORD_GAP - overflow, nextIndex: -2 },
      };
    }
    return {
      ...state,
      activeFlash: { flash: null, timeLeft: SIG_INTER_GAP - overflow, nextIndex: af.nextIndex },
    };
  }

  // If nextIndex is -2, the word gap is over — clear the flash state
  if (af.nextIndex === -2) {
    return { ...state, activeFlash: null };
  }

  // We were in an inter-gap; time to show the next flash
  return state; // handled by startNextFlash below
}

function startNextFlashStep(state: GameState, pattern: FlashPattern, index: number): GameState {
  if (index >= pattern.length) {
    // Pattern exhausted — enter word-gap then clear
    return {
      ...state,
      activeFlash: { flash: null, timeLeft: SIG_WORD_GAP, nextIndex: -2 },
    };
  }
  const f = pattern[index];
  if (!f) return state;
  const duration = f.type === "dot" ? SIG_DOT : SIG_DASH;
  const isLast = index === pattern.length - 1;
  return {
    ...state,
    activeFlash: {
      flash: { color: f.color, type: f.type },
      timeLeft: duration,
      nextIndex: isLast ? -1 : index + 1,
    },
  };
}

/** Handle the transition when an inter-gap expires and the next flash should start. */
function advanceFlash(state: GameState, pattern: FlashPattern): GameState {
  if (!state.activeFlash || state.activeFlash.flash !== null) return state;
  if (state.activeFlash.nextIndex < 0) return state;
  return startNextFlashStep(state, pattern, state.activeFlash.nextIndex);
}

/** Advance the playing phase by one frame. Returns the updated state. */
function tickPlaying(state: GameState, dt: number, input: CaptainInput): GameState {
  // Advance round timer
  const timeRemaining = Math.max(0, state.timeRemaining - dt);
  if (timeRemaining === 0) {
    return { ...state, timeRemaining: 0, phase: "failure" };
  }

  // Apply captain input
  let ship = applyTurn(state.ship, input.turning, dt);
  ship = moveShip(ship, dt, input.moving);

  // Collision → failure
  if (checkCollision(ship, state.map)) {
    return { ...state, ship, timeRemaining, phase: "failure" };
  }

  // Rescue any wreck we drifted near — do this before harbor check so a wreck
  // placed one tile short of the harbor still counts.
  let rescuedWreckIds = state.rescuedWreckIds;
  let lastRescuedWreckId = state.lastRescuedWreckId;
  const newWreck = findRescueableWreck(ship, state.map.wrecks, rescuedWreckIds);
  if (newWreck) {
    const next = new Set(rescuedWreckIds);
    next.add(newWreck.id);
    rescuedWreckIds = next;
    lastRescuedWreckId = newWreck.id;
  }

  // Harbor reached → success only if every wreck has been rescued.
  // Otherwise the harbour is "closed" until the ship finishes the rescue sweep;
  // the captain can still drift over it but the round doesn't end.
  if (checkHarborReached(ship, state.map)) {
    if (rescuedWreckIds.size >= state.map.wrecks.length) {
      return {
        ...state,
        ship,
        timeRemaining,
        phase: "success",
        rescuedWreckIds,
        lastRescuedWreckId,
      };
    }
    // Fall through: rescue sweep incomplete, keep sailing.
  }

  // Track near-misses (entering danger zone for the first time counts as one)
  const nearReef = isNearReef(ship, state.map);
  const nearMisses = !state.wasNearReef && nearReef ? state.nearMisses + 1 : state.nearMisses;

  // Update signal cooldown
  const signalCooldown = Math.max(0, state.signalCooldown - dt);

  // Update revealed tiles
  const revealedTileKeys = getRevealedTileKeys(ship);

  return {
    ...state,
    ship,
    timeRemaining,
    signalCooldown,
    nearMisses,
    wasNearReef: nearReef,
    revealedTileKeys,
    rescuedWreckIds,
    lastRescuedWreckId,
  };
}

// ── PUBLIC TICK ───────────────────────────────────────────────────────────────

/**
 * Advance the keeper's display during the playing phase.
 * Only the signal cooldown and timer display are updated; no ship physics
 * or phase transitions are applied — those are driven by captain-side messages.
 */
function tickKeeperPlaying(state: GameState, dt: number): GameState {
  const timeRemaining = Math.max(0, state.timeRemaining - dt);
  const signalCooldown = Math.max(0, state.signalCooldown - dt);
  return { ...state, timeRemaining, signalCooldown };
}

/**
 * Advance the game state by `dt` seconds.
 * `input` is only applied in the "playing" phase.
 * When `isKeeper` is true the ship physics, collision checks, and phase
 * transitions are skipped — the keeper receives those via network messages.
 * Returns the updated state.
 */
export function tick(
  state: GameState,
  dt: number,
  input: CaptainInput,
  activePattern: FlashPattern | null,
  isKeeper = false
): GameState {
  let s = state;

  // Advance signal animation
  if (s.activeFlash) {
    s = tickFlash(s, dt);
    // If flash state is now in an inter-gap and we have the pattern, advance
    if (
      s.activeFlash &&
      s.activeFlash.flash === null &&
      s.activeFlash.nextIndex >= 0 &&
      activePattern
    ) {
      s = advanceFlash(s, activePattern);
    }
  }

  if (s.phase === "countdown") return tickCountdown(s, dt);
  if (s.phase === "playing") return isKeeper ? tickKeeperPlaying(s, dt) : tickPlaying(s, dt, input);
  return s;
}

// ── SIGNAL DISPATCH ───────────────────────────────────────────────────────────

/**
 * Keeper sends a signal.  Returns updated state if allowed, or the unchanged
 * state if the cooldown has not expired or a signal is already playing.
 */
export function sendSignal(state: GameState, command: SignalCommand): GameState {
  if (state.phase !== "playing") return state;
  if (state.signalCooldown > 0) return state;
  if (state.activeFlash !== null) return state;

  const pattern = encodeSignal(command);
  const s = startNextFlashStep(state, pattern, 0);
  return {
    ...s,
    signalsSent: state.signalsSent + 1,
    signalCooldown: SIG_COOLDOWN,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** Derive game stats from a completed state. */
export function deriveStats(state: GameState): GameStats {
  const config = DIFFICULTY_CONFIG[state.difficulty];
  return {
    timeTaken: config.timerS - state.timeRemaining,
    signalsSent: state.signalsSent,
    nearMisses: state.nearMisses,
    wrecksRescued: state.rescuedWreckIds.size,
    wrecksTotal: state.map.wrecks.length,
    result: state.phase === "success" ? "success" : "failure",
  };
}

/** Get the current flash signal colour, or null when dark. */
export function getCurrentFlashColor(state: GameState): SigColor | null {
  return state.activeFlash?.flash?.color ?? null;
}

/**
 * Mark a wreck as rescued on a replica state (keeper side).  No-op if the
 * wreck is unknown or already rescued; returns the original state reference
 * in that case so effects / reactive updates don't re-fire needlessly.
 */
export function markWreckRescued(state: GameState, wreckId: number): GameState {
  if (state.rescuedWreckIds.has(wreckId)) return state;
  const known = state.map.wrecks.some((w) => w.id === wreckId);
  if (!known) return state;
  const next = new Set(state.rescuedWreckIds);
  next.add(wreckId);
  return { ...state, rescuedWreckIds: next, lastRescuedWreckId: wreckId };
}

export { encodeSignal };
export type { SignalCommand, FlashPattern };
