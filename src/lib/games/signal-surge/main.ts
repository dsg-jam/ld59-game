import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { createGameLoop } from "$lib/game-loop";
import type { GameLoop } from "$lib/game-loop";
import { describePeerError, makeCode } from "$lib/peer";
import { gs, pushLog, resetState } from "./gameState.svelte.js";
import type {
  GameSnapshot,
  Obstacle,
  ObstacleKind,
  PlayerSnap,
  LobbyPlayer,
  FinishEntry,
  TrackVariant,
  CupStanding,
} from "./types.js";
import {
  PEER_PREFIX,
  MAX_PLAYERS,
  MIN_PLAYERS,
  LANE_COUNT,
  BASE_SPEED,
  NOISE_SLOW,
  NOISE_DURATION,
  AMP_BOOST_SPEED,
  AMP_DURATION,
  BURST_SPEED,
  BURST_DURATION,
  BURST_CHARGES,
  NETWORK_TICK_RATE,
  ROOM_CODE_LENGTH,
  COUNTDOWN_SECONDS,
  OBSTACLE_START_Z,
  FINISH_GRACE_SECONDS,
  NAME_MAX,
  PLAYER_COLOR_CSS,
  TRACK_VARIANTS,
  clampLane,
  getTrackVariant,
  pointsForPlace,
} from "./types.js";

interface IntentMsg {
  t: "intent";
  lane?: number;
  burst?: boolean;
}
interface HelloJoinMsg {
  t: "helloJoin";
  name: string;
}
type HostMsg = IntentMsg | HelloJoinMsg;

interface HelloBackMsg {
  t: "hello";
  slot: number;
}
interface StartMsg {
  t: "start";
}
interface StateMsg {
  t: "state";
  s: GameSnapshot;
}
interface RaceEndMsg {
  t: "raceEnd";
  winnerSlot: number;
  order: number[];
  standings: CupStanding[];
  trackIndex: number;
  totalTracks: number;
  nextTrackName: string;
  cupComplete: boolean;
}
interface CupEndMsg {
  t: "cupEnd";
  standings: CupStanding[];
}
interface RejectMsg {
  t: "reject";
  reason?: string;
}
type GuestMsg = HelloBackMsg | StartMsg | StateMsg | RaceEndMsg | CupEndMsg | RejectMsg;

function isHostMsg(value: unknown): value is HostMsg {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value) || typeof value.t !== "string") return false;
  if (value.t === "intent") return true;
  if (value.t === "helloJoin") return "name" in value && typeof value["name"] === "string";
  return false;
}

function isGuestMsg(value: unknown): value is GuestMsg {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value) || typeof value.t !== "string") return false;
  return ["hello", "start", "state", "raceEnd", "cupEnd", "reject"].includes(value.t);
}

interface HostPlayer {
  slot: number;
  id: string;
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
  consumed: Set<number>;
}

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildObstacles(seed: number, variant: TrackVariant): Obstacle[] {
  const rng = createRng(seed);
  const obstacles: Obstacle[] = [];
  let id = 0;
  const maxOccupancy = Math.min(LANE_COUNT - 1, variant.maxLanesOccupied);
  for (let z = OBSTACLE_START_Z; z < variant.trackLength - 8; z += variant.obstacleStride) {
    const occupancy = 1 + Math.floor(rng() * maxOccupancy);
    const lanes = new Set<number>();
    while (lanes.size < occupancy) {
      lanes.add(Math.floor(rng() * LANE_COUNT));
    }
    for (const lane of lanes) {
      const kind: ObstacleKind = rng() < variant.ampRatio ? "amp" : "noise";
      obstacles.push({ id: id++, kind, lane, z: z + (rng() - 0.5) * 1.4 });
    }
  }
  return obstacles;
}

let peer: Peer | null = null;
const conns = new Map<string, DataConnection>();
let hostConn: DataConnection | null = null;
let isHost = false;
let myId: string | null = null;
let myName = "OPERATOR";

