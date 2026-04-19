import type { SigColor } from "./constants";

// ── TYPES ────────────────────────────────────────────────────────────────────

export type FlashType = "dot" | "dash";

export interface Flash {
  type: FlashType;
  color: SigColor;
}

export type FlashPattern = readonly Flash[];

export type SignalCommand =
  | "go"
  | "left"
  | "right"
  | "stop"
  | "reverse"
  | "rocks-ahead"
  | "rocks-left"
  | "rocks-right";

// ── SIGNAL ALPHABET ───────────────────────────────────────────────────────────

/**
 * Mapping from signal command to its canonical flash pattern.
 * Each command has a unique color+type sequence so decoding is unambiguous.
 */
export const SIGNAL_ALPHABET: Record<SignalCommand, FlashPattern> = {
  // Directional commands — white for navigation
  go: [{ type: "dot", color: "white" }],
  left: [
    { type: "dot", color: "green" },
    { type: "dot", color: "green" },
  ],
  right: [
    { type: "dot", color: "red" },
    { type: "dash", color: "red" },
  ],
  stop: [{ type: "dash", color: "yellow" }],
  reverse: [
    { type: "dash", color: "yellow" },
    { type: "dot", color: "yellow" },
  ],
  // Hazard warnings — all red, distinguished by dot/dash pattern
  "rocks-ahead": [
    { type: "dash", color: "red" },
    { type: "dash", color: "red" },
    { type: "dash", color: "red" },
  ],
  "rocks-left": [
    { type: "dot", color: "red" },
    { type: "dash", color: "red" },
    { type: "dash", color: "red" },
  ],
  "rocks-right": [
    { type: "dash", color: "red" },
    { type: "dash", color: "red" },
    { type: "dot", color: "red" },
  ],
};

// ── ENCODING & DECODING ───────────────────────────────────────────────────────

/** Return the canonical flash pattern for a given command. */
export function encodeSignal(command: SignalCommand): FlashPattern {
  return SIGNAL_ALPHABET[command];
}

/**
 * Attempt to decode a received flash sequence.
 * Returns the matched command or `null` if the pattern is unrecognised.
 */
export function decodePattern(pattern: readonly Flash[]): SignalCommand | null {
  for (const [cmd, reference] of Object.entries(SIGNAL_ALPHABET) as [
    SignalCommand,
    FlashPattern,
  ][]) {
    if (flashPatternsMatch(pattern, reference)) return cmd;
  }
  return null;
}

function flashPatternsMatch(a: readonly Flash[], b: readonly Flash[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((flash, i) => {
    const ref = b[i];
    return ref !== undefined && flash.type === ref.type && flash.color === ref.color;
  });
}

// ── REFERENCE CARD ────────────────────────────────────────────────────────────

export interface SignalRefEntry {
  command: SignalCommand;
  label: string;
  description: string;
  pattern: FlashPattern;
}

const SIGNAL_LABELS: Record<SignalCommand, string> = {
  go: "GO",
  left: "TURN LEFT",
  right: "TURN RIGHT",
  stop: "STOP",
  reverse: "REVERSE",
  "rocks-ahead": "ROCKS AHEAD",
  "rocks-left": "ROCKS LEFT",
  "rocks-right": "ROCKS RIGHT",
};

const SIGNAL_DESCRIPTIONS: Record<SignalCommand, string> = {
  go: "Proceed straight ahead",
  left: "Turn to port (left)",
  right: "Turn to starboard (right)",
  stop: "All stop",
  reverse: "Back up",
  "rocks-ahead": "Danger directly ahead",
  "rocks-left": "Danger on port side",
  "rocks-right": "Danger on starboard side",
};

/** Ordered list of all signal commands — used to ensure consistent iteration across environments. */
const COMMAND_ORDER: readonly SignalCommand[] = [
  "go",
  "left",
  "right",
  "stop",
  "reverse",
  "rocks-ahead",
  "rocks-left",
  "rocks-right",
];

/** Full reference card data for display to both players. */
export const SIGNAL_REFERENCE: readonly SignalRefEntry[] = COMMAND_ORDER.map((cmd) => ({
  command: cmd,
  label: SIGNAL_LABELS[cmd],
  description: SIGNAL_DESCRIPTIONS[cmd],
  pattern: SIGNAL_ALPHABET[cmd],
}));
