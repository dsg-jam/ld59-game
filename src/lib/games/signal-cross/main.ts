import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { createGameLoop } from "$lib/game-loop";
import { describePeerError, makeCode } from "$lib/peer";
import { unlockAudio } from "./audio";
import {
  AGENCY_FIRST_DELAY_SEC,
  AGENCY_MAX_INTERVAL_SEC,
  AGENCY_MIN_INTERVAL_SEC,
  AGENCY_TIMEOUT_MS,
  CABLES_PER_PLAYER,
  CHARS,
  CLOSERS,
  CORRECT,
  DIRTY_SLIP_CHANCE,
  FORGED_NAME_CHANCE,
  LEVELS,
  LINE_FIRST_DELAY,
  LINE_INTERVAL_MS,
  PENALTY_AGENCY,
  PENALTY_APPROVE_BAD,
  PENALTY_DENY_WRONG,
  PENALTY_EARLY,
  PENALTY_TIMEOUT,
  PENALTY_TIMEOUT_STEP,
  PLAYER_COLORS,
  RING_TIMEOUT_MS,
  SCORE_AGENCY,
  SCORE_CHAOS,
  SCORE_CORRECT,
  SCORE_DENY_RIGHT,
  WRONG,
  WRONG_FALLBACK_A,
  WRONG_FALLBACK_B,
  WRONG_FALLBACK_C,
  makePhone,
  pick,
  shuffle,
} from "./data";
import type {
  ActionMsg,
  AgencyQuestion,
  CallDef,
  DialogLine,
  GameEvent,
  GameMode,
  GameSnapshot,
  LevelDef,
  LogEntry,
  Player,
  Signal1Callbacks,
  Signal1Controls,
  Slip,
  Ticket,
} from "./types";

const ROOM_PREFIX = "SIG-";
const HOST_RETRY_LIMIT = 4;
const LOG_CAP = 30;
const HOST_TICK_HZ = 0.5; // broadcast cadence (twice per second on top of event-driven sends)

type NetMsg =
  | { type: "hello"; name: string }
  | { type: "state"; snapshot: GameSnapshot }
  | { type: "event"; event: GameEvent }
  | { type: "lobby"; mode: GameMode; supervisorId: string | null }
  | { type: "action"; action: ActionMsg };

function makeRoomCode(): string {
  return `${ROOM_PREFIX}${makeCode(4)}`;
}