const hostPlayers = new Map<string, HostPlayer>();
let hostTime = 0;
let hostCountdown = COUNTDOWN_SECONDS;
let hostRunning = false;
let hostFinished = false;
let hostWinnerSlot: number | null = null;
let hostFinishOrder: number[] = [];
let hostGraceTimer = 0;
let hostObstacles: Obstacle[] = [];
let hostTrackVariant: TrackVariant = getTrackVariant(null);
const hostCupStandings = new Map<number, CupStanding>();
let hostCupOrder: TrackVariant[] = [];
let hostCupTrackIndex = 0;

let gameLoop: GameLoop | null = null;
let netTimer = 0;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let initialized = false;

function broadcast(msg: GuestMsg): void {
  for (const c of conns.values()) if (c.open) c.send(msg);
}

function sendToHost(msg: HostMsg): void {
  if (isHost) {
    handleHostMessage(msg, myId ?? "host");
    return;
  }
  if (hostConn && hostConn.open) hostConn.send(msg);
}

function colorForSlot(slot: number): string {
  return PLAYER_COLOR_CSS[slot] ?? "#ffffff";
}

function lobbyPlayersList(): LobbyPlayer[] {
  return [...hostPlayers.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({ slot: p.slot, name: p.name, color: p.color, isYou: p.id === myId }));
}

function buildSnapshot(): GameSnapshot {
  const players: PlayerSnap[] = [...hostPlayers.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({
      slot: p.slot,
      name: p.name,
      color: p.color,
      z: p.z,
      lane: p.lane,
      targetLane: p.targetLane,
      slowUntil: p.slowUntil,
      boostUntil: p.boostUntil,
      burstUntil: p.burstUntil,
      burstsLeft: p.burstsLeft,
      finished: p.finished,
      finishTime: p.finishTime,
    }));
  return {
    t: hostTime,
    running: hostRunning,
    finished: hostFinished,
    countdown: hostCountdown,
    players,
    obstacles: hostObstacles,
    trackLength: hostTrackVariant.trackLength,
    laneCount: LANE_COUNT,
    trackId: hostTrackVariant.id,
    winnerSlot: hostWinnerSlot,
    order: hostFinishOrder,
  };
}

function publishSnapshot(s: GameSnapshot): void {
  gs.snapshot = s;
  gs.activeTrackId = s.trackId;
  if (s.countdown > 0 && s.running) {
    gs.countdownLabel = Math.ceil(s.countdown).toString();
  } else if (s.running && !s.finished) {
    gs.countdownLabel = "";
  }
  const me = s.players.find((p) => p.slot === gs.mySlot);
  if (me) {
    gs.hudProgress = ((me.z / s.trackLength) * 100).toFixed(1);
    gs.hudBursts = me.burstsLeft;
    const sorted = [...s.players].sort((a, b) => b.z - a.z);
    const place = sorted.findIndex((p) => p.slot === gs.mySlot) + 1;
    gs.hudPlace = String(place);
    gs.hudTotal = s.players.length;
  }
}

function sendState(): void {
  const s = buildSnapshot();
  publishSnapshot(s);
  broadcast({ t: "state", s });
}

