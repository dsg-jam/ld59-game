import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { createGameLoop } from "$lib/game-loop";
import { describePeerError, makeCode } from "$lib/peer";

// ── Tuning ─────────────────────────────────────────────────────────────────────

const PEER_PREFIX = "sigweave-";
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const ROOM_CODE_LENGTH = 5;

const NETWORK_TICK_RATE = 0.05;
const ROUND_DURATION = 90;

export const OFFSET_MIN = 0;
export const OFFSET_MAX = 628; // 0..2π * 100, scaled for the integer slider
const OFFSET_SCALE = 100;
const ARROW_KEY_STEP = 6;

const PULSE_SYNC_WINDOW_SECONDS = 0.85;
const COMBO_TIMEOUT_SECONDS = 4;
const HARMONY_THRESHOLD = 0.18;
const HARMONY_GAIN_RATE = 12;
const PULSE_X_MIN = 0.2;
const PULSE_X_SPAN = 0.6;

// Each operator slot owns one sine component of the combined signal.
// Frequencies are picked to interleave nicely; colors match the lobby roster.
interface SineComponent {
  freq: number;
  color: string;
  label: string;
}
const FALLBACK_COMPONENT: SineComponent = { freq: 2.0, color: "#79f3ff", label: "TURQ" };
const COMPONENTS: ReadonlyArray<SineComponent> = [
  FALLBACK_COMPONENT,
  { freq: 2.7, color: "#ff7ccf", label: "ROSE" },
  { freq: 3.4, color: "#8dff9d", label: "MINT" },
  { freq: 1.6, color: "#ffb36b", label: "AMBR" },
  { freq: 4.1, color: "#a06bff", label: "VIOL" },
  { freq: 2.3, color: "#ffdd00", label: "SOLA" },
];

function componentFor(slot: number): SineComponent {
  return COMPONENTS[slot] ?? FALLBACK_COMPONENT;
}

// Target evolves through three "movements" so the round doesn't feel static.
type TargetMode = "drift" | "double" | "tempest";
const MODE_PALETTE: Record<TargetMode, string> = {
  drift: "#ff7ccf",
  double: "#ff5acd",
  tempest: "#ff3aa1",
};
const MODE_LABEL: Record<TargetMode, string> = {
  drift: "MOV. I — DRIFT",
  double: "MOV. II — DOUBLE",
  tempest: "MOV. III — TEMPEST",
};

function modeAt(t: number): TargetMode {
  const phase = Math.floor(t / 25) % 3;
  return phase === 0 ? "drift" : phase === 1 ? "double" : "tempest";
}

function targetValue(t: number): number {
  const mode = modeAt(t);
  if (mode === "drift") {
    return Math.sin(t * 1.5 + Math.sin(t * 0.4) * 1.2);
  }
  if (mode === "double") {
    // Two-frequency target with a slow sweep
    return (Math.sin(t * 1.8) + Math.sin(t * 1.05 + 0.6)) * 0.5;
  }
  // tempest: faster, modulated
  return Math.sin(t * 2.4 + Math.sin(t * 0.9) * 1.6) * 0.85 + Math.sin(t * 0.6) * 0.15;
}

// ── Wire types ────────────────────────────────────────────────────────────────

export type Pulse = { owner: number; t: number; good: boolean };
export type GameSnapshot = {
  t: number;
  timeLeft: number;
  harmony: number;
  combo: number;
  offsets: number[];
  pulses: Pulse[];
  running: boolean;
  players: number;
  mode: TargetMode;
};

type HostMsg = { t: "offset"; v: number } | { t: "ping" };
type GuestMsg =
  | { t: "hello"; slot: number; players: number }
  | { t: "roster"; players: number }
  | { t: "start" }
  | { t: "state"; s: GameSnapshot }
  | { t: "burst"; good: boolean; tier: BurstTier; sync: number }
  | { t: "end"; harmony: string; topMessage: string }
  | { t: "reject"; reason?: string };

type BurstTier = "spark" | "team" | "constellation";

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((x) => typeof x === "number");
}

