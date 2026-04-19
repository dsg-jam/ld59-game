import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { createGameLoop } from "$lib/game-loop";
import { describePeerError, makeCode } from "$lib/peer";

const PEER_PREFIX = "sigweave-";
const MAX_PLAYERS = 2;
const PULSE_X_MIN = 0.2;
const PULSE_X_SPAN = 0.6;
const NETWORK_TICK_RATE = 0.05;
const COMBO_TIMEOUT_SECONDS = 4;
const PULSE_SYNC_WINDOW_SECONDS = 0.8;
export const OFFSET_MIN = 0;
export const OFFSET_MAX = 628;
const OFFSET_SCALE = 100;
const ARROW_KEY_STEP = 6;
const ROOM_CODE_LENGTH = 5;
const HARMONY_THRESHOLD = 0.18;
const HARMONY_GAIN_RATE = 12;

type Pulse = { owner: number; t: number; good: boolean };
type GameSnapshot = {
  t: number;
  timeLeft: number;
  harmony: number;
  combo: number;
  offsets: number[];
  pulses: Pulse[];
  running: boolean;
  players: number;
};
type HostMsg = { t: "offset"; v: number } | { t: "ping" };
type GuestMsg =
  | { t: "hello"; slot: number }
  | { t: "start" }
  | { t: "state"; s: GameSnapshot }
  | { t: "burst"; good: boolean }
  | { t: "end"; harmony: string }
  | { t: "reject"; reason?: string };

/** Callbacks the page provides so the game engine can update UI reactively. */
export interface SignalWeaveCallbacks {
  onLobbyStatus(text: string): void;
  onRoomCode(code: string): void;
  onRoomWrapVisible(visible: boolean): void;
  onStartEnabled(enabled: boolean): void;
  onGameStart(): void;
  onSlot(label: string): void;
  onHud(timeLeft: number, harmony: number, combo: number): void;
  onLog(text: string, kind: string): void;
  onNetStatus(text: string): void;
  onOffset(rawValue: number, label: string): void;
  onFlash(kind: string): void;
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

/**
 * Mount the Signal Weave game engine.
 * Call from `onMount`; call `destroy()` (or the returned controls' `destroy`) from `onDestroy`.
 */
export function mount(
  canvas: HTMLCanvasElement,
  callbacks: SignalWeaveCallbacks
): SignalWeaveControls {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) throw new Error("Canvas 2D context unavailable");
  const ctx = rawCtx;

  // ── NETWORK STATE ──────────────────────────────────────────────────────────
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let conns: (DataConnection | null)[] = [null];
  let isHost = false;
  let mySlot = -1;
  let roomCode = "";

  // ── GAME STATE ─────────────────────────────────────────────────────────────
  const state: {
    running: boolean;
    t: number;
    timeLeft: number;
    harmony: number;
    combo: number;
    offsets: [number, number];
    lastPing: [number, number];
    pulses: Pulse[];
    players: number;
  } = {
    running: false,
    t: 0,
    timeLeft: 90,
    harmony: 0,
    combo: 0,
    offsets: [0, Math.PI * 0.5],
    lastPing: [-99, -99],
    pulses: [],
    players: 1,
  };
  let localSnapshot: GameSnapshot | null = null;
  let currentOffsetRaw = 0;

  // ── HELPERS ────────────────────────────────────────────────────────────────
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

  // ── MATH ──────────────────────────────────────────────────────────────────
  function signalValue(t: number, offsets: number[]): number {
    return (Math.sin(t * 2.0 + (offsets[0] ?? 0)) + Math.sin(t * 2.7 + (offsets[1] ?? 0))) * 0.5;
  }
  function targetValue(t: number): number {
    return Math.sin(t * 1.5 + Math.sin(t * 0.4) * 1.2);
  }

  // ── HOST LOGIC ─────────────────────────────────────────────────────────────
  function hostTick(dt: number) {
    if (!state.running) return;
    state.t += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    const comboFactor = 1 + Math.min(5, state.combo) * 0.15;
    const diff = Math.abs(signalValue(state.t, state.offsets) - targetValue(state.t));

    if (diff < HARMONY_THRESHOLD) state.harmony += dt * HARMONY_GAIN_RATE * comboFactor;
    else state.harmony = Math.max(0, state.harmony - dt * 5);

    if (
      state.combo > 0 &&
      state.t - Math.max(state.lastPing[0], state.lastPing[1]) > COMBO_TIMEOUT_SECONDS
    )
      state.combo = 0;
    state.pulses = state.pulses.filter((p) => state.t - p.t < 2.4);

    if (state.timeLeft <= 0) {
      state.running = false;
      broadcast({ t: "end", harmony: state.harmony.toFixed(1) });
      log("Weave complete. Harmony: " + state.harmony.toFixed(1));
    }
  }

  function hostSnapshot(): GameSnapshot {
    return {
      t: state.t,
      timeLeft: state.timeLeft,
      harmony: state.harmony,
      combo: state.combo,
      offsets: state.offsets,
      pulses: state.pulses,
      running: state.running,
      players: state.players,
    };
  }

  function sendState() {
    const data = { t: "state", s: hostSnapshot() };
    localSnapshot = data.s;
    broadcast(data);
  }

