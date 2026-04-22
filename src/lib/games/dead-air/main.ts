import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { describePeerError, makeCode } from "$lib/peer";
import {
  type Melody,
  type NoteIndex,
  type Relay,
  type RoundConfig,
  type ScoreBreakdown,
  SCALE,
  clamp,
  createSeededRng,
  generateMelody,
  generateRelayChain,
  getConfigForRound,
  noteToFreq,
  scoreGuess,
} from "$lib/dead-air-engine";

// ── TUNING ────────────────────────────────────────────────────────────────────

const PEER_PREFIX = "dead-air-";
const ROOM_CODE_LENGTH = 5;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 1; // solo is allowed

const NOTE_DUR_S = 0.35; // length of each note in a melody
const NOTE_GAP_S = 0.05; // gap between notes
const MELODY_LEAD_IN_S = 0.1;

const CLEAN_PREVIEW_LIMIT = 2; // host may reveal clean original this many times

// ── PUBLIC TYPES ──────────────────────────────────────────────────────────────

export type Phase = "lobby" | "round" | "reveal";

export interface PlayerInfo {
  id: string;
  name: string;
  isYou: boolean;
  isHost: boolean;
  locked: boolean;
  score: number;
  lastRoundAccuracy: number | null;
}

export interface RoundInfo {
  round: number;
  melodyLength: number;
  relays: Relay[];
}

export interface RevealInfo {
  original: NoteIndex[];
  results: Array<{ id: string; name: string; guess: NoteIndex[]; accuracy: number }>;
}

export interface DeadAirCallbacks {
  onPhase(phase: Phase): void;
  onLobbyStatus(text: string): void;
  onRoomCode(code: string): void;
  onRoomWrapVisible(visible: boolean): void;
  onRoster(players: PlayerInfo[]): void;
  onStartEnabled(enabled: boolean): void;
  onRound(info: RoundInfo): void;
  onGuess(guess: NoteIndex[]): void;
  onLockState(locked: boolean): void;
  onPreviewRemaining(remaining: number): void;
  onReveal(info: RevealInfo): void;
  onLog(text: string, kind?: "info" | "good" | "bad"): void;
  onBusy(busy: boolean): void;
}

export interface DeadAirControls {
  hostGame(): void;
  joinGame(code: string): void;
  setName(name: string): void;
  startRound(): void;
  playDistorted(): void;
  playCleanPreview(): void;
  previewNote(noteIdx: NoteIndex): void;
  setGuessNote(slot: number, noteIdx: NoteIndex | null): void;
  lockAnswer(): void;
  unlockAnswer(): void;
  nextRound(): void;
  destroy(): void;
}

// ── WIRE PROTOCOL ─────────────────────────────────────────────────────────────

type RoundStartMsg = {
  t: "roundStart";
  round: number;
  seed: number;
  melodyLength: number;
  relayCount: number;
  maxRelayStrength: number;
};
type HelloJoinMsg = { t: "helloJoin"; name: string };
type HelloHostMsg = { t: "helloHost"; id: string; players: PlayerSnap[] };
type RosterMsg = { t: "roster"; players: PlayerSnap[] };
type GuessMsg = { t: "guess"; guess: NoteIndex[]; locked: boolean };
type RevealMsg = { t: "reveal"; info: RevealInfo; scores: Array<{ id: string; score: number }> };
type RenameMsg = { t: "rename"; name: string };
type NetMsg =
  | RoundStartMsg
  | HelloJoinMsg
  | HelloHostMsg
  | RosterMsg
  | GuessMsg
  | RevealMsg
  | RenameMsg;

interface PlayerSnap {
  id: string;
  name: string;
  score: number;
  lastRoundAccuracy: number | null;
  locked: boolean;
}

function isNetMsg(value: unknown): value is NetMsg {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value)) return false;
  const tag: unknown = value["t"];
  return typeof tag === "string";
}

// ── MOUNT ─────────────────────────────────────────────────────────────────────

