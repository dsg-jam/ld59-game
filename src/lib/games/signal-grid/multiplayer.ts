/**
 * Signal Grid — Relay Co-op multiplayer layer.
 *
 * Host-authoritative: the host owns all state, runs the simulation, and
 * broadcasts full snapshots. Clients only send intent messages (place,
 * remove, run, …) and render whatever snapshot the host sends back.
 *
 * Keeps the single-player path untouched — everything is opt-in through
 * `startHost` / `startClient` and cleaned up by `leaveRoom`.
 */

import Peer from "peerjs";
import type { DataConnection } from "peerjs";

import { describePeerError, makeCode } from "$lib/peer";

// ── Constants ────────────────────────────────────────────────────────────────

const PEER_PREFIX = "ld59-signalgrid-";
export const MP_PLAYER_COLORS = [
  "#00ffd0", // host cyan
  "#ff2bd6", // magenta
  "#ffaa00", // amber
  "#5cffa1", // green
  "#68c6ff", // blue
  "#ffd561", // neon-yellow
  "#ff7ccf", // hot-pink
  "#a06bff", // violet
] as const;

// ── Shared message types ────────────────────────────────────────────────────

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

export type Role = "solo" | "host" | "client";

export type ClientIntent =
  | {
      t: "place";
      x: number;
      y: number;
      tool: string;
      shape: number;
      fromDir: number | null;
    }
  | { t: "remove"; x: number; y: number }
  | { t: "clear" }
  | { t: "reset" }
  | { t: "run" }
  | { t: "stop" }
  | { t: "step" }
  | { t: "level"; idx: number }
  | {
      t: "inspect-update";
      x: number;
      y: number;
      field: string;
      value: number | string | boolean;
    }
  | { t: "speed"; ms: number };

export type HostMessage =
  | {
      t: "welcome";
      you: string;
      color: string;
      players: PlayerInfo[];
    }
  | { t: "roster"; players: PlayerInfo[] }
  | { t: "snapshot"; s: unknown }
  | { t: "log"; text: string; cls: string };

// ── Hooks the host/client expose back to main.ts ─────────────────────────────

export interface MpHostHooks {
  applyIntent: (from: PlayerInfo, intent: ClientIntent) => void;
  buildSnapshot: () => unknown;
}

export interface MpClientHooks {
  onSnapshot: (snapshot: unknown) => void;
  onLog: (text: string, cls: string) => void;
}

export interface MpCommonHooks {
  onRoster: (players: PlayerInfo[]) => void;
  onStatus: (text: string) => void;
  onIdentity: (me: PlayerInfo) => void;
  onJoinError: (msg: string) => void;
  onRoomCode: (code: string | null) => void;
  onHostDisconnected: () => void;
}

// ── State kept inside this module ────────────────────────────────────────────

interface InternalState {
  role: Role;
  peer: Peer | null;
  me: PlayerInfo | null;
  roomCode: string | null;
  hostConn: DataConnection | null; // client side
  guests: Map<string, { conn: DataConnection; info: PlayerInfo }>; // host side
  hooks: MpCommonHooks | null;
  hostHooks: MpHostHooks | null;
  clientHooks: MpClientHooks | null;
}

const internal: InternalState = {
  role: "solo",
  peer: null,
  me: null,
  roomCode: null,
  hostConn: null,
  guests: new Map(),
  hooks: null,
  hostHooks: null,
  clientHooks: null,
};

function sanitizeName(name: string): string {
  const trimmed = name.trim().slice(0, 14);
  return trimmed.length > 0 ? trimmed : "OPERATOR";
}

function nextGuestColor(): string {
  const used = new Set<string>();
  if (internal.me) used.add(internal.me.color);
  for (const g of internal.guests.values()) used.add(g.info.color);
  return MP_PLAYER_COLORS.find((c) => !used.has(c)) ?? MP_PLAYER_COLORS[0];
}