function isPulseArray(value: unknown): value is Pulse[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      "owner" in p &&
      "t" in p &&
      "good" in p &&
      typeof p.owner === "number" &&
      typeof p.t === "number" &&
      typeof p.good === "boolean"
  );
}

function isHostMsg(value: unknown): value is HostMsg {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value) || typeof value.t !== "string") return false;
  if (value.t === "ping") return true;
  if (value.t === "offset") return "v" in value && typeof value["v"] === "number";
  return false;
}

function isGuestMsg(value: unknown): value is GuestMsg {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value) || typeof value.t !== "string") return false;
  return ["hello", "roster", "start", "state", "burst", "end", "reject"].includes(value.t);
}

// ── Public surface ────────────────────────────────────────────────────────────

export interface PlayerInfo {
  slot: number;
  color: string;
  label: string;
  isYou: boolean;
}

/** Callbacks the page provides so the engine can drive UI reactively. */
export interface SignalWeaveCallbacks {
  onLobbyStatus(text: string): void;
  onRoomCode(code: string): void;
  onRoomWrapVisible(visible: boolean): void;
  onStartEnabled(enabled: boolean): void;
  onGameStart(): void;
  onSlot(label: string): void;
  onRoster(players: PlayerInfo[]): void;
  onHud(timeLeft: number, harmony: number, combo: number): void;
  onMode(label: string, color: string): void;
  onLog(text: string, kind: string): void;
  onNetStatus(text: string): void;
  onOffset(rawValue: number, label: string): void;
  onFlash(kind: string): void;
  onMilestone(text: string): void;
}

/** Imperative controls returned to the page after mounting. */
export interface SignalWeaveControls {
  hostGame(): void;
  joinGame(code: string): void;
  startGame(): void;
  setOffset(rawValue: number): void;
  pulse(): void;
  destroy(): void;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mount(
  canvas: HTMLCanvasElement,
  callbacks: SignalWeaveCallbacks
): SignalWeaveControls {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) throw new Error("Canvas 2D context unavailable");
  const ctx = rawCtx;

  // ── Network state ──────────────────────────────────────────────────────────
  let peer: Peer | null = null;
  let conn: DataConnection | null = null; // guest's connection to host
  let conns: (DataConnection | null)[] = [null]; // host's connections, indexed by slot (slot 0 = host self)
  let isHost = false;
  let mySlot = -1;
  let roomCode = "";

  // ── Game state ─────────────────────────────────────────────────────────────
  const state: {
    running: boolean;
    t: number;
    timeLeft: number;
    harmony: number;
    combo: number;
    offsets: number[];
    lastPing: number[];
    pulses: Pulse[];
    players: number;
    milestonesReached: Set<number>;
    bestCombo: number;
  } = {
    running: false,
    t: 0,
    timeLeft: ROUND_DURATION,
    harmony: 0,
    combo: 0,
    offsets: [0, Math.PI * 0.5, 0, 0, 0, 0],
    lastPing: [-99, -99, -99, -99, -99, -99],
    pulses: [],
    players: 1,
    milestonesReached: new Set(),
    bestCombo: 0,
  };
  let localSnapshot: GameSnapshot | null = null;
  let currentOffsetRaw = 0;
  let lastModeAnnounced: TargetMode | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function log(text: string, kind = "") {
    callbacks.onLog(text, kind);
    callbacks.onNetStatus(text);
  }

  function broadcast(data: unknown) {
    for (let i = 1; i < conns.length; i++) {
      const c = conns[i];
      if (c && c.open) c.send(data);
    }
  }

  function pushRoster() {
    const roster: PlayerInfo[] = [];
    for (let i = 0; i < state.players; i++) {
      const comp = componentFor(i);
      roster.push({ slot: i, color: comp.color, label: comp.label, isYou: i === mySlot });
    }
    callbacks.onRoster(roster);
  }

  function announceMilestone(text: string) {
    callbacks.onMilestone(text);
    log(text, "good");
  }