export function mount(callbacks: DeadAirCallbacks): DeadAirControls {
  // ── Network ────────────────────────────────────────────────────────────────
  let peer: Peer | null = null;
  let isHost = false;
  let hostId: string | null = null;
  let myId: string | null = null;
  let roomCode = "";

  /** Host-only: connections keyed by peer id. */
  const conns = new Map<string, DataConnection>();
  /** Guest-only: the single connection to the host. */
  let hostConn: DataConnection | null = null;

  // ── State ──────────────────────────────────────────────────────────────────
  const players = new Map<string, PlayerSnap>();
  let phase: Phase = "lobby";
  let myName = defaultName();

  // Current round (host-authoritative; mirrored on guests).
  let currentRound = 0;
  let currentMelody: Melody | null = null;
  let currentRelays: Relay[] = [];
  let guess: (NoteIndex | null)[] = [];
  let locked = false;
  let previewRemaining = CLEAN_PREVIEW_LIMIT;

  // ── Audio ──────────────────────────────────────────────────────────────────
  let audioCtx: AudioContext | null = null;
  function getAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!audioCtx) {
      try {
        audioCtx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function defaultName(): string {
    return `OPERATIVE-${1 + Math.floor(Math.random() * MAX_PLAYERS)}`;
  }

  function log(text: string, kind: "info" | "good" | "bad" = "info"): void {
    callbacks.onLog(text, kind);
  }

  function sortedRoster(): PlayerInfo[] {
    const list: PlayerInfo[] = [];
    for (const p of players.values()) {
      list.push({
        id: p.id,
        name: p.name,
        isYou: p.id === myId,
        isHost: p.id === hostId,
        locked: p.locked,
        score: p.score,
        lastRoundAccuracy: p.lastRoundAccuracy,
      });
    }
    list.sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  function pushRoster(): void {
    callbacks.onRoster(sortedRoster());
  }

  function snapPlayers(): PlayerSnap[] {
    return [...players.values()].map((p) => ({ ...p }));
  }

  function send(target: DataConnection | null | undefined, msg: NetMsg): void {
    if (target && target.open) target.send(msg);
  }

  function broadcast(msg: NetMsg): void {
    for (const c of conns.values()) send(c, msg);
  }

  // ── Round state helpers ────────────────────────────────────────────────────
  function resetRoundState(): void {
    guess = currentMelody ? new Array(currentMelody.length).fill(null) : [];
    locked = false;
    callbacks.onGuess(guess.map((n) => n ?? -1));
    callbacks.onLockState(false);
  }

  function applyRoundSeed(
    round: number,
    seed: number,
    config: RoundConfig
  ): { melody: Melody; relays: Relay[] } {
    const rng = createSeededRng(seed);
    const melody = generateMelody(config.melodyLength, rng);
    const relays = generateRelayChain(config.relayCount, config.maxRelayStrength, rng);
    currentRound = round;
    currentMelody = melody;
    currentRelays = relays;
    previewRemaining = CLEAN_PREVIEW_LIMIT;
    callbacks.onPreviewRemaining(previewRemaining);
    resetRoundState();
    callbacks.onRound({ round, melodyLength: melody.length, relays: relays.slice() });
    return { melody, relays };
  }

  // ── Audio synthesis ────────────────────────────────────────────────────────
  /**
   * Render the melody through the relay chain into an AudioBuffer.
   * Using offline rendering lets us apply sample-level destructive operations
   * (dropout, bitcrush) cleanly without fighting live scheduling.
   */
  async function renderMelody(
    melody: Melody,
    relays: Relay[],
    clean: boolean
  ): Promise<AudioBuffer | null> {
    if (typeof OfflineAudioContext === "undefined") return null;
    const sampleRate = 44100;
    const totalDur = MELODY_LEAD_IN_S + melody.notes.length * (NOTE_DUR_S + NOTE_GAP_S) + 0.3;
    const oac = new OfflineAudioContext(1, Math.ceil(totalDur * sampleRate), sampleRate);

    const master = oac.createGain();
    master.gain.value = 0.8;
    master.connect(oac.destination);

    // Pre-build a shared pitch detune in cents, summed from all "pitch" relays.
    let pitchCents = 0;
    if (!clean) {
      for (const r of relays) {
        if (r.kind === "pitch") pitchCents += (Math.random() * 2 - 1) * 120 * r.strength;
      }
    }

    // Build each note as a two-oscillator voice routed through filter + gain.
    let startAt = MELODY_LEAD_IN_S;
    for (let i = 0; i < melody.notes.length; i++) {
      const note = melody.notes[i] ?? 0;
      const freq = noteToFreq(note);

      // Per-note dropout: skip entirely if any dropout relay fires.
      let skip = false;
      if (!clean) {
        for (const r of relays) {
          if (r.kind === "dropout" && Math.random() < r.strength * 0.65) skip = true;
        }
      }

      if (!skip) {
        const osc = oac.createOscillator();
        const osc2 = oac.createOscillator();
        const gain = oac.createGain();
        osc.type = "triangle";
        osc2.type = "sine";
        osc.frequency.value = freq;
        osc2.frequency.value = freq * 2;
        osc.detune.value = pitchCents;
        osc2.detune.value = pitchCents;

        const noteEnd = startAt + NOTE_DUR_S;
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(0.35, startAt + 0.02);
        gain.gain.setValueAtTime(0.35, noteEnd - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, noteEnd);

        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(master);
        osc.start(startAt);
        osc2.start(startAt);
        osc.stop(noteEnd + 0.02);
        osc2.stop(noteEnd + 0.02);
      }
      startAt += NOTE_DUR_S + NOTE_GAP_S;
    }

    // Noise bed (summed strengths from noise relays).
    let noiseStrength = 0;
    let lowpassHz = 0;
    let bitcrushAmount = 0;
    let echoAmount = 0;
    if (!clean) {
      for (const r of relays) {
        if (r.kind === "noise") noiseStrength += r.strength;
        if (r.kind === "lowpass") lowpassHz = Math.max(lowpassHz, r.strength);
        if (r.kind === "bitcrush") bitcrushAmount = Math.max(bitcrushAmount, r.strength);
        if (r.kind === "echo") echoAmount = Math.max(echoAmount, r.strength);
      }
    }

    if (noiseStrength > 0) {
      const len = oac.length;
      const noiseBuf = oac.createBuffer(1, len, sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.55;
      const noiseSrc = oac.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      const noiseGain = oac.createGain();
      noiseGain.gain.value = clamp(noiseStrength * 0.45, 0, 0.6);
      noiseSrc.connect(noiseGain);
      noiseGain.connect(master);
      noiseSrc.start(0);
    }

    // Lowpass filter on master if requested.
    if (lowpassHz > 0) {
      const filter = oac.createBiquadFilter();
      filter.type = "lowpass";
      // Higher strength → lower cutoff (more muffled).
      filter.frequency.value = clamp(3200 - lowpassHz * 2600, 320, 3200);
      filter.Q.value = 0.7;
      master.disconnect();
      master.connect(filter);
      filter.connect(oac.destination);
    }

    // Echo via a simple delay + feedback loop.
    if (echoAmount > 0) {
      const delay = oac.createDelay();
      delay.delayTime.value = 0.18 + echoAmount * 0.12;
      const feedback = oac.createGain();
      feedback.gain.value = clamp(echoAmount * 0.55, 0, 0.75);
      const wet = oac.createGain();
      wet.gain.value = clamp(echoAmount * 0.6, 0, 0.7);
      master.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(oac.destination);
    }

    const rendered = await oac.startRendering();

    // Apply post-render bitcrush directly on the PCM data.
    if (bitcrushAmount > 0) {
      const bits = Math.max(2, Math.round(12 - bitcrushAmount * 9));
      const step = Math.pow(2, 16 - bits);
      const data = rendered.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const v = data[i] ?? 0;
        const scaled = Math.round((v * 32768) / step) * step;
        data[i] = scaled / 32768;
      }
    }

    return rendered;
  }

  let cachedRender: { clean: boolean; buffer: AudioBuffer } | null = null;
  let renderInFlight: Promise<void> | null = null;

  async function ensureRender(clean: boolean): Promise<AudioBuffer | null> {
    if (!currentMelody) return null;
    if (cachedRender && cachedRender.clean === clean) return cachedRender.buffer;
    callbacks.onBusy(true);
    try {
      const buf = await renderMelody(currentMelody, currentRelays, clean);
      if (!buf) return null;
      cachedRender = { clean, buffer: buf };
      return buf;
    } finally {
      callbacks.onBusy(false);
    }
  }

  async function playBuffer(buffer: AudioBuffer): Promise<void> {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
  }

  function playDistorted(): void {
    if (!currentMelody || phase === "lobby") return;
    if (renderInFlight) return;
    const melody = currentMelody;
    renderInFlight = (async () => {
      try {
        // Distorted audio varies each render (non-deterministic dropouts / noise)
        // so we always re-render to give the player fresh listens.
        const ctx = getAudioCtx();
        if (!ctx) return;
        callbacks.onBusy(true);
        const buf = await renderMelody(melody, currentRelays, false);
        if (!buf) return;
        await playBuffer(buf);
      } finally {
        callbacks.onBusy(false);
        renderInFlight = null;
      }
    })();
  }

  function playCleanPreview(): void {
    if (!currentMelody || phase !== "round") return;
    if (previewRemaining <= 0) {
      log("No clean previews left.", "bad");
      return;
    }
    previewRemaining -= 1;
    callbacks.onPreviewRemaining(previewRemaining);
    log("Clean preview spent.", "info");
    void (async () => {
      const buf = await ensureRender(true);
      if (buf) await playBuffer(buf);
    })();
  }

  function previewNote(noteIdx: NoteIndex): void {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const idx = clamp(noteIdx, 0, SCALE.length - 1);
    const freq = noteToFreq(idx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  // ── Guess handling ─────────────────────────────────────────────────────────
  function setGuessNote(slot: number, noteIdx: NoteIndex | null): void {
    if (locked) return;
    if (!currentMelody) return;
    if (slot < 0 || slot >= currentMelody.length) return;
    guess[slot] = noteIdx;
    callbacks.onGuess(guess.map((n) => n ?? -1));
    // Preview the note when set.
    if (noteIdx !== null) previewNote(noteIdx);
  }

  function currentGuessResolved(): NoteIndex[] {
    return guess.map((n) => (n === null ? 0 : n));
  }

  function sendGuessUpdate(): void {
    if (isHost) {
      // Host updates own snap and broadcasts roster.
      if (myId) {
        const p = players.get(myId);
        if (p) {
          p.locked = locked;
          pushRoster();
        }
      }
      broadcast({ t: "roster", players: snapPlayers() });
      maybeResolveReveal();
    } else {
      send(hostConn, {
        t: "guess",
        guess: currentGuessResolved(),
        locked,
      });
    }
  }

  function lockAnswer(): void {
    if (!currentMelody) return;
    if (locked) return;
    locked = true;
    callbacks.onLockState(true);
    if (isHost && myId) {
      hostGuesses.set(myId, currentGuessResolved());
    }
    sendGuessUpdate();
    log("Answer locked.", "good");
  }

  function unlockAnswer(): void {
    if (!locked) return;
    if (phase !== "round") return;
    locked = false;
    callbacks.onLockState(false);
    if (isHost && myId) hostGuesses.delete(myId);
    sendGuessUpdate();
  }

  // ── Host round orchestration ───────────────────────────────────────────────
  /** Host-only map of locked guesses so we know when to reveal. */
  const hostGuesses = new Map<string, NoteIndex[]>();

  function startRound(): void {
    if (!isHost) return;
    if (phase === "round") return;
    const round = phase === "reveal" ? currentRound + 1 : 0;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const config = getConfigForRound(round);
    const msg: RoundStartMsg = {
      t: "roundStart",
      round,
      seed,
      melodyLength: config.melodyLength,
      relayCount: config.relayCount,
      maxRelayStrength: config.maxRelayStrength,
    };
    broadcast(msg);
    hostGuesses.clear();
    for (const p of players.values()) {
      p.locked = false;
      p.lastRoundAccuracy = null;
    }
    applyRoundSeed(round, seed, config);
    phase = "round";
    callbacks.onPhase("round");
    pushRoster();
    broadcast({ t: "roster", players: snapPlayers() });
    log(
      `Round ${round + 1} — ${config.melodyLength} notes through ${config.relayCount} relays.`,
      "info"
    );
  }

  function nextRound(): void {
    if (!isHost) return;
    startRound();
  }

  function maybeResolveReveal(): void {
    if (!isHost || phase !== "round") return;
    if (!currentMelody) return;
    const alive = [...players.values()];
    if (!alive.length) return;
    const allLocked = alive.every((p) => p.locked);
    if (!allLocked) return;
    resolveReveal();
  }

  function resolveReveal(): void {
    if (!isHost || !currentMelody) return;
    const original = currentMelody.notes.slice();
    const results: RevealInfo["results"] = [];
    const scoreMsg: Array<{ id: string; score: number }> = [];
    for (const p of players.values()) {
      const g = hostGuesses.get(p.id) ?? new Array(original.length).fill(-1);
      const score = scoreGuess(currentMelody, g);
      p.lastRoundAccuracy = score.accuracy;
      p.score += roundScore(score);
      p.locked = false;
      results.push({ id: p.id, name: p.name, guess: g, accuracy: score.accuracy });
      scoreMsg.push({ id: p.id, score: p.score });
    }
    const info: RevealInfo = { original, results };
    broadcast({ t: "reveal", info, scores: scoreMsg });
    applyReveal(info, scoreMsg);
  }

  function roundScore(breakdown: ScoreBreakdown): number {
    // 10 points per note with a perfect-match bonus of +15.
    const base = breakdown.correct * 10;
    const perfect = breakdown.accuracy === 1 ? 15 : 0;
    return base + perfect;
  }

  function applyReveal(info: RevealInfo, scores: Array<{ id: string; score: number }>): void {
    phase = "reveal";
    callbacks.onPhase("reveal");
    callbacks.onReveal(info);
    for (const s of scores) {
      const p = players.get(s.id);
      if (p) p.score = s.score;
    }
    for (const r of info.results) {
      const p = players.get(r.id);
      if (p) p.lastRoundAccuracy = r.accuracy;
    }
    pushRoster();
    const me = myId ? info.results.find((r) => r.id === myId) : null;
    if (me) {
      const pct = Math.round(me.accuracy * 100);
      if (me.accuracy === 1) log(`PERFECT ${pct}% — signal restored.`, "good");
      else if (me.accuracy >= 0.6) log(`Close. ${pct}% match.`, "info");
      else log(`Faint signal. ${pct}% match.`, "bad");
    }
  }

  // ── Networking ─────────────────────────────────────────────────────────────
  function updateStartEnabled(): void {
    if (!isHost) return;
    callbacks.onStartEnabled(players.size >= MIN_PLAYERS && phase !== "round");
  }

  function handleHostMessage(msg: NetMsg, fromId: string): void {
    switch (msg.t) {
      case "helloJoin": {
        if (players.has(fromId)) return;
        if (players.size >= MAX_PLAYERS) {
          const c = conns.get(fromId);
          if (c) {
            try {
              c.close();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        const name = (msg.name || "OPERATIVE").slice(0, 16);
        players.set(fromId, {
          id: fromId,
          name,
          score: 0,
          lastRoundAccuracy: null,
          locked: false,
        });
        send(conns.get(fromId), {
          t: "helloHost",
          id: hostId ?? "",
          players: snapPlayers(),
        });
        broadcast({ t: "roster", players: snapPlayers() });
        pushRoster();
        updateStartEnabled();
        log(`${name} tuned in.`, "good");
        break;
      }
      case "rename": {
        const p = players.get(fromId);
        if (!p) return;
        p.name = (msg.name || p.name).slice(0, 16);
        broadcast({ t: "roster", players: snapPlayers() });
        pushRoster();
        break;
      }
      case "guess": {
        const p = players.get(fromId);
        if (!p) return;
        if (phase !== "round") return;
        if (msg.locked) {
          hostGuesses.set(fromId, msg.guess.slice());
          p.locked = true;
        } else {
          hostGuesses.delete(fromId);
          p.locked = false;
        }
        broadcast({ t: "roster", players: snapPlayers() });
        pushRoster();
        maybeResolveReveal();
        break;
      }
    }
  }

  function handleGuestMessage(msg: NetMsg): void {
    switch (msg.t) {
      case "helloHost": {
        hostId = msg.id;
        players.clear();
        for (const p of msg.players) players.set(p.id, { ...p });
        pushRoster();
        callbacks.onLobbyStatus(`Connected. Awaiting round start.`);
        break;
      }
      case "roster": {
        players.clear();
        for (const p of msg.players) players.set(p.id, { ...p });
        pushRoster();
        break;
      }
      case "roundStart": {
        const config: RoundConfig = {
          melodyLength: msg.melodyLength,
          relayCount: msg.relayCount,
          maxRelayStrength: msg.maxRelayStrength,
        };
        applyRoundSeed(msg.round, msg.seed, config);
        phase = "round";
        callbacks.onPhase("round");
        log(
          `Round ${msg.round + 1} — ${msg.melodyLength} notes through ${msg.relayCount} relays.`,
          "info"
        );
        break;
      }
      case "reveal": {
        applyReveal(msg.info, msg.scores);
        break;
      }
    }
  }

  function attachGuestConn(c: DataConnection): void {
    const pid = c.peer;
    conns.set(pid, c);
    c.on("data", (d: unknown) => {
      if (isNetMsg(d)) handleHostMessage(d, pid);
    });
    c.on("close", () => {
      conns.delete(pid);
      const p = players.get(pid);
      if (p) {
        players.delete(pid);
        hostGuesses.delete(pid);
        broadcast({ t: "roster", players: snapPlayers() });
        pushRoster();
        updateStartEnabled();
        log(`${p.name} disconnected.`, "bad");
      }
    });
  }

  function resetNet(): void {
    for (const c of conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    if (hostConn) {
      try {
        hostConn.close();
      } catch {
        /* ignore */
      }
    }
    hostConn = null;
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    }
    peer = null;
  }

  function hostGame(): void {
    resetNet();
    isHost = true;
    phase = "lobby";
    callbacks.onPhase("lobby");
    players.clear();
    hostGuesses.clear();
    roomCode = makeCode(ROOM_CODE_LENGTH);
    hostId = PEER_PREFIX + roomCode;
    callbacks.onRoomCode(roomCode);
    callbacks.onRoomWrapVisible(true);
    callbacks.onLobbyStatus("Opening relay station...");

    peer = new Peer(hostId);
    peer.on("open", (id) => {
      myId = id;
      players.set(id, { id, name: myName, score: 0, lastRoundAccuracy: null, locked: false });
      pushRoster();
      updateStartEnabled();
      callbacks.onLobbyStatus("Station live. Share code — solo play supported.");
    });
    peer.on("connection", (c) => {
      attachGuestConn(c);
    });
    peer.on("error", (e) => callbacks.onLobbyStatus("Host error: " + describePeerError(e)));
  }

  function joinGame(code: string): void {
    if (!code) {
      callbacks.onLobbyStatus("Enter room code.");
      return;
    }
    resetNet();
    isHost = false;
    phase = "lobby";
    callbacks.onPhase("lobby");
    players.clear();
    roomCode = code.trim().toUpperCase();
    callbacks.onLobbyStatus(`Connecting to ${roomCode}...`);

    peer = new Peer();
    peer.on("open", (id) => {
      myId = id;
      const p = peer;
      if (!p) return;
      hostConn = p.connect(PEER_PREFIX + roomCode, { reliable: true });
      hostConn.on("open", () => {
        send(hostConn, { t: "helloJoin", name: myName });
        callbacks.onLobbyStatus("Linked. Awaiting round start.");
      });
      hostConn.on("data", (d: unknown) => {
        if (isNetMsg(d)) handleGuestMessage(d);
      });
      hostConn.on("close", () => {
        callbacks.onLobbyStatus("Disconnected from host.");
      });
    });
    peer.on("error", (e) => callbacks.onLobbyStatus("Join error: " + describePeerError(e)));
  }

  function setName(name: string): void {
    const trimmed = (name || "OPERATIVE").slice(0, 16);
    myName = trimmed;
    if (myId) {
      const me = players.get(myId);
      if (me) me.name = trimmed;
      pushRoster();
    }
    if (!isHost && hostConn && hostConn.open) {
      send(hostConn, { t: "rename", name: trimmed });
    } else if (isHost) {
      broadcast({ t: "roster", players: snapPlayers() });
    }
  }

  function destroy(): void {
    resetNet();
    if (audioCtx) {
      try {
        void audioCtx.close();
      } catch {
        /* ignore */
      }
      audioCtx = null;
    }
  }

  // Initial state callbacks.
  callbacks.onPhase("lobby");
  callbacks.onPreviewRemaining(previewRemaining);
  pushRoster();

  return {
    hostGame,
    joinGame,
    setName,
    startRound,
    playDistorted,
    playCleanPreview,
    previewNote,
    setGuessNote,
    lockAnswer,
    unlockAnswer,
    nextRound,
    destroy,
  };
}