function assignSlot(): number {
  const used = new Set<number>();
  for (const p of hostPlayers.values()) used.add(p.slot);
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function speedFor(p: HostPlayer): number {
  if (hostTime < p.burstUntil) return BURST_SPEED;
  if (hostTime < p.boostUntil) return AMP_BOOST_SPEED;
  let speed = BASE_SPEED;
  if (hostTime < p.slowUntil) speed *= NOISE_SLOW;
  return speed;
}

function hostTick(dt: number): void {
  hostTime += dt;
  if (!hostRunning) return;
  if (hostCountdown > 0) {
    hostCountdown = Math.max(0, hostCountdown - dt);
    return;
  }

  for (const p of hostPlayers.values()) {
    if (p.finished) continue;
    if (p.lane !== p.targetLane) p.lane = clampLane(p.lane + Math.sign(p.targetLane - p.lane));
    const prevZ = p.z;
    p.z = Math.min(hostTrackVariant.trackLength, p.z + speedFor(p) * dt);

    for (const obs of hostObstacles) {
      if (p.consumed.has(obs.id)) continue;
      if (obs.lane !== p.lane) continue;
      if (obs.z < prevZ - 0.4 || obs.z > p.z + 0.4) continue;
      p.consumed.add(obs.id);
      if (obs.kind === "amp") {
        p.boostUntil = Math.max(p.boostUntil, hostTime + AMP_DURATION);
      } else {
        p.slowUntil = Math.max(p.slowUntil, hostTime + NOISE_DURATION);
      }
    }

    if (!p.finished && p.z >= hostTrackVariant.trackLength) {
      p.finished = true;
      p.finishTime = hostTime;
      hostFinishOrder.push(p.slot);
      if (hostWinnerSlot === null) {
        hostWinnerSlot = p.slot;
        hostGraceTimer = FINISH_GRACE_SECONDS;
        pushLog(`${p.name} crossed the carrier threshold.`, "good");
      } else {
        pushLog(`${p.name} received.`, "good");
      }
    }
  }

  if (hostWinnerSlot !== null) {
    hostGraceTimer -= dt;
    const unfinished = [...hostPlayers.values()].some((p) => !p.finished);
    if (hostGraceTimer <= 0 || !unfinished) endRound();
  }
}

function standingsArray(): CupStanding[] {
  return [...hostCupStandings.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.lastPlace - b.lastPlace;
  });
}

function applyStandingsToLocalUI(
  standings: CupStanding[],
  order: FinishEntry[],
  winnerName: string,
  cupComplete: boolean,
  trackIndex: number,
  totalTracks: number,
  nextTrackName: string
): void {
  gs.winnerName = winnerName;
  gs.finishOrder = order;
  gs.cupStandings = standings;
  gs.cupTrackIndex = trackIndex;
  gs.cupTotalTracks = totalTracks;
  gs.nextTrackName = nextTrackName;
  gs.cupComplete = cupComplete;
  gs.canAdvanceTrack = !cupComplete;
  gs.phase = cupComplete ? "cupEnd" : "raceEnd";
}

function finishDetailsFromHost(order: number[]): FinishEntry[] {
  const bySlot = new Map([...hostPlayers.values()].map((p) => [p.slot, p]));
  return order
    .map((s) => bySlot.get(s))
    .filter((p): p is HostPlayer => !!p)
    .map((p) => ({ slot: p.slot, name: p.name, color: p.color }));
}

function finishDetailsFromSnapshot(order: number[]): FinishEntry[] {
  const players = gs.snapshot?.players ?? [];
  const bySlot = new Map(players.map((p) => [p.slot, p]));
  return order
    .map((s) => bySlot.get(s))
    .filter((p): p is PlayerSnap => !!p)
    .map((p) => ({ slot: p.slot, name: p.name, color: p.color }));
}

function endRound(): void {
  if (hostFinished) return;
  hostRunning = false;
  hostFinished = true;
  const remaining = [...hostPlayers.values()].filter((p) => !p.finished).sort((a, b) => b.z - a.z);
  for (const p of remaining) hostFinishOrder.push(p.slot);
  sendState();
  if (hostWinnerSlot === null) return;

  // Award points Mario Kart style.
  hostFinishOrder.forEach((slot, idx) => {
    const entry = hostCupStandings.get(slot);
    if (!entry) return;
    entry.points += pointsForPlace(idx);
    entry.lastPlace = idx + 1;
  });

  const standings = standingsArray();
  hostCupTrackIndex += 1;
  const cupComplete = hostCupTrackIndex >= hostCupOrder.length;
  const nextVariant = cupComplete ? null : (hostCupOrder[hostCupTrackIndex] ?? null);
  const nextTrackName = nextVariant?.name ?? "";
  const details = finishDetailsFromHost(hostFinishOrder);
  const winner = [...hostPlayers.values()].find((p) => p.slot === hostWinnerSlot);

  broadcast({
    t: "raceEnd",
    winnerSlot: hostWinnerSlot,
    order: hostFinishOrder,
    standings,
    trackIndex: hostCupTrackIndex,
    totalTracks: hostCupOrder.length,
    nextTrackName,
    cupComplete,
  });
  if (cupComplete) broadcast({ t: "cupEnd", standings });

  applyStandingsToLocalUI(
    standings,
    details,
    winner?.name ?? "",
    cupComplete,
    hostCupTrackIndex,
    hostCupOrder.length,
    nextTrackName
  );
}