  // ── Math ───────────────────────────────────────────────────────────────────
  function signalValue(t: number, offsets: number[], players: number): number {
    let acc = 0;
    const n = Math.max(1, players);
    for (let i = 0; i < n; i++) {
      const comp = componentFor(i);
      acc += Math.sin(t * comp.freq + (offsets[i] ?? 0));
    }
    return acc / n;
  }

  // ── Host logic ─────────────────────────────────────────────────────────────
  function hostTick(dt: number) {
    if (!state.running) return;
    state.t += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    const comboFactor = 1 + Math.min(8, state.combo) * 0.18;
    const diff = Math.abs(
      signalValue(state.t, state.offsets, state.players) - targetValue(state.t)
    );

    if (diff < HARMONY_THRESHOLD) {
      state.harmony += dt * HARMONY_GAIN_RATE * comboFactor;
    } else {
      state.harmony = Math.max(0, state.harmony - dt * 5);
    }

    if (state.combo > 0) {
      const last = Math.max(...state.lastPing.slice(0, state.players));
      if (state.t - last > COMBO_TIMEOUT_SECONDS) state.combo = 0;
    }

    // Milestones (first time crossed only)
    for (const mile of [50, 100, 200, 350, 500, 750]) {
      if (state.harmony >= mile && !state.milestonesReached.has(mile)) {
        state.milestonesReached.add(mile);
        announceMilestone(`HARMONY ${mile} REACHED`);
      }
    }
    if (state.combo >= 3 && state.combo > state.bestCombo) {
      state.bestCombo = state.combo;
      if (state.combo === 3 || state.combo === 5 || state.combo === 8 || state.combo === 12) {
        announceMilestone(`${state.combo}x CONSTELLATION`);
      }
    }

    state.pulses = state.pulses.filter((p) => state.t - p.t < 2.4);

    // Mode announcements when target movement changes
    const m = modeAt(state.t);
    if (m !== lastModeAnnounced) {
      lastModeAnnounced = m;
      callbacks.onMode(MODE_LABEL[m], MODE_PALETTE[m]);
      log(MODE_LABEL[m]);
    }

    if (state.timeLeft <= 0) {
      state.running = false;
      const top =
        state.bestCombo >= 8
          ? "Constellation forged."
          : state.bestCombo >= 5
            ? "Tight weave."
            : state.harmony > 200
              ? "Steady hands."
              : "Round complete.";
      broadcast({ t: "end", harmony: state.harmony.toFixed(1), topMessage: top });
      log(`Weave complete. Harmony ${state.harmony.toFixed(1)} • Best combo ${state.bestCombo}.`);
      announceMilestone(top);
    }
  }

  function hostSnapshot(): GameSnapshot {
    return {
      t: state.t,
      timeLeft: state.timeLeft,
      harmony: state.harmony,
      combo: state.combo,
      offsets: state.offsets.slice(),
      pulses: state.pulses,
      running: state.running,
      players: state.players,
      mode: modeAt(state.t),
    };
  }

  function sendState() {
    const data: GuestMsg = { t: "state", s: hostSnapshot() };
    localSnapshot = data.s;
    broadcast(data);
  }

  function syncedPlayerCount(now: number): number {
    let count = 0;
    for (let i = 0; i < state.players; i++) {
      const last = state.lastPing[i] ?? -99;
      if (now - last <= PULSE_SYNC_WINDOW_SECONDS) count += 1;
    }
    return count;
  }