function rosterSnapshot(): PlayerInfo[] {
  const players: PlayerInfo[] = [];
  if (internal.me) players.push(internal.me);
  for (const g of internal.guests.values()) players.push(g.info);
  return players;
}

function isClientIntent(value: unknown): value is ClientIntent {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value)) return false;
  const t = value.t;
  return (
    t === "place" ||
    t === "remove" ||
    t === "clear" ||
    t === "reset" ||
    t === "run" ||
    t === "stop" ||
    t === "step" ||
    t === "level" ||
    t === "inspect-update" ||
    t === "speed"
  );
}

function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value)) return false;
  const t = value.t;
  return t === "welcome" || t === "roster" || t === "snapshot" || t === "log";
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getRole(): Role {
  return internal.role;
}

export function isMultiplayer(): boolean {
  return internal.role !== "solo";
}

export function isHost(): boolean {
  return internal.role === "host";
}

export function isClient(): boolean {
  return internal.role === "client";
}

export function getMe(): PlayerInfo | null {
  return internal.me;
}

export function getRoster(): PlayerInfo[] {
  return rosterSnapshot();
}

export function getRoomCode(): string | null {
  return internal.roomCode;
}

export async function startHost(opts: {
  name: string;
  common: MpCommonHooks;
  host: MpHostHooks;
}): Promise<void> {
  leaveRoom();
  const { name, common, host } = opts;
  internal.role = "host";
  internal.hooks = common;
  internal.hostHooks = host;
  const code = makeCode(5);
  const hostId = PEER_PREFIX + code;
  const peer = new Peer(hostId);
  internal.peer = peer;
  internal.roomCode = code;

  common.onStatus("Opening channel…");

  peer.on("error", (err) => {
    common.onStatus(describePeerError(err));
  });

  peer.on("open", (id) => {
    const me: PlayerInfo = {
      id,
      name: sanitizeName(name),
      color: MP_PLAYER_COLORS[0],
    };
    internal.me = me;
    common.onIdentity(me);
    common.onRoomCode(code);
    common.onRoster(rosterSnapshot());
    common.onStatus(`Room ${code} open.`);
  });

  peer.on("connection", (conn) => {
    attachGuestConnection(conn);
  });
}

function attachGuestConnection(conn: DataConnection): void {
  let joinedInfo: PlayerInfo | null = null;
  conn.on("open", () => {
    let nameFromMeta = "OPERATOR";
    const meta: unknown = conn.metadata;
    if (typeof meta === "object" && meta !== null && "name" in meta) {
      const candidate = meta.name;
      if (typeof candidate === "string") nameFromMeta = candidate;
    }
    const info: PlayerInfo = {
      id: conn.peer,
      name: sanitizeName(nameFromMeta),
      color: nextGuestColor(),
    };
    joinedInfo = info;
    internal.guests.set(conn.peer, { conn, info });
    internal.hooks?.onRoster(rosterSnapshot());
    // Welcome the new guest with identity + roster, then a fresh snapshot.
    safeSend(conn, {
      t: "welcome",
      you: info.id,
      color: info.color,
      players: rosterSnapshot(),
    });
    broadcastRoster();
    const snapshot = internal.hostHooks?.buildSnapshot();
    if (snapshot !== undefined) {
      safeSend(conn, { t: "snapshot", s: snapshot });
    }
  });

  conn.on("data", (raw) => {
    if (!isClientIntent(raw)) return;
    if (!joinedInfo) return;
    internal.hostHooks?.applyIntent(joinedInfo, raw);
  });

  conn.on("close", () => {
    internal.guests.delete(conn.peer);
    internal.hooks?.onRoster(rosterSnapshot());
    broadcastRoster();
  });
  conn.on("error", () => {
    internal.guests.delete(conn.peer);
    internal.hooks?.onRoster(rosterSnapshot());
    broadcastRoster();
  });
}