function prepareCup(): void {
  hostCupOrder = [...TRACK_VARIANTS];
  hostCupTrackIndex = 0;
  hostCupStandings.clear();
  for (const p of hostPlayers.values()) {
    hostCupStandings.set(p.slot, {
      slot: p.slot,
      name: p.name,
      color: p.color,
      points: 0,
      lastPlace: 0,
    });
  }
}

function resetRoundState(variant: TrackVariant): void {
  hostTrackVariant = variant;
  gs.activeTrackId = hostTrackVariant.id;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  hostObstacles = buildObstacles(seed, hostTrackVariant);
  hostTime = 0;
  hostCountdown = COUNTDOWN_SECONDS;
  hostRunning = true;
  hostFinished = false;
  hostWinnerSlot = null;
  hostFinishOrder = [];
  hostGraceTimer = 0;

  const slots = [...hostPlayers.values()].sort((a, b) => a.slot - b.slot);
  const startLane = Math.floor((LANE_COUNT - 1) / 2);
  slots.forEach((p, idx) => {
    const offset = Math.ceil(idx / 2) * (idx % 2 === 0 ? -1 : 1);
    const lane = clampLane(startLane + offset);
    p.z = 0;
    p.lane = lane;
    p.targetLane = lane;
    p.slowUntil = 0;
    p.boostUntil = 0;
    p.burstUntil = 0;
    p.burstsLeft = BURST_CHARGES;
    p.finished = false;
    p.finishTime = null;
    p.consumed = new Set();
  });
}

function beginRound(): void {
  if (!isHost) return;
  if (hostPlayers.size < MIN_PLAYERS || hostPlayers.size > MAX_PLAYERS) return;
  const variant = hostCupOrder[hostCupTrackIndex];
  if (!variant) return;
  resetRoundState(variant);
  gs.cupTrackIndex = hostCupTrackIndex;
  gs.cupTotalTracks = hostCupOrder.length;
  sendState();
  broadcast({ t: "start" });
  gs.phase = "game";
  pushLog(`Track ${hostCupTrackIndex + 1}/${hostCupOrder.length}: ${variant.name}.`);
}

function startCup(): void {
  if (!isHost) return;
  if (hostPlayers.size < MIN_PLAYERS || hostPlayers.size > MAX_PLAYERS) return;
  prepareCup();
  gs.cupStandings = standingsArray();
  gs.cupTotalTracks = hostCupOrder.length;
  gs.cupTrackIndex = 0;
  gs.cupComplete = false;
  beginRound();
}

function advanceToNextRound(): void {
  if (!isHost) return;
  if (hostCupTrackIndex >= hostCupOrder.length) return;
  beginRound();
}