  function onPing(slot: number) {
    if (!state.running) return;
    const now = state.t;
    state.lastPing[slot] = now;
    state.pulses.push({ owner: slot, t: now, good: false });

    const synced = syncedPlayerCount(now);
    if (synced < 2) {
      // Solo pulse — neutral
      return;
    }

    const tolerance = 0.18 + Math.max(0, state.players - 2) * 0.04;
    const aligned =
      Math.abs(signalValue(state.t, state.offsets, state.players) - targetValue(state.t)) <
      tolerance;

    if (aligned) {
      const allIn = synced === state.players;
      const tier: BurstTier = allIn ? "constellation" : synced >= 3 ? "team" : "spark";
      const baseGain = tier === "constellation" ? 28 : tier === "team" ? 18 : 12;
      const comboBonus = Math.min(state.combo, 8) * 2;
      state.combo += 1;
      state.harmony += baseGain + comboBonus;
      state.pulses.push({ owner: slot, t: now, good: true });
      broadcast({ t: "burst", good: true, tier, sync: synced });
      callbacks.onFlash(tier === "constellation" ? "perfect" : "good");
      const msg =
        tier === "constellation"
          ? `Full constellation (${synced}/${state.players}) — +${baseGain + comboBonus} harmony.`
          : tier === "team"
            ? `Team burst (${synced}/${state.players}) — +${baseGain + comboBonus}.`
            : `Pair pulse — +${baseGain + comboBonus}.`;
      log(msg, "good");
    } else {
      state.combo = 0;
      state.harmony = Math.max(0, state.harmony - 6);
      broadcast({ t: "burst", good: false, tier: "spark", sync: synced });
      callbacks.onFlash("bad");
      log(`Pulse out of phase (${synced} synced).`, "bad");
    }
  }

  function startRound() {
    state.running = true;
    state.t = 0;
    state.timeLeft = ROUND_DURATION;
    state.harmony = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.milestonesReached = new Set();
    state.pulses = [];
    state.lastPing = state.lastPing.map(() => -99);
    lastModeAnnounced = null;
    sendState();
    broadcast({ t: "start" });
    callbacks.onGameStart();
    log("Carrier locked. Weave active.");
  }

  function resetNet() {
    if (peer) {
      try {
        peer.destroy();
      } catch {
        console.warn("Failed to cleanly destroy peer connection.");
      }
    }
    peer = null;
    conn = null;
    conns = [null];
    isHost = false;
    mySlot = -1;
  }

  // ── Networking ─────────────────────────────────────────────────────────────
  function attachGuestConn(c: DataConnection, slot: number) {
    conns[slot] = c;
    c.on("open", () => {
      state.players = Math.max(state.players, slot + 1);
      c.send({ t: "hello", slot, players: state.players });
      // tell everyone the new roster size
      broadcast({ t: "roster", players: state.players });
      callbacks.onStartEnabled(state.players >= MIN_PLAYERS);
      callbacks.onLobbyStatus(
        state.players >= MAX_PLAYERS
          ? "All operator slots filled. Ready to begin."
          : `Operator ${slot + 1} connected. Ready to begin. (${state.players}/${MAX_PLAYERS})`
      );
      log(`Operator ${slot + 1} tuned in.`, "good");
      pushRoster();
    });
    c.on("data", (d: unknown) => {
      if (isHostMsg(d)) onHostMessage(d, slot);
    });
    c.on("close", () => {
      conns[slot] = null;
      // Recompute player count from active conns
      let highest = 0;
      for (let i = 1; i < conns.length; i++) {
        if (conns[i]?.open) highest = i;
      }
      state.players = highest + 1; // includes host slot 0
      callbacks.onStartEnabled(state.players >= MIN_PLAYERS && !state.running);
      broadcast({ t: "roster", players: state.players });
      callbacks.onLobbyStatus(`Operator ${slot + 1} disconnected.`);
      log(`Operator ${slot + 1} dropped.`, "bad");
      pushRoster();
    });
  }

  function nextFreeSlot(): number {
    for (let i = 1; i < MAX_PLAYERS; i++) {
      if (!conns[i] || !conns[i]?.open) return i;
    }
    return -1;
  }

