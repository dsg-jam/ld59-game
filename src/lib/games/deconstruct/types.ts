export type ColKey = "R" | "G" | "B" | "Y" | "P";
export type ShapeDef = { name: string; cells: [number, number][] };
export type Card = { init: number; shape: ShapeDef; color: ColKey };
export type ScoreEntry = { slot: number; score: number };
export type Pick = { cardIdx: number; sel: [number, number][] | null };
export type MoveResult = {
  slot: number;
  card: Card | null;
  sel: [number, number][] | null;
  points: number;
};
export type GameMsg = { type: string; [key: string]: unknown };

export const W = 6;
export const H = 6;
export const D = 4;
export const BLOCK_SIZE = 1;
export const GAP = 0.08;
export const TABLE_RADIUS = 8;
export const MAX_PLAYERS = 6;
export const PEER_PREFIX = "decon-";
export const TOTAL_ROUNDS = 10;
export const MAX_INITIATIVE = 30;
export const WINNER_TIED = -2;

export const COLORS_HEX: Record<ColKey, number> = {
  R: 0xee5555,
  G: 0x55cc55,
  B: 0x5599ff,
  Y: 0xeedd55,
  P: 0xcc66ff,
};
export const COLORS_CSS: Record<ColKey, string> = {
  R: "#ee5555",
  G: "#55cc55",
  B: "#5599ff",
  Y: "#eedd55",
  P: "#cc66ff",
};
export const COLOR_NAMES: Record<ColKey, string> = {
  R: "ALPHA",
  G: "BETA",
  B: "GAMMA",
  Y: "DELTA",
  P: "EPSILON",
};
export const COLKEYS: ColKey[] = ["R", "G", "B", "Y", "P"];

export const SHAPES: ShapeDef[] = [
  { name: "PULSE", cells: [[0, 0]] },
  {
    name: "PAIR",
    cells: [
      [0, 0],
      [1, 0],
    ],
  },
  {
    name: "CARRIER",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  },
  {
    name: "SKIP",
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    name: "BURST",
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    name: "BEACON",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ],
  },
  {
    name: "RELAY",
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    name: "STREAK",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  },
];

export const PLAYER_COLORS_HEX = [0x03dac6, 0xcf6679, 0xfdd835, 0x3700b3, 0xff7043, 0x66bb6a];
export const PLAYER_CSS = ["#03dac6", "#cf6679", "#fdd835", "#3700b3", "#ff7043", "#66bb6a"];

/** Convert grid coords (gx, gy, gz) to world-space [X, Y, Z]. */
export function gridToWorld(gx: number, gy: number, gz: number): [number, number, number] {
  return [
    gx * (BLOCK_SIZE + GAP),
    gz * (BLOCK_SIZE + GAP) + BLOCK_SIZE * 0.44,
    gy * (BLOCK_SIZE + GAP),
  ];
}
