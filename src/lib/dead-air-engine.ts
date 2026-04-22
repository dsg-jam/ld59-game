// ── DEAD AIR ENGINE ──────────────────────────────────────────────────────────
// Pure logic for the "telephone" audio puzzle. A short melody is generated,
// then routed through a configurable chain of "relays" that distort it. The
// player hears only the distorted output and must reconstruct the original.
//
// This module is deliberately DOM-free / AudioContext-free so it can be tested
// in isolation. Audio synthesis & playback live in `src/lib/games/dead-air`.

// ── TYPES ────────────────────────────────────────────────────────────────────

export type NoteIndex = number; // 0..SCALE.length-1

export interface Melody {
  /** Sequence of note indices into the current scale (e.g. C major). */
  notes: NoteIndex[];
  /** Length in notes — mirrors `notes.length` but kept for ergonomics. */
  length: number;
}

export type RelayKind = "noise" | "lowpass" | "pitch" | "dropout" | "bitcrush" | "echo";

export interface Relay {
  kind: RelayKind;
  /** 0..1 strength. Higher → more destructive. */
  strength: number;
}

export interface RoundConfig {
  /** Number of notes in the melody. */
  melodyLength: number;
  /** Number of relays in the chain. */
  relayCount: number;
  /** Max strength of any individual relay, 0..1. */
  maxRelayStrength: number;
}

export interface ScoreBreakdown {
  /** 0..1 — exact note match ratio. */
  accuracy: number;
  /** How many notes the player got exactly right. */
  correct: number;
  /** Total notes. */
  total: number;
  /** Per-note correctness, same order as `guess`. */
  perNote: boolean[];
}

// ── CONSTANTS ────────────────────────────────────────────────────────────────

/** One octave of C-major (MIDI-ish semitone offsets from C4). */
export const SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11, 12];

/** Note names for UI (aligned with SCALE). */
export const SCALE_LABELS: readonly string[] = ["C", "D", "E", "F", "G", "A", "B", "C↑"];

/** Base frequency for the lowest scale degree. */
export const BASE_FREQ_HZ = 261.63; // C4

export const DEFAULT_ROUND: RoundConfig = {
  melodyLength: 4,
  relayCount: 2,
  maxRelayStrength: 0.45,
};

/** Ordered difficulty ramp. Round N clamps to the last entry. */
export const DIFFICULTY_LADDER: readonly RoundConfig[] = [
  { melodyLength: 4, relayCount: 1, maxRelayStrength: 0.3 },
  { melodyLength: 4, relayCount: 2, maxRelayStrength: 0.4 },
  { melodyLength: 5, relayCount: 2, maxRelayStrength: 0.5 },
  { melodyLength: 5, relayCount: 3, maxRelayStrength: 0.55 },
  { melodyLength: 6, relayCount: 3, maxRelayStrength: 0.65 },
  { melodyLength: 6, relayCount: 4, maxRelayStrength: 0.7 },
  { melodyLength: 7, relayCount: 4, maxRelayStrength: 0.8 },
  { melodyLength: 7, relayCount: 5, maxRelayStrength: 0.85 },
];

export const RELAY_KINDS: readonly RelayKind[] = [
  "noise",
  "lowpass",
  "pitch",
  "dropout",
  "bitcrush",
  "echo",
];

export const RELAY_LABELS: Record<RelayKind, string> = {
  noise: "NOISE",
  lowpass: "LO-PASS",
  pitch: "DETUNE",
  dropout: "DROPOUT",
  bitcrush: "BITCRUSH",
  echo: "ECHO",
};

export function relayLabel(kind: RelayKind): string {
  return RELAY_LABELS[kind];
}

/** For UI — "Relay 1 · NOISE 45%". */
export function describeRelay(index: number, relay: Relay): string {
  const pct = Math.round(relay.strength * 100);
  return `Relay ${index + 1} · ${relayLabel(relay.kind)} ${pct}%`;
}

// ── UTILITIES ────────────────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function getConfigForRound(round: number): RoundConfig {
  const idx = clamp(round, 0, DIFFICULTY_LADDER.length - 1);
  return DIFFICULTY_LADDER[idx] ?? DEFAULT_ROUND;
}

/** Convert a scale-degree note index to Hertz. */
export function noteToFreq(note: NoteIndex): number {
  const semis = SCALE[clamp(note, 0, SCALE.length - 1)] ?? 0;
  return BASE_FREQ_HZ * Math.pow(2, semis / 12);
}

// ── GENERATION ───────────────────────────────────────────────────────────────

/**
 * Generate a random melody of `length` notes over `SCALE`. Avoids immediate
 * repetitions (feels less musical) and keeps jumps small for a sing-able feel.
 */
export function generateMelody(length: number, rng: () => number = Math.random): Melody {
  const n = Math.max(1, Math.floor(length));
  const notes: NoteIndex[] = [];
  let prev = Math.floor(rng() * SCALE.length);
  notes.push(prev);
  for (let i = 1; i < n; i++) {
    // Random walk of ±1-3 degrees, clamped to scale, avoiding repeats.
    const step = Math.floor(rng() * 5) - 2 || 1; // -2..2, never 0
    let next = clamp(prev + step, 0, SCALE.length - 1);
    if (next === prev) next = clamp(prev + (step > 0 ? -1 : 1), 0, SCALE.length - 1);
    notes.push(next);
    prev = next;
  }
  return { notes, length: n };
}

/**
 * Build a chain of distortion relays. Strengths ramp up along the chain so
 * later relays hit harder (matches the "telephone" fatigue metaphor).
 */
export function generateRelayChain(
  count: number,
  maxStrength: number,
  rng: () => number = Math.random
): Relay[] {
  const n = Math.max(0, Math.floor(count));
  const result: Relay[] = [];
  let lastKind: RelayKind | null = null;
  for (let i = 0; i < n; i++) {
    // Pick a kind; avoid back-to-back duplicates when possible.
    let kind = RELAY_KINDS[Math.floor(rng() * RELAY_KINDS.length)] ?? "noise";
    if (kind === lastKind && RELAY_KINDS.length > 1) {
      kind = RELAY_KINDS[(RELAY_KINDS.indexOf(kind) + 1) % RELAY_KINDS.length] ?? kind;
    }
    lastKind = kind;
    // Ramp strength from ~40% to 100% of max along the chain.
    const t = n === 1 ? 1 : i / (n - 1);
    const base = 0.4 + 0.6 * t;
    const jitter = 0.8 + rng() * 0.4; // 0.8..1.2
    result.push({ kind, strength: clamp(base * jitter * maxStrength, 0, 1) });
  }
  return result;
}

// ── SCORING ──────────────────────────────────────────────────────────────────

/**
 * Compare a guess against the original melody. Missing or extra guesses are
 * treated as wrong — the guess array is compared index-by-index against the
 * original length.
 */
export function scoreGuess(original: Melody, guess: readonly NoteIndex[]): ScoreBreakdown {
  const total = original.notes.length;
  const perNote: boolean[] = [];
  let correct = 0;
  for (let i = 0; i < total; i++) {
    const ok = guess[i] === original.notes[i];
    perNote.push(ok);
    if (ok) correct += 1;
  }
  return {
    accuracy: total === 0 ? 0 : correct / total,
    correct,
    total,
    perNote,
  };
}

// ── DETERMINISTIC RNG ────────────────────────────────────────────────────────

/**
 * Deterministic PRNG (mulberry32) so hosts and guests can generate the same
 * melody/relay chain from a shared seed.
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