  function hostGame() {
    if (typeof Peer === "undefined") return callbacks.onLobbyStatus("PeerJS failed to load.");
    resetNet();
    isHost = true;
    mySlot = 0;
    roomCode = makeCode(ROOM_CODE_LENGTH);
    state.players = 1;
    callbacks.onSlot("P1");
    callbacks.onRoomCode(roomCode);
    callbacks.onRoomWrapVisible(true);
    callbacks.onStartEnabled(false);
    callbacks.onLobbyStatus("Opening channel...");
    pushRoster();

    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on("open", () =>
      callbacks.onLobbyStatus(
        `Channel open. Waiting for operators. (1/${MAX_PLAYERS}, min ${MIN_PLAYERS})`
      )
    );
    peer.on("connection", (c) => {
      const slot = nextFreeSlot();
      if (slot < 0 || state.running) {
        c.on("open", () => {
          c.send({
            t: "reject",
            reason: state.running ? "Round already in progress." : "Room is full.",
          });
          c.close();
        });
        return;
      }
      // Make sure the conns array is big enough
      while (conns.length <= slot) conns.push(null);
      attachGuestConn(c, slot);
    });
    peer.on("error", (e) => callbacks.onLobbyStatus("Host peer error: " + describePeerError(e)));
  }

  function joinGame(code: string) {
    if (typeof Peer === "undefined") return callbacks.onLobbyStatus("PeerJS failed to load.");
    if (!code) return callbacks.onLobbyStatus("Enter room code.");
    resetNet();
    callbacks.onLobbyStatus("Tuning into " + code + "...");
    peer = new Peer();
    peer.on("open", () => {
      const p = peer;
      if (!p) throw new Error("No peer");
      conn = p.connect(PEER_PREFIX + code, { reliable: true });
      conn.on("open", () => callbacks.onLobbyStatus("Connected. Awaiting host start."));
      conn.on("data", (d: unknown) => {
        if (isGuestMsg(d)) onGuestMessage(d);
      });
      conn.on("close", () => callbacks.onLobbyStatus("Disconnected from host."));
    });
    peer.on("error", (e) => callbacks.onLobbyStatus("Join peer error: " + describePeerError(e)));
  }

  function onHostMessage(d: HostMsg, slot: number) {
    if (d.t === "offset") {
      state.offsets[slot] = d.v;
    } else if (d.t === "ping") {
      onPing(slot);
    }
  }