  function onPing(slot: number) {
    const now = state.t;
    state.lastPing[slot] = now;
    state.pulses.push({ owner: slot, t: now, good: false });
    const other = slot === 0 ? 1 : 0;
    if (state.players >= 2 && now - (state.lastPing[other] ?? -99) < PULSE_SYNC_WINDOW_SECONDS) {
      const aligned = Math.abs(signalValue(state.t, state.offsets) - targetValue(state.t)) < 0.2;
      if (aligned) {
        state.combo += 1;
        state.harmony += 16 + Math.min(state.combo, 6) * 2;
        state.pulses.push({ owner: slot, t: now, good: true });
        broadcast({ t: "burst", good: true });
        callbacks.onFlash("good");
        log("Synchronized constructive pulse.", "good");
      } else {
        state.combo = 0;
        state.harmony = Math.max(0, state.harmony - 6);
        broadcast({ t: "burst", good: false });
        callbacks.onFlash("bad");
        log("Pulse collided out of phase.", "bad");
      }
    } else if (state.players < 2) {
      log("Awaiting second operator for synchronized pulse.");
    }
  }

  function startRound() {
    state.running = true;
    state.t = 0;
    state.timeLeft = 90;
    state.harmony = 0;
    state.combo = 0;
    state.pulses = [];
    state.lastPing = [-99, -99];
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

  // ── NETWORKING ─────────────────────────────────────────────────────────────
  function hostGame() {
    if (typeof Peer === "undefined")
      return callbacks.onLobbyStatus("PeerJS failed to load.");
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

    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on("open", () => callbacks.onLobbyStatus("Channel open. Waiting for operator 2."));
    peer.on("connection", (c) => {
      if (state.players >= MAX_PLAYERS || state.running) {
        c.on("open", () => {
          c.send({
            t: "reject",
            reason: state.running ? "Game already in progress." : "Room is full.",
          });
          c.close();
        });
        return;
      }
      conns[1] = c;
      c.on("open", () => {
        state.players = 2;
        c.send({ t: "hello", slot: 1 });
        callbacks.onStartEnabled(true);
        callbacks.onLobbyStatus("Operator connected. Ready to begin.");
        log("Second operator tuned in.");
      });
      c.on("data", (d) => onHostMessage(d as HostMsg, 1));
      c.on("close", () => {
        state.players = 1;
        conns[1] = null;
        callbacks.onStartEnabled(false);
        callbacks.onLobbyStatus("Operator disconnected.");
        log("Peer disconnected.", "bad");
      });
    });
    peer.on("error", (e) =>
      callbacks.onLobbyStatus("Host peer error: " + describePeerError(e))
    );
  }

  function joinGame(code: string) {
    if (typeof Peer === "undefined")
      return callbacks.onLobbyStatus("PeerJS failed to load.");
    if (!code) return callbacks.onLobbyStatus("Enter room code.");
    resetNet();
    callbacks.onLobbyStatus("Tuning into " + code + "...");
    peer = new Peer();
    peer.on("open", () => {
      const p = peer;
      if (!p) throw new Error("No peer");
      conn = p.connect(PEER_PREFIX + code, { reliable: true });
      conn.on("open", () => callbacks.onLobbyStatus("Connected. Awaiting host start."));
      conn.on("data", (d) => onGuestMessage(d as GuestMsg));
      conn.on("close", () => callbacks.onLobbyStatus("Disconnected from host."));
    });
    peer.on("error", (e) =>
      callbacks.onLobbyStatus("Join peer error: " + describePeerError(e))
    );
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
      callbacks.onSlot("P" + (mySlot + 1));
      callbacks.onLobbyStatus("Linked as operator " + (mySlot + 1) + ".");
    } else if (d.t === "start") {
      callbacks.onGameStart();
      log("Host started the weave.");
    } else if (d.t === "state") {
      localSnapshot = d.s;
    } else if (d.t === "burst") {
      callbacks.onFlash(d.good ? "good" : "bad");
      log(
        d.good ? "Synchronized constructive pulse." : "Pulse collided out of phase.",
        d.good ? "good" : "bad"
      );
    } else if (d.t === "end") {
      log("Weave complete. Harmony: " + d.harmony);
    } else if (d.t === "reject") {
      callbacks.onLobbyStatus(d.reason ?? "Unable to join room.");
    }
  }

  // ── CONTROLS ───────────────────────────────────────────────────────────────
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

  // ── KEYBOARD ──────────────────────────────────────────────────────────────
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

  // ── GAME LOOP + DRAW ───────────────────────────────────────────────────────
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
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    const midY = h * 0.5;
    const left = 30,
      right = w - 30,
      span = right - left;
    const amp = h * 0.22;
    const s = snapshot;
    const now = s.t || 0;

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
    drawWave((t) => targetValue(t), "#ff7ccf", 2.5, 0.95);
    drawWave((t) => signalValue(t, offs), "#79f3ff", 2.5, 0.95);
    drawWave((t) => Math.sin(t * 2.0 + (offs[0] ?? 0)), "#8ef9ff", 1.2, 0.35);
    drawWave((t) => Math.sin(t * 2.7 + (offs[1] ?? 0)), "#6bb4ff", 1.2, 0.35);

    const pulses = s.pulses;
    const playerCount = Math.max(1, s.players ?? 1);
    const playerDenom = playerCount > 1 ? playerCount - 1 : 1;
    for (const p of pulses) {
      const age = now - p.t;
      const ownerNorm = (p.owner || 0) / playerDenom;
      const x = w * (PULSE_X_MIN + PULSE_X_SPAN * ownerNorm);
      const r = 20 + age * 120;
      ctx.beginPath();
      ctx.arc(x, midY, r, 0, Math.PI * 2);
      ctx.strokeStyle = p.good
        ? "rgba(141,255,157," + (1 - age / 2.4).toFixed(3) + ")"
        : "rgba(121,243,255," + (1 - age / 2.4).toFixed(3) + ")";
      ctx.lineWidth = p.good ? 3 : 1.5;
      ctx.stroke();
    }

    callbacks.onHud(s.timeLeft || 0, s.harmony || 0, s.combo || 0);
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────
  setOffset(0); // initialise label
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
      if (isHost && state.players >= 2) startRound();
    },
    setOffset,
    pulse: doPulse,
    destroy,
  };
}
