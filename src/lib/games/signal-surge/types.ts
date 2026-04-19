export const PEER_PREFIX = "sigsurge-";
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 3;
export const LANE_COUNT = 5;
export const LANE_WIDTH = 1.8;
export const TRACK_LENGTH = 220;

export const BASE_SPEED = 14;
export const NOISE_SLOW = 0.35;
export const NOISE_DURATION = 1.1;
export const AMP_BOOST_SPEED = 24;
export const AMP_DURATION = 1.6;
export const BURST_SPEED = 34;
export const BURST_DURATION = 1.2;
export const BURST_CHARGES = 3;

export const NETWORK_TICK_RATE = 0.05;
export const ROOM_CODE_LENGTH = 5;
export const COUNTDOWN_SECONDS = 3;
export const OBSTACLE_CELL_STRIDE = 6;
export const OBSTACLE_START_Z = 16;
export const FINISH_GRACE_SECONDS = 10;
export const NAME_MAX = 14;

export const PLAYER_COLOR_CSS = [
  "#79f3ff",
  "#ff7ccf",
  "#ffd66b",
  "#8dff9d",
  "#ba7cff",
  "#ff9e6b",
] as const;

export const PLAYER_COLOR_HEX = [
  0x79f3ff, 0xff7ccf, 0xffd66b, 0x8dff9d, 0xba7cff, 0xff9e6b,
] as const;

export type ObstacleKind = "noise" | "amp";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: number;
  z: number;
}

export interface PlayerSnap {
  slot: number;
  name: string;
  color: string;
  z: number;
  lane: number;
  targetLane: number;
  slowUntil: number;
  boostUntil: number;
  burstUntil: number;
  burstsLeft: number;
  finished: boolean;
  finishTime: number | null;
}

export interface GameSnapshot {
  t: number;
  running: boolean;
  finished: boolean;
  countdown: number;
  players: PlayerSnap[];
  obstacles: Obstacle[];
  trackLength: number;
  laneCount: number;
  winnerSlot: number | null;
  order: number[];
}

export interface LobbyPlayer {
  slot: number;
  name: string;
  color: string;
  isYou: boolean;
}

export interface FinishEntry {
  slot: number;
  name: string;
  color: string;
}

export interface LogEntry {
  id: number;
  text: string;
  kind: string;
}

/** Convert a lane index to its world-space X coordinate. */
export function laneToX(lane: number): number {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
}

/** Clamp a (possibly fractional) lane to a valid integer index. */
export function clampLane(lane: number): number {
  if (lane < 0) return 0;
  if (lane > LANE_COUNT - 1) return LANE_COUNT - 1;
  return lane;
}