  function onGuestMessage(d: GuestMsg) {
    if (d.t === "hello") {
      mySlot = d.slot;
      state.players = d.players;
      callbacks.onSlot("P" + (mySlot + 1));
      callbacks.onLobbyStatus("Linked as operator " + (mySlot + 1) + ".");
      pushRoster();
    } else if (d.t === "roster") {
      state.players = d.players;
      pushRoster();
    } else if (d.t === "start") {
      callbacks.onGameStart();
      log("Host started the weave.");
    } else if (d.t === "state") {
      localSnapshot = d.s;
      // mirror what the host knows so we draw consistently
      state.players = d.s.players;
      callbacks.onMode(MODE_LABEL[d.s.mode], MODE_PALETTE[d.s.mode]);
    } else if (d.t === "burst") {
      callbacks.onFlash(d.good ? (d.tier === "constellation" ? "perfect" : "good") : "bad");
      log(
        d.good ? `Burst (${d.sync} synced).` : `Pulse out of phase (${d.sync} synced).`,
        d.good ? "good" : "bad"
      );
    } else if (d.t === "end") {
      log(`Weave complete. Harmony ${d.harmony}.`, "good");
      callbacks.onMilestone(d.topMessage);
    } else if (d.t === "reject") {
      callbacks.onLobbyStatus(d.reason ?? "Unable to join room.");
    }
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  function setOffset(rawValue: number) {
    currentOffsetRaw = rawValue;
    const v = rawValue / OFFSET_SCALE;
    callbacks.onOffset(rawValue, v.toFixed(2) + " rad");
    if (mySlot < 0 && isHost) mySlot = 0;
    if (isHost) {
      state.offsets[0] = v;
    } else if (conn && conn.open) {
      conn.send({ t: "offset", v });
    }
  }

  function doPulse() {
    if (isHost) onPing(0);
    else if (conn && conn.open) conn.send({ t: "ping" });
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (e.code === "Space") {
      e.preventDefault();
      doPulse();
    } else if (e.code === "ArrowLeft") {
      setOffset(Math.max(OFFSET_MIN, currentOffsetRaw - ARROW_KEY_STEP));
    } else if (e.code === "ArrowRight") {
      setOffset(Math.min(OFFSET_MAX, currentOffsetRaw + ARROW_KEY_STEP));
    }
  }
  window.addEventListener("keydown", handleKeyDown);

  // ── Game loop + draw ───────────────────────────────────────────────────────
  let netTimer = 0;
  const gameLoop = createGameLoop((dt) => {
    if (isHost) {
      hostTick(dt);
      netTimer += dt;
      if (netTimer > NETWORK_TICK_RATE) {
        sendState();
        netTimer = 0;
      }
    }
    draw(localSnapshot ?? hostSnapshot());
  });

  function draw(snapshot: GameSnapshot) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    const midY = h * 0.5;
    const left = 30;
    const right = w - 30;
    const span = right - left;
    const amp = h * 0.22;
    const s = snapshot;
    const now = s.t || 0;
    const playerCount = Math.max(1, s.players ?? 1);

    // grid
    ctx.strokeStyle = "#1f2d56";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const y = midY - amp + (amp * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    function drawWave(fn: (t: number) => number, color: string, width = 2, alpha = 1) {
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const x = left + span * (i / 240);
        const t = now - 3 + (i / 240) * 6;
        const y = midY - fn(t) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const offs = s.offsets;

    // target wave (mode-tinted)
    drawWave((t) => targetValue(t), MODE_PALETTE[s.mode] ?? "#ff7ccf", 2.6, 0.95);

    // each player's contribution at low alpha (so you can see your slice)
    for (let i = 0; i < playerCount; i++) {
      const comp = componentFor(i);
      drawWave(
        (t) => Math.sin(t * comp.freq + (offs[i] ?? 0)) / playerCount,
        comp.color,
        1.1,
        0.45
      );
    }

    // combined signal in cyan
    drawWave((t) => signalValue(t, offs, playerCount), "#79f3ff", 2.6, 0.95);

    // playhead
    const px = left + span * 0.5;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, midY - amp);
    ctx.lineTo(px, midY + amp);
    ctx.stroke();

    // pulses
    const pulses = s.pulses;
    const playerDenom = playerCount > 1 ? playerCount - 1 : 1;
    for (const p of pulses) {
      const age = now - p.t;
      const ownerNorm = (p.owner || 0) / playerDenom;
      const x = w * (PULSE_X_MIN + PULSE_X_SPAN * ownerNorm);
      const r = 20 + age * 120;
      ctx.beginPath();
      ctx.arc(x, midY, r, 0, Math.PI * 2);
      const ownerColor = COMPONENTS[p.owner]?.color ?? "#79f3ff";
      ctx.strokeStyle = p.good
        ? "rgba(141,255,157," + (1 - age / 2.4).toFixed(3) + ")"
        : `rgba(${hexAlpha(ownerColor, 1 - age / 2.4)})`;
      ctx.lineWidth = p.good ? 3 : 1.5;
      ctx.stroke();
    }

    callbacks.onHud(s.timeLeft || 0, s.harmony || 0, s.combo || 0);
  }

  function hexAlpha(hex: string, a: number): string {
    // hex "#rrggbb" → "r,g,b,a"
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `${r},${g},${b},${a.toFixed(3)}`;
  }

  // unused — kept for future N>2 host rejoin path
  void isNumberArray;
  void isPulseArray;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  setOffset(0); // initialise label
  callbacks.onMode(MODE_LABEL.drift, MODE_PALETTE.drift);
  pushRoster();
  gameLoop.start();

  function destroy() {
    gameLoop.stop();
    window.removeEventListener("keydown", handleKeyDown);
    resetNet();
  }

  return {
    hostGame,
    joinGame,
    startGame: () => {
      if (isHost && state.players >= MIN_PLAYERS) startRound();
    },
    setOffset,
    pulse: doPulse,
    destroy,
  };
}