export async function startClient(opts: {
  code: string;
  name: string;
  common: MpCommonHooks;
  client: MpClientHooks;
}): Promise<void> {
  leaveRoom();
  const { code, name, common, client } = opts;
  const cleanedCode = code.trim().toUpperCase();
  if (!cleanedCode) {
    common.onJoinError("Enter a room code.");
    return;
  }
  internal.role = "client";
  internal.hooks = common;
  internal.clientHooks = client;
  internal.roomCode = cleanedCode;

  const peer = new Peer();
  internal.peer = peer;

  common.onStatus(`Connecting to ${cleanedCode}…`);

  peer.on("error", (err) => {
    common.onJoinError(describePeerError(err));
  });

  peer.on("open", () => {
    const hostId = PEER_PREFIX + cleanedCode;
    const conn = peer.connect(hostId, {
      reliable: true,
      metadata: { name: sanitizeName(name) },
    });
    internal.hostConn = conn;

    conn.on("open", () => {
      common.onStatus(`Connected to ${cleanedCode}.`);
    });

    conn.on("data", (raw) => {
      if (!isHostMessage(raw)) return;
      handleHostMessage(raw);
    });

    conn.on("close", () => {
      if (internal.role === "client") {
        common.onStatus("Host disconnected.");
        common.onHostDisconnected();
        leaveRoom();
      }
    });

    conn.on("error", () => {
      common.onJoinError("Connection error.");
    });
  });
}

function handleHostMessage(msg: HostMessage): void {
  const common = internal.hooks;
  if (!common) return;
  if (msg.t === "welcome") {
    const me: PlayerInfo = {
      id: msg.you,
      name: "",
      color: msg.color,
    };
    internal.me = me;
    common.onIdentity(me);
    common.onRoster(msg.players);
    common.onRoomCode(internal.roomCode);
  } else if (msg.t === "roster") {
    common.onRoster(msg.players);
  } else if (msg.t === "snapshot") {
    internal.clientHooks?.onSnapshot(msg.s);
  } else if (msg.t === "log") {
    internal.clientHooks?.onLog(msg.text, msg.cls);
  }
}

function safeSend(conn: DataConnection, msg: HostMessage): void {
  try {
    conn.send(msg);
  } catch {
    // ignore — connection may be closing
  }
}

function broadcastRoster(): void {
  const players = rosterSnapshot();
  for (const g of internal.guests.values()) {
    safeSend(g.conn, { t: "roster", players });
  }
}

/** Host only — push a fresh snapshot to everyone. No-op in other roles. */
export function hostBroadcastSnapshot(snapshot: unknown): void {
  if (internal.role !== "host") return;
  for (const g of internal.guests.values()) {
    safeSend(g.conn, { t: "snapshot", s: snapshot });
  }
}

/** Host only — broadcast a log line. No-op in other roles. */
export function hostBroadcastLog(text: string, cls: string): void {
  if (internal.role !== "host") return;
  for (const g of internal.guests.values()) {
    safeSend(g.conn, { t: "log", text, cls });
  }
}

/** Client only — send an intent to the host. No-op in other roles. */
export function clientSendIntent(intent: ClientIntent): void {
  if (internal.role !== "client") return;
  const conn = internal.hostConn;
  if (!conn) return;
  try {
    conn.send(intent);
  } catch {
    // ignore
  }
}

/** Tear down any active room, reset to solo. */
export function leaveRoom(): void {
  for (const g of internal.guests.values()) {
    try {
      g.conn.close();
    } catch {
      /* ignore */
    }
  }
  internal.guests.clear();
  if (internal.hostConn) {
    try {
      internal.hostConn.close();
    } catch {
      /* ignore */
    }
  }
  internal.hostConn = null;
  if (internal.peer) {
    try {
      internal.peer.destroy();
    } catch {
      /* ignore */
    }
  }
  internal.peer = null;
  internal.me = null;
  internal.roomCode = null;
  internal.role = "solo";
  internal.hooks = null;
  internal.hostHooks = null;
  internal.clientHooks = null;
}