export function mount(callbacks: Signal1Callbacks): Signal1Controls {
  // ── NETWORK ────────────────────────────────────────────────────────────────
  let peer: Peer | null = null;
  let hostConn: DataConnection | null = null;
  const clientConns = new Map<string, DataConnection>();
  let isHost = false;
  let myId = "";
  let roomCode = "";

  // ── AUTHORITATIVE / MIRRORED STATE ─────────────────────────────────────────
  const state = {
    phase: "lobby" as "lobby" | "playing" | "ended",
    levelIdx: 0,
    timeLeft: 0,
    duration: 0,
    goal: 0,
    nextCallIdx: 0,
    teamScore: 0,
    teamChaos: 0,
    teamPenalty: 0,
    correctCount: 0,
    players: [] as Player[],
    tickets: [] as Ticket[],
    log: [] as LogEntry[],
    levelTitle: "",
    levelSubtitle: "",
    gameMode: "classic" as GameMode,
    supervisorId: null as string | null,
    timeoutCount: 0,
    agencyNextAt: 0,
  };
  let lobbyMode: GameMode = "classic";
  let lobbySupervisorId: string | null = null;
  let nextTicketId = 1;
  let broadcastAccum = 0;

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function setNetStatus(msg: string, kind: "" | "ok" | "err" = ""): void {
    callbacks.onNetStatus(msg, kind);
  }

  function emitSnapshot(): void {
    callbacks.onSnapshot(buildSnapshot());
  }

  function emitLobby(): void {
    callbacks.onLobby({ mode: lobbyMode, supervisorId: lobbySupervisorId });
  }

  function buildSnapshot(): GameSnapshot {
    return {
      phase: state.phase,
      levelIdx: state.levelIdx,
      timeLeft: state.timeLeft,
      duration: state.duration,
      goal: state.goal,
      teamScore: state.teamScore,
      teamChaos: state.teamChaos,
      teamPenalty: state.teamPenalty,
      correctCount: state.correctCount,
      tickets: state.tickets.map((t) => ({ ...t })),
      players: state.players.map((p) => ({ ...p })),
      log: state.log.map((e) => ({ ...e, lines: [...e.lines] })),
      levelTitle: state.levelTitle,
      levelSubtitle: state.levelSubtitle,
      gameMode: state.gameMode,
      supervisorId: state.supervisorId,
    };
  }

  function findLivePlug(plugId: string): Ticket | undefined {
    return state.tickets.find(
      (t) => t.status === "live" && (t.from === plugId || (t.connection?.actualTo ?? "") === plugId)
    );
  }

  function isPlugBusy(plugId: string): boolean {
    return !!findLivePlug(plugId);
  }

  // ── NETWORK I/O ────────────────────────────────────────────────────────────
  function broadcast(msg: NetMsg): void {
    for (const conn of clientConns.values()) {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function sendToHost(msg: NetMsg): void {
    if (hostConn && hostConn.open) {
      try {
        hostConn.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  function broadcastState(): void {
    if (!isHost) return;
    broadcast({ type: "state", snapshot: buildSnapshot() });
    emitSnapshot();
  }

  function broadcastEvent(event: GameEvent): void {
    if (!isHost) return;
    broadcast({ type: "event", event });
    callbacks.onEvent(event);
  }

  function broadcastLobbyState(): void {
    if (!isHost) return;
    broadcast({ type: "lobby", mode: lobbyMode, supervisorId: lobbySupervisorId });
    emitLobby();
  }

  // ── PEER LIFECYCLE ─────────────────────────────────────────────────────────
  function resetNet(): void {
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    }
    peer = null;
    hostConn = null;
    clientConns.clear();
  }

  function tryHost(name: string, attempt = 0): void {
    roomCode = makeRoomCode();
    callbacks.onRoomCode(roomCode);
    peer = new Peer(roomCode);
    peer.on("open", (id: string) => {
      myId = id;
      callbacks.onIdentity(myId, true);
      setNetStatus("HOST READY — code: " + roomCode, "ok");
      state.players = [
        {
          id: myId,
          name: name.toUpperCase().slice(0, 14),
          color: PLAYER_COLORS[0] ?? "#fff",
          cables: CABLES_PER_PLAYER,
          maxCables: CABLES_PER_PLAYER,
          selected: null,
        },
      ];
      lobbyMode = "classic";
      lobbySupervisorId = myId;
      emitSnapshot();
      emitLobby();
    });
    peer.on("connection", (conn) => {
      clientConns.set(conn.peer, conn);
      conn.on("open", () => {
        try {
          conn.send({ type: "lobby", mode: lobbyMode, supervisorId: lobbySupervisorId });
        } catch {
          /* ignore */
        }
      });
      conn.on("data", (data) => handleHostMessage(conn.peer, data as NetMsg));
      const drop = (): void => {
        clientConns.delete(conn.peer);
        const idx = state.players.findIndex((p) => p.id === conn.peer);
        if (idx >= 0) {
          state.players.splice(idx, 1);
          broadcastState();
          broadcastLobbyState();
        }
      };
      conn.on("close", drop);
      conn.on("error", drop);
    });
    peer.on("error", (err) => {
      if (err.type === "unavailable-id" && attempt < HOST_RETRY_LIMIT) {
        resetNet();
        tryHost(name, attempt + 1);
      } else {
        setNetStatus("HOST ERROR: " + describePeerError(err), "err");
      }
    });
  }

  function hostGame(name: string): void {
    resetNet();
    isHost = true;
    tryHost(name);
  }

  function joinGame(code: string, name: string): void {
    resetNet();
    isHost = false;
    roomCode = code;
    callbacks.onRoomCode(code);
    setNetStatus("CONNECTING TO " + code + "...", "");
    peer = new Peer();
    peer.on("open", () => {
      if (!peer) return;
      myId = peer.id;
      callbacks.onIdentity(myId, false);
      const conn = peer.connect(code, { reliable: true, metadata: { name } });
      hostConn = conn;
      conn.on("open", () => {
        setNetStatus("CONNECTED TO " + code, "ok");
        conn.send({ type: "hello", name });
      });
      conn.on("data", (data) => handleGuestMessage(data as NetMsg));
      conn.on("close", () => {
        setNetStatus("DISCONNECTED", "err");
        callbacks.onToast("Host disconnected. Returning to title.");
        resetLocalState();
      });
      conn.on("error", (err) => {
        setNetStatus("JOIN ERROR: " + describePeerError(err), "err");
      });
    });
    peer.on("error", (err) => {
      setNetStatus("JOIN ERROR: " + describePeerError(err), "err");
    });
  }

  // ── ACTION HANDLING ────────────────────────────────────────────────────────
  function handleHostMessage(peerId: string, msg: NetMsg): void {
    if (msg.type === "hello") {
      if (!state.players.find((p) => p.id === peerId)) {
        const color = PLAYER_COLORS[state.players.length % PLAYER_COLORS.length] ?? "#fff";
        state.players.push({
          id: peerId,
          name: (msg.name || "OP").toUpperCase().slice(0, 14),
          color,
          cables: CABLES_PER_PLAYER,
          maxCables: CABLES_PER_PLAYER,
          selected: null,
        });
        broadcastState();
        broadcastLobbyState();
      }
      return;
    }
    if (msg.type === "action") {
      hostHandleAction(peerId, msg.action);
    }
  }

  function handleGuestMessage(msg: NetMsg): void {
    if (msg.type === "state") {
      Object.assign(state, msg.snapshot);
      state.tickets = msg.snapshot.tickets.map((t) => ({ ...t }));
      state.players = msg.snapshot.players.map((p) => ({ ...p }));
      state.log = msg.snapshot.log.map((e) => ({ ...e, lines: [...e.lines] }));
      emitSnapshot();
    } else if (msg.type === "event") {
      callbacks.onEvent(msg.event);
    } else if (msg.type === "lobby") {
      lobbyMode = msg.mode;
      lobbySupervisorId = msg.supervisorId;
      emitLobby();
    }
  }

  function hostHandleAction(playerId: string, msg: ActionMsg): void {
    const p = state.players.find((x) => x.id === playerId);
    if (!p) return;
    if (state.phase !== "playing") return;

    if (msg.type === "select") handleSelect(p, msg.plugId);
    else if (msg.type === "deselect") handleDeselect(p);
    else if (msg.type === "connect") handleConnect(p, msg.toId);
    else if (msg.type === "disconnect") handleDisconnect(msg.ticketId);
    else if (msg.type === "verifyDecision") handleVerifyDecision(p, msg.ticketId, msg.decision);
    else if (msg.type === "stamp") handleStamp(p, msg.ticketId, msg.decision);
    else if (msg.type === "agencyAnswer") handleAgencyAnswer(p, msg.ticketId, msg.choiceIdx);
  }

  function handleSelect(p: Player, plugId: string): void {
    if (p.selected) return;
    if (isPlugBusy(plugId)) return;
    if (state.players.some((x) => x.selected === plugId)) return;
    const ticket = state.tickets.find(
      (t) => t.from === plugId && t.status === "ringing" && t.kind !== "agency"
    );
    if (!ticket) return;
    if (p.cables <= 0) return;
    if (state.gameMode === "supervisor" && ticket.approval !== "approved") return;
    if (state.gameMode === "verify" && ticket.approval !== "approved") {
      if (ticket.reviewer && ticket.reviewer !== p.id) return;
      p.selected = plugId;
      ticket.reviewer = p.id;
      broadcastState();
      return;
    }
    p.selected = plugId;
    broadcastState();
  }

  function handleDeselect(p: Player): void {
    if (!p.selected) return;
    const reviewing = state.tickets.find((t) => t.reviewer === p.id && t.approval === "pending");
    if (reviewing) reviewing.reviewer = null;
    p.selected = null;
    broadcastState();
  }

  function handleConnect(p: Player, toId: string): void {
    if (!p.selected) return;
    if (p.selected === toId) return;
    if (p.cables <= 0) return;
    const ticket = state.tickets.find((t) => t.from === p.selected && t.status === "ringing");
    if (!ticket) return;
    if (state.gameMode !== "classic" && ticket.approval !== "approved") return;
    if (isPlugBusy(toId) || isPlugBusy(ticket.from)) return;

    const correct = ticket.to === toId;
    const lines = getExchangeLines(ticket.from, toId, ticket.to ?? "");
    const now = Date.now();
    ticket.status = "live";
    ticket.connection = {
      byPlayer: p.id,
      actualTo: toId,
      correct,
      lines,
      lineIdx: 0,
      nextLineAt: now + LINE_FIRST_DELAY,
      completed: false,
      completedAt: null,
    };
    p.cables -= 1;
    p.selected = null;

    state.log.unshift({
      ticketId: ticket.id,
      from: ticket.from,
      actual: toId,
      intended: ticket.to ?? "",
      byPlayer: p.id,
      correct,
      lines: [],
      status: "streaming",
      result: null,
    });
    if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;

    broadcastState();
    broadcastEvent({
      type: "connect",
      byPlayer: p.id,
      fromId: ticket.from,
      toId,
      correct,
    });
  }

  function handleDisconnect(ticketId: number): void {
    const ticket = state.tickets.find((t) => t.id === ticketId && t.status === "live");
    if (!ticket) return;
    const conn = ticket.connection;
    if (!conn) return;
    const connector = state.players.find((x) => x.id === conn.byPlayer);
    const entry = state.log.find((e) => e.ticketId === ticket.id);

    if (!conn.completed) {
      state.teamPenalty += PENALTY_EARLY;
      if (entry) {
        entry.status = "ended";
        entry.result = "cut";
      }
      broadcastEvent({
        type: "disconnected",
        ticketId: ticket.id,
        fromId: ticket.from,
        toId: conn.actualTo,
        result: "cut",
      });
    } else {
      if (conn.correct) {
        state.teamScore += SCORE_CORRECT;
        state.correctCount += 1;
      } else {
        state.teamChaos += SCORE_CHAOS;
      }
      if (entry) {
        entry.status = "ended";
        entry.result = conn.correct ? "routed" : "chaos";
      }
      broadcastEvent({
        type: "disconnected",
        ticketId: ticket.id,
        fromId: ticket.from,
        toId: conn.actualTo,
        result: conn.correct ? "routed" : "chaos",
      });
    }

    if (connector) connector.cables = Math.min(connector.maxCables, connector.cables + 1);
    ticket.status = "done";
    ticket.connection = null;
    broadcastState();
  }

  function handleVerifyDecision(
    p: Player,
    ticketId: number,
    decision: "approve" | "deny" | "cancel"
  ): void {
    if (state.gameMode !== "verify") return;
    const ticket = state.tickets.find((t) => t.id === ticketId && t.status === "ringing");
    if (!ticket) return;
    if (ticket.reviewer !== p.id) return;
    if (decision === "approve") {
      ticket.approval = "approved";
      ticket.reviewer = null;
      if (ticket.slip && (ticket.slip.dirty || ticket.slip.flagged)) {
        state.teamPenalty += PENALTY_APPROVE_BAD;
        broadcastEvent({ type: "badApprove", fromId: ticket.from });
      }
      broadcastState();
    } else if (decision === "deny") {
      const correctDeny = !!(ticket.slip && (ticket.slip.dirty || ticket.slip.flagged));
      if (correctDeny) state.teamScore += SCORE_DENY_RIGHT;
      else state.teamPenalty += PENALTY_DENY_WRONG;
      ticket.status = "done";
      ticket.approval = "denied";
      ticket.reviewer = null;
      p.selected = null;
      broadcastEvent({
        type: "denied",
        ticketId: ticket.id,
        fromId: ticket.from,
        correct: correctDeny,
      });
      broadcastState();
    } else {
      ticket.reviewer = null;
      p.selected = null;
      broadcastState();
    }
  }

  function handleStamp(p: Player, ticketId: number, decision: "approve" | "deny"): void {
    if (state.gameMode !== "supervisor") return;
    if (p.id !== state.supervisorId) return;
    const ticket = state.tickets.find((t) => t.id === ticketId && t.status === "ringing");
    if (!ticket) return;
    if (ticket.approval !== "awaiting-stamp") return;
    if (decision === "approve") {
      ticket.approval = "approved";
      if (ticket.slip && (ticket.slip.dirty || ticket.slip.flagged)) {
        state.teamPenalty += PENALTY_APPROVE_BAD;
        broadcastEvent({ type: "badApprove", fromId: ticket.from });
      }
      broadcastEvent({ type: "stamp", approved: true });
      broadcastState();
    } else {
      const correctDeny = !!(ticket.slip && (ticket.slip.dirty || ticket.slip.flagged));
      if (correctDeny) state.teamScore += SCORE_DENY_RIGHT;
      else state.teamPenalty += PENALTY_DENY_WRONG;
      ticket.status = "done";
      ticket.approval = "denied";
      broadcastEvent({
        type: "denied",
        ticketId: ticket.id,
        fromId: ticket.from,
        correct: correctDeny,
      });
      broadcastEvent({ type: "stamp", approved: false });
      broadcastState();
    }
  }

  function handleAgencyAnswer(p: Player, ticketId: number, choiceIdx: number): void {
    const ticket = state.tickets.find(
      (t) => t.id === ticketId && t.status === "ringing" && t.kind === "agency"
    );
    if (!ticket || ticket.agencyPickedBy) return;
    ticket.agencyPickedBy = p.id;
    const correct = choiceIdx === (ticket.agencyQ?.correctIdx ?? -1);
    if (correct) state.teamScore += SCORE_AGENCY;
    else state.teamPenalty += PENALTY_AGENCY;
    ticket.status = "done";
    broadcastEvent(
      correct
        ? { type: "agencyCorrect", score: SCORE_AGENCY, operatorName: p.name }
        : { type: "agencyWrong", penalty: PENALTY_AGENCY, operatorName: p.name }
    );
    broadcastState();
  }

  // ── LEVEL LIFECYCLE ────────────────────────────────────────────────────────
  function startLevel(idx: number): void {
    if (!isHost) return;
    const lvl = LEVELS[idx];
    if (!lvl) return;
    state.phase = "playing";
    state.levelIdx = idx;
    state.timeLeft = lvl.duration;
    state.duration = lvl.duration;
    state.goal = lvl.goal;
    state.tickets = [];
    state.nextCallIdx = 0;
    state.log = [];
    state.teamScore = 0;
    state.teamChaos = 0;
    state.teamPenalty = 0;
    state.correctCount = 0;
    state.levelTitle = lvl.title;
    state.levelSubtitle = lvl.subtitle;
    state.timeoutCount = 0;
    state.agencyNextAt = Date.now() + AGENCY_FIRST_DELAY_SEC * 1000;
    state.gameMode = lobbyMode;
    if (state.gameMode === "supervisor") {
      const exists = state.players.some((p) => p.id === lobbySupervisorId);
      state.supervisorId = exists ? lobbySupervisorId : (state.players[0]?.id ?? null);
    } else {
      state.supervisorId = null;
    }
    nextTicketId = 1;
    state.players.forEach((p) => {
      const isSupervisor = state.gameMode === "supervisor" && p.id === state.supervisorId;
      p.maxCables = isSupervisor ? 0 : CABLES_PER_PLAYER;
      p.cables = p.maxCables;
      p.selected = null;
    });
    broadcastState();
  }

  function endLevel(): void {
    state.tickets.forEach((t) => {
      if (t.status === "live") t.status = "done";
    });
    state.phase = "ended";
    broadcastState();
  }

  function spawnTicket(call: CallDef): void {
    const now = Date.now();
    const slip = state.gameMode === "classic" ? null : makeSlip(call, state.levelIdx);
    const approval =
      state.gameMode === "classic"
        ? "none"
        : state.gameMode === "verify"
          ? "pending"
          : "awaiting-stamp";
    const lvl = LEVELS[state.levelIdx];
    const ringMs = lvl?.ringTimeoutSec ? lvl.ringTimeoutSec * 1000 : RING_TIMEOUT_MS;
    state.tickets.push({
      id: nextTicketId++,
      kind: "call",
      from: call.from,
      to: call.to,
      note: call.note,
      status: "ringing",
      ringingSince: now,
      ringDurationMs: ringMs,
      timeoutAt: now + ringMs,
      connection: null,
      slip,
      approval,
      reviewer: null,
      agencyQ: null,
      agencyPickedBy: null,
    });
    broadcastState();
    broadcastEvent({ type: "ring" });
  }

  function spawnAgency(): boolean {
    const q = buildAgencyQuestion();
    if (!q) return false;
    const now = Date.now();
    state.tickets.push({
      id: nextTicketId++,
      kind: "agency",
      from: "agency",
      to: null,
      note: "AGENCY CHECK-IN",
      status: "ringing",
      ringingSince: now,
      ringDurationMs: AGENCY_TIMEOUT_MS,
      timeoutAt: now + AGENCY_TIMEOUT_MS,
      connection: null,
      slip: null,
      approval: "none",
      reviewer: null,
      agencyQ: q,
      agencyPickedBy: null,
    });
    broadcastState();
    broadcastEvent({ type: "agencyRing" });
    return true;
  }

  function buildAgencyQuestion(): AgencyQuestion | null {
    const lvl = LEVELS[state.levelIdx];
    if (!lvl) return null;
    const ended = state.log.filter(
      (e) =>
        e.status === "ended" &&
        (e.result === "routed" || e.result === "chaos" || e.result === "cut")
    );
    const pickChars = (except: string[], n: number): string[] => {
      const pool = lvl.chars.filter((c) => !except.includes(c) && c !== "agency");
      shuffle(pool);
      return pool.slice(0, n);
    };
    for (const type of shuffle([
      "whoSpokeTo",
      "crossedCount",
      "whoRoutedByOp",
      "whoCutEarly",
      "lastCallerTo",
    ] as const)) {
      if (type === "whoSpokeTo") {
        const ref = ended.find((e) => e.result !== "cut");
        if (!ref) continue;
        const callerId = ref.from;
        const actualId = ref.actual;
        if (!CHARS[callerId] || !CHARS[actualId]) continue;
        const distractors = pickChars([callerId, actualId], 3);
        if (distractors.length < 2) continue;
        const choices = shuffle([actualId, ...distractors]).map((id) => ({
          label: CHARS[id]?.name ?? id,
          tag: id,
        }));
        return {
          text: `"${CHARS[callerId]?.name.toUpperCase() ?? callerId} — who did you put them through to?"`,
          choices,
          correctIdx: choices.findIndex((c) => c.tag === actualId),
        };
      }
      if (type === "crossedCount") {
        const count = state.log.filter((e) => e.status === "ended" && e.result === "chaos").length;
        const opts = new Set([count, Math.max(0, count - 1), count + 1, count + 2]);
        const arr = shuffle([...opts]).slice(0, 4);
        while (arr.length < 4) arr.push((arr[arr.length - 1] ?? 0) + 1);
        const choices = arr.map((n) => ({ label: String(n), tag: n }));
        return {
          text: `"How many crossed wires slipped through tonight?"`,
          choices,
          correctIdx: choices.findIndex((c) => c.tag === count),
        };
      }
      if (type === "whoRoutedByOp") {
        const byOp = new Map<string, LogEntry>();
        for (const e of ended) {
          if (e.result === "routed" && !byOp.has(e.byPlayer)) byOp.set(e.byPlayer, e);
        }
        if (!byOp.size) continue;
        const picked = [...byOp.entries()][Math.floor(Math.random() * byOp.size)];
        if (!picked) continue;
        const [opId, entry] = picked;
        const op = state.players.find((p) => p.id === opId);
        if (!op) continue;
        const callerId = entry.from;
        if (!CHARS[callerId]) continue;
        const distractors = pickChars([callerId], 3);
        if (distractors.length < 2) continue;
        const choices = shuffle([callerId, ...distractors]).map((id) => ({
          label: CHARS[id]?.name ?? id,
          tag: id,
        }));
        return {
          text: `"Operator ${op.name} — who was the last caller you routed?"`,
          choices,
          correctIdx: choices.findIndex((c) => c.tag === callerId),
        };
      }
      if (type === "whoCutEarly") {
        const cut = ended.find((e) => e.result === "cut");
        if (!cut) continue;
        const actualId = cut.actual;
        if (!CHARS[actualId]) continue;
        const distractors = pickChars([actualId], 3);
        if (distractors.length < 2) continue;
        const choices = shuffle([actualId, ...distractors]).map((id) => ({
          label: CHARS[id]?.name ?? id,
          tag: id,
        }));
        return {
          text: `"A line was CUT EARLY. Which recipient was mid-call?"`,
          choices,
          correctIdx: choices.findIndex((c) => c.tag === actualId),
        };
      }
      if (type === "lastCallerTo") {
        const ref = ended.find((e) => e.result !== "cut");
        if (!ref) continue;
        const actualId = ref.actual;
        const callerId = ref.from;
        if (!CHARS[callerId]) continue;
        const distractors = pickChars([callerId, actualId], 3);
        if (distractors.length < 2) continue;
        const choices = shuffle([callerId, ...distractors]).map((id) => ({
          label: CHARS[id]?.name ?? id,
          tag: id,
        }));
        return {
          text: `"Who most recently called ${CHARS[actualId]?.name.toUpperCase() ?? actualId}?"`,
          choices,
          correctIdx: choices.findIndex((c) => c.tag === callerId),
        };
      }
    }
    return null;
  }

  function makeSlip(call: CallDef, levelIdx: number): Slip | null {
    const lvl = LEVELS[levelIdx];
    if (!lvl) return null;
    const restricted = lvl.restricted || [];
    const flagged = restricted.includes(call.from) || restricted.includes(call.to);
    const dirtyReq = Math.random() < DIRTY_SLIP_CHANCE;
    const forgedName = Math.random() < FORGED_NAME_CHANCE;
    const dirty = !flagged && (dirtyReq || forgedName);

    let requestId = call.to;
    if (dirtyReq) {
      const pool = lvl.chars.filter((c) => c !== call.to && c !== call.from);
      if (pool.length) requestId = pool[Math.floor(Math.random() * pool.length)] ?? call.to;
    }
    let callerName = CHARS[call.from]?.name ?? call.from;
    if (forgedName) {
      const pool = lvl.chars.filter((c) => c !== call.from);
      if (pool.length) {
        const swap = pool[Math.floor(Math.random() * pool.length)] ?? call.from;
        callerName = CHARS[swap]?.name ?? call.from;
      }
    }
    return {
      slipNum: String(100 + Math.floor(Math.random() * 900)),
      callerName,
      line: makePhone(),
      requestId,
      requestName: CHARS[requestId]?.name ?? requestId,
      dirty,
      flagged,
    };
  }

  function getExchangeLines(fromId: string, actualId: string, expectedId: string): DialogLine[] {
    const correct = actualId === expectedId;
    const key = `${fromId}>${actualId}`;
    let base: DialogLine[];
    if (correct) {
      base = CORRECT[key] ?? [
        { s: fromId, t: `Hello, ${CHARS[actualId]?.name ?? actualId}?` },
        { s: actualId, t: "Speaking." },
        { s: fromId, t: "Just a quick one." },
        { s: actualId, t: "Understood. Goodbye." },
      ];
    } else if (WRONG[key]) {
      base = WRONG[key] as DialogLine[];
    } else {
      const expectName = CHARS[expectedId]?.name ?? expectedId;
      const actualName = CHARS[actualId]?.name ?? actualId;
      base = [
        { s: fromId, t: pick(WRONG_FALLBACK_A).replace("[EXPECT]", expectName) },
        { s: actualId, t: pick(WRONG_FALLBACK_B).replace("[ACTUAL]", actualName) },
        { s: fromId, t: pick(WRONG_FALLBACK_C) },
      ];
    }
    return [...base, { s: "sys", t: pick(CLOSERS) }];
  }

  // ── HOST TICK LOOP ─────────────────────────────────────────────────────────
  const loop = createGameLoop((dt) => {
    if (!isHost) return;
    if (state.phase !== "playing") return;

    const prevTime = state.timeLeft;
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    const lvl: LevelDef | undefined = LEVELS[state.levelIdx];
    if (lvl) {
      const elapsed = state.duration - state.timeLeft;
      while (
        state.nextCallIdx < lvl.calls.length &&
        (lvl.calls[state.nextCallIdx]?.at ?? Infinity) <= elapsed
      ) {
        const call = lvl.calls[state.nextCallIdx];
        if (call) spawnTicket(call);
        state.nextCallIdx++;
      }
    }

    let dirty = false;
    const nowMs = Date.now();

    state.tickets.forEach((t) => {
      if (t.status !== "live") return;
      const c = t.connection;
      if (!c) return;
      if (c.lineIdx < c.lines.length && nowMs >= c.nextLineAt) {
        const line = c.lines[c.lineIdx];
        if (!line) return;
        const entry = state.log.find((e) => e.ticketId === t.id);
        if (entry) entry.lines.push(line);
        c.lineIdx += 1;
        if (c.lineIdx >= c.lines.length) {
          c.completed = true;
          c.completedAt = nowMs;
        } else {
          const lvlNow = LEVELS[state.levelIdx];
          c.nextLineAt = nowMs + (lvlNow?.lineIntervalMs || LINE_INTERVAL_MS);
        }
        dirty = true;
        broadcastEvent({ type: "line", ticketId: t.id });
      }
    });

    state.tickets.forEach((t) => {
      if (t.status !== "ringing") return;
      if (nowMs < t.timeoutAt) return;
      if (t.kind === "agency") {
        state.teamPenalty += PENALTY_AGENCY;
        t.status = "done";
        broadcastEvent({ type: "agencyMiss", penalty: PENALTY_AGENCY });
      } else {
        const pen = PENALTY_TIMEOUT + PENALTY_TIMEOUT_STEP * state.timeoutCount;
        state.teamPenalty += pen;
        state.timeoutCount += 1;
        t.status = "done";
        broadcastEvent({ type: "timeout", ticketId: t.id, fromId: t.from, penalty: pen });
      }
      dirty = true;
    });

    if (!state.agencyNextAt) state.agencyNextAt = nowMs + AGENCY_FIRST_DELAY_SEC * 1000;
    const agencyPending = state.tickets.some((t) => t.kind === "agency" && t.status === "ringing");
    if (!agencyPending && nowMs >= state.agencyNextAt) {
      const ok = spawnAgency();
      const gap =
        (AGENCY_MIN_INTERVAL_SEC +
          Math.random() * (AGENCY_MAX_INTERVAL_SEC - AGENCY_MIN_INTERVAL_SEC)) *
        1000;
      state.agencyNextAt = nowMs + (ok ? gap : 9000);
      if (ok) dirty = true;
    }

    if (
      Math.floor(prevTime) !== Math.floor(state.timeLeft) &&
      state.timeLeft < 10 &&
      state.timeLeft > 0
    ) {
      broadcastEvent({ type: "tick" });
    }

    broadcastAccum += dt;
    if (dirty || broadcastAccum > HOST_TICK_HZ) {
      broadcastAccum = 0;
      broadcastState();
    } else {
      emitSnapshot();
    }

    if (state.timeLeft <= 0) endLevel();
  });

  loop.start();

  // ── EXPORTS ────────────────────────────────────────────────────────────────
  function resetLocalState(): void {
    state.phase = "lobby";
    state.levelIdx = 0;
    state.tickets = [];
    state.players = [];
    state.log = [];
    state.timeLeft = 0;
    state.nextCallIdx = 0;
    state.teamScore = 0;
    state.teamChaos = 0;
    state.teamPenalty = 0;
    state.correctCount = 0;
    state.gameMode = "classic";
    state.supervisorId = null;
    state.agencyNextAt = 0;
    state.timeoutCount = 0;
    lobbyMode = "classic";
    lobbySupervisorId = null;
    emitSnapshot();
    emitLobby();
  }

  function leaveRoom(): void {
    resetNet();
    isHost = false;
    myId = "";
    roomCode = "";
    callbacks.onIdentity("", false);
    callbacks.onRoomCode("");
    resetLocalState();
    setNetStatus("LEFT ROOM", "");
  }

  function sendAction(action: ActionMsg): void {
    if (isHost) hostHandleAction(myId, action);
    else sendToHost({ type: "action", action });
  }

  function setLobbyMode(mode: GameMode): void {
    if (!isHost) return;
    lobbyMode = mode;
    emitLobby();
    broadcastLobbyState();
  }

  function setSupervisor(playerId: string | null): void {
    if (!isHost) return;
    lobbySupervisorId = playerId;
    emitLobby();
    broadcastLobbyState();
  }

  function destroy(): void {
    loop.stop();
    resetNet();
  }

  // Prime UI with initial emissions.
  emitSnapshot();
  emitLobby();

  return {
    hostGame: (name) => {
      unlockAudio();
      hostGame(name);
    },
    joinGame: (code, name) => {
      unlockAudio();
      joinGame(code, name);
    },
    startLevel,
    replayLevel: () => startLevel(state.levelIdx),
    nextLevel: () => startLevel(state.levelIdx + 1 >= LEVELS.length ? 0 : state.levelIdx + 1),
    leaveRoom,
    setLobbyMode,
    setSupervisor,
    sendAction,
    destroy,
  };
}
