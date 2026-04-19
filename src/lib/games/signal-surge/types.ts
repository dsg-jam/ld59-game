export const PEER_PREFIX = "sigsurge-";
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
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

export const NETWORK_TICK_RATE = 0.033;
export const ROOM_CODE_LENGTH = 5;
export const COUNTDOWN_SECONDS = 3;
export const OBSTACLE_START_Z = 16;
export const FINISH_GRACE_SECONDS = 10;
export const NAME_MAX = 14;

export type PropStyle = "antenna" | "crystal" | "ring" | "pillar";

export interface TrackVariant {
  id: string;
  name: string;
  description: string;
  trackLength: number;
  obstacleStride: number;
  ampRatio: number;
  maxLanesOccupied: number;
  trackColor: number;
  railColor: number;
  accentColor: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  // Centerline shape: x(z) = amp * sin(z*freq + phase) + amp2 * sin(z*freq2 + phase*1.7)
  curveAmplitude: number;
  curveFrequency: number;
  curvePhase: number;
  curveAmplitude2: number;
  curveFrequency2: number;
  // Side props spaced along the track.
  propStyle: PropStyle;
  propColor: number;
  propStride: number;
  propOffset: number;
  // Occasional overhead gates.
  archStride: number;
  archColor: number;
}

export const TRACK_VARIANTS: readonly TrackVariant[] = [
  {
    id: "broadcast",
    name: "BROADCAST",
    description: "Balanced channel. Standard noise and amplifier mix.",
    trackLength: 240,
    obstacleStride: 6,
    ampRatio: 0.28,
    maxLanesOccupied: 3,
    trackColor: 0x0a1226,
    railColor: 0x79f3ff,
    accentColor: 0x1d3a6e,
    fogColor: 0x040610,
    fogNear: 60,
    fogFar: 280,
    curveAmplitude: 5,
    curveFrequency: 0.025,
    curvePhase: 0.4,
    curveAmplitude2: 2,
    curveFrequency2: 0.06,
    propStyle: "antenna",
    propColor: 0x79f3ff,
    propStride: 12,
    propOffset: 2.5,
    archStride: 60,
    archColor: 0x79f3ff,
  },
  {
    id: "static-storm",
    name: "STATIC STORM",
    description: "Serpentine channel. Dense noise, few amps.",
    trackLength: 210,
    obstacleStride: 4.4,
    ampRatio: 0.16,
    maxLanesOccupied: 4,
    trackColor: 0x180a1e,
    railColor: 0xff7ccf,
    accentColor: 0x4a1a3a,
    fogColor: 0x0a0410,
    fogNear: 40,
    fogFar: 210,
    curveAmplitude: 7,
    curveFrequency: 0.04,
    curvePhase: 1.2,
    curveAmplitude2: 3,
    curveFrequency2: 0.1,
    propStyle: "crystal",
    propColor: 0xff7ccf,
    propStride: 8,
    propOffset: 2.2,
    archStride: 42,
    archColor: 0xff4fa0,
  },
  {
    id: "amp-grid",
    name: "AMPLIFIER GRID",
    description: "Gentle sprint. Boost arrays, open lanes.",
    trackLength: 200,
    obstacleStride: 5.2,
    ampRatio: 0.52,
    maxLanesOccupied: 2,
    trackColor: 0x0a1f14,
    railColor: 0x8dff9d,
    accentColor: 0x1a5a30,
    fogColor: 0x041008,
    fogNear: 55,
    fogFar: 260,
    curveAmplitude: 3,
    curveFrequency: 0.02,
    curvePhase: 2.1,
    curveAmplitude2: 1.5,
    curveFrequency2: 0.05,
    propStyle: "ring",
    propColor: 0x8dff9d,
    propStride: 14,
    propOffset: 2.8,
    archStride: 48,
    archColor: 0x8dff9d,
  },
  {
    id: "long-haul",
    name: "LONG HAUL",
    description: "Endurance course. Extra length, sweeping curves.",
    trackLength: 360,
    obstacleStride: 7,
    ampRatio: 0.32,
    maxLanesOccupied: 2,
    trackColor: 0x0c0a20,
    railColor: 0xba7cff,
    accentColor: 0x2a1f5a,
    fogColor: 0x060614,
    fogNear: 70,
    fogFar: 340,
    curveAmplitude: 10,
    curveFrequency: 0.015,
    curvePhase: 0.9,
    curveAmplitude2: 4,
    curveFrequency2: 0.035,
    propStyle: "pillar",
    propColor: 0xba7cff,
    propStride: 18,
    propOffset: 3.2,
    archStride: 72,
    archColor: 0xba7cff,
  },
];

export const DEFAULT_TRACK_ID = TRACK_VARIANTS[0]?.id ?? "broadcast";

export function getTrackVariant(id: string | null | undefined): TrackVariant {
  const found = TRACK_VARIANTS.find((v) => v.id === id);
  if (found) return found;
  const first = TRACK_VARIANTS[0];
  if (!first) throw new Error("TRACK_VARIANTS must not be empty");
  return first;
}

/** Mario Kart-style descending point scale, indexed by finishing position (0 = 1st). */
export const CUP_POINTS: readonly number[] = [10, 7, 5, 3, 2, 1];

export function pointsForPlace(place: number): number {
  return CUP_POINTS[place] ?? 0;
}

export const PLAYER_COLOR_CSS: readonly string[] = [
  "#79f3ff",
  "#ff7ccf",
  "#ffd66b",
  "#8dff9d",
  "#ba7cff",
  "#ff9e6b",
];

export const PLAYER_COLOR_HEX: readonly number[] = [
  0x79f3ff, 0xff7ccf, 0xffd66b, 0x8dff9d, 0xba7cff, 0xff9e6b,
];

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
  trackId: string;
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

export interface CupStanding {
  slot: number;
  name: string;
  color: string;
  points: number;
  lastPlace: number;
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

/** Centerline X displacement of the track at a given z, sampled from the variant's curve. */
export function centerlineX(z: number, v: TrackVariant): number {
  return (
    v.curveAmplitude * Math.sin(z * v.curveFrequency + v.curvePhase) +
    v.curveAmplitude2 * Math.sin(z * v.curveFrequency2 + v.curvePhase * 1.7)
  );
}

/** Slope dx/dz of the centerline at z. */
export function centerlineSlope(z: number, v: TrackVariant): number {
  return (
    v.curveAmplitude * v.curveFrequency * Math.cos(z * v.curveFrequency + v.curvePhase) +
    v.curveAmplitude2 * v.curveFrequency2 * Math.cos(z * v.curveFrequency2 + v.curvePhase * 1.7)
  );
}

export interface WorldTrackPos {
  x: number;
  z: number;
  angleY: number;
}

/**
 * Convert a logical track position (z along track, laneX offset from centerline)
 * to world-space XZ, plus the rotation around Y that aligns with the track tangent.
 */
export function worldPosForLane(z: number, laneX: number, v: TrackVariant): WorldTrackPos {
  const cx = centerlineX(z, v);
  const slope = centerlineSlope(z, v);
  const invLen = 1 / Math.sqrt(1 + slope * slope);
  const normalX = invLen;
  const normalZ = -slope * invLen;
  return {
    x: cx + laneX * normalX,
    z: z + laneX * normalZ,
    angleY: Math.atan(slope),
  };
}