function handleHostMessage(msg: HostMsg, fromId: string): void {
  if (msg.t === "helloJoin") {
    const c = conns.get(fromId);
    const cupStarted = hostCupOrder.length > 0;
    if (cupStarted || hostRunning) {
      if (c && c.open) c.send({ t: "reject", reason: "Cup already in progress." });
      return;
    }
    if (hostPlayers.size >= MAX_PLAYERS) {
      if (c && c.open) c.send({ t: "reject", reason: "Channel is full." });
      return;
    }
    const slot = assignSlot();
    if (slot < 0) return;
    const name = (msg.name || "OPERATOR").slice(0, NAME_MAX).toUpperCase();
    hostPlayers.set(fromId, {
      slot,
      id: fromId,
      name,
      color: colorForSlot(slot),
      z: 0,
      lane: Math.floor(LANE_COUNT / 2),
      targetLane: Math.floor(LANE_COUNT / 2),
      slowUntil: 0,
      boostUntil: 0,
      burstUntil: 0,
      burstsLeft: BURST_CHARGES,
      finished: false,
      finishTime: null,
      consumed: new Set(),
    });
    if (c && c.open) c.send({ t: "hello", slot });
    gs.lobbyPlayers = lobbyPlayersList();
    gs.startEnabled = hostPlayers.size >= MIN_PLAYERS;
    pushLog(`${name} tuned in.`, "good");
    return;
  }
  if (msg.t === "intent") {
    const p = hostPlayers.get(fromId);
    if (!p) return;
    if (typeof msg.lane === "number") p.targetLane = clampLane(Math.round(msg.lane));
    if (msg.burst && p.burstsLeft > 0 && hostTime >= p.burstUntil) {
      p.burstsLeft -= 1;
      p.burstUntil = hostTime + BURST_DURATION;
    }
  }
}

function handleGuestMessage(msg: GuestMsg): void {
  if (msg.t === "hello") {
    gs.mySlot = msg.slot;
    gs.slotLabel = "P" + (msg.slot + 1);
    gs.lobbyStatus = "Linked as packet " + (msg.slot + 1) + ".";
  } else if (msg.t === "start") {
    gs.phase = "game";
    pushLog("Host launched the track.");
  } else if (msg.t === "state") {
    publishSnapshot(msg.s);
  } else if (msg.t === "raceEnd") {
    const details = finishDetailsFromSnapshot(msg.order);
    const winner = msg.standings.find((s) => s.slot === msg.winnerSlot);
    applyStandingsToLocalUI(
      msg.standings,
      details,
      winner?.name ?? "",
      msg.cupComplete,
      msg.trackIndex,
      msg.totalTracks,
      msg.nextTrackName
    );
  } else if (msg.t === "cupEnd") {
    gs.cupStandings = msg.standings;
    gs.cupComplete = true;
    gs.canAdvanceTrack = false;
    gs.phase = "cupEnd";
  } else if (msg.t === "reject") {
    gs.lobbyStatus = msg.reason ?? "Unable to join channel.";
  }
}

function addConn(conn: DataConnection): void {
  conns.set(conn.peer, conn);
  conn.on("data", (d: unknown) => {
    if (isHostMsg(d)) {
      handleHostMessage(d, conn.peer);
    }
  });
  conn.on("close", () => {
    conns.delete(conn.peer);
    if (isHost && hostPlayers.delete(conn.peer)) {
      gs.lobbyPlayers = lobbyPlayersList();
      gs.startEnabled = hostPlayers.size >= MIN_PLAYERS;
      pushLog("Peer dropped the channel.", "bad");
    }
  });
}

function resetNet(): void {
  if (peer) {
    try {
      peer.destroy();
    } catch {
      // swallow cleanup error
    }
  }
  peer = null;
  hostConn = null;
  conns.clear();
  hostPlayers.clear();
  isHost = false;
  myId = null;
  hostObstacles = [];
  hostTrackVariant = getTrackVariant(null);
  hostCupStandings.clear();
  hostCupOrder = [];
  hostCupTrackIndex = 0;
  hostTime = 0;
  hostCountdown = COUNTDOWN_SECONDS;
  hostRunning = false;
  hostFinished = false;
  hostWinnerSlot = null;
  hostFinishOrder = [];
  hostGraceTimer = 0;
  netTimer = 0;
}

export function hostGame(name: string): void {
  if (typeof Peer === "undefined") {
    gs.lobbyStatus = "PeerJS failed to load.";
    return;
  }
  resetNet();
  isHost = true;
  myName = (name || "OPERATOR").slice(0, NAME_MAX).toUpperCase();
  const roomCode = makeCode(ROOM_CODE_LENGTH);
  const fullHostId = PEER_PREFIX + roomCode;
  gs.roomCode = roomCode;
  gs.roomWrapVisible = true;
  gs.startEnabled = false;
  gs.lobbyStatus = "Opening broadcast channel...";

  peer = new Peer(fullHostId);
  peer.on("open", (id) => {
    myId = id;
    const slot = 0;
    gs.mySlot = slot;
    hostPlayers.set(id, {
      slot,
      id,
      name: myName,
      color: colorForSlot(slot),
      z: 0,
      lane: Math.floor(LANE_COUNT / 2),
      targetLane: Math.floor(LANE_COUNT / 2),
      slowUntil: 0,
      boostUntil: 0,
      burstUntil: 0,
      burstsLeft: BURST_CHARGES,
      finished: false,
      finishTime: null,
      consumed: new Set(),
    });
    gs.slotLabel = "P1";
    gs.pendingLane = Math.floor(LANE_COUNT / 2);
    gs.lobbyPlayers = lobbyPlayersList();
    gs.lobbyStatus = "Channel open. Awaiting operators.";
  });
  peer.on("connection", (conn) => addConn(conn));
  peer.on("error", (e) => {
    gs.lobbyStatus = "Host peer error: " + describePeerError(e);
  });
}

export function joinGame(code: string, name: string): void {
  if (typeof Peer === "undefined") {
    gs.lobbyStatus = "PeerJS failed to load.";
    return;
  }
  if (!code) {
    gs.lobbyStatus = "Enter room code.";
    return;
  }
  resetNet();
  myName = (name || "OPERATOR").slice(0, NAME_MAX).toUpperCase();
  gs.lobbyStatus = "Tuning into " + code + "...";
  peer = new Peer();
  peer.on("open", () => {
    const p = peer;
    if (!p) return;
    const c = p.connect(PEER_PREFIX + code, { reliable: true });
    hostConn = c;
    c.on("open", () => {
      c.send({ t: "helloJoin", name: myName });
      gs.lobbyStatus = "Connected. Awaiting host start.";
    });
    c.on("data", (d: unknown) => {
      if (isGuestMsg(d)) {
        handleGuestMessage(d);
      }
    });
    c.on("close", () => {
      gs.lobbyStatus = "Disconnected from host.";
    });
  });
  peer.on("error", (e) => {
    gs.lobbyStatus = "Join peer error: " + describePeerError(e);
  });
}

export function startGame(): void {
  startCup();
}

export function nextTrack(): void {
  advanceToNextRound();
}

function setLane(lane: number): void {
  gs.pendingLane = clampLane(lane);
  sendToHost({ t: "intent", lane: gs.pendingLane });
}

function triggerBurst(): void {
  sendToHost({ t: "intent", burst: true });
}

function handleKeyDown(e: KeyboardEvent): void {
  if (!gs.snapshot?.running) return;
  if (e.code === "ArrowLeft" || e.code === "KeyA") {
    e.preventDefault();
    setLane(gs.pendingLane - 1);
  } else if (e.code === "ArrowRight" || e.code === "KeyD") {
    e.preventDefault();
    setLane(gs.pendingLane + 1);
  } else if (e.code === "Space") {
    e.preventDefault();
    triggerBurst();
  }
}

export function init(): void {
  if (initialized) return;
  initialized = true;
  resetState();
  keydownHandler = handleKeyDown;
  window.addEventListener("keydown", keydownHandler);
  gameLoop = createGameLoop((dt) => {
    if (isHost) {
      hostTick(dt);
      netTimer += dt;
      if (netTimer > NETWORK_TICK_RATE) {
        sendState();
        netTimer = 0;
      }
    }
  });
  gameLoop.start();
}

export function destroy(): void {
  if (!initialized) return;
  initialized = false;
  gameLoop?.stop();
  gameLoop = null;
  if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
  keydownHandler = null;
  resetNet();
  resetState();
}
