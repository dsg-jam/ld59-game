import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { makeCode } from "$lib/peer";
import type { Card, ColKey, MoveResult, Pick, ScoreEntry } from "./types.js";
import {
  W,
  H,
  D,
  COLKEYS,
  COLOR_NAMES,
  SHAPES,
  MAX_PLAYERS,
  PEER_PREFIX,
  PLAYER_CSS,
  TOTAL_ROUNDS,
  MAX_INITIATIVE,
  WINNER_TIED,
  gridToWorld,
} from "./types.js";
import { gs } from "./gameState.svelte.js";
import type { BlockRiseTrigger, SignalRingTrigger } from "./gameState.svelte.js";
import {
  DeconstructRoundStartMsgSchema,
  DeconstructTurnResultMsgSchema,
  isCoordinateTuples,
  cloneTupleArray,
  isTypedMessage,
} from "$lib/validators";
import type { DeconstructRoundStartMsg, DeconstructTurnResultMsg } from "$lib/validators";

// ---- ID counter for animation triggers ----
let _triggerCounter = 0;
function nextTriggerId(prefix: string): string {
  return `${prefix}-${++_triggerCounter}`;
}

// ---- Seeded RNG (mulberry32) ----
let _rng = Math.random;
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function setSeed(s: number) {
  _rng = mulberry32(s);
}
const rand = () => _rng();

const PHONE_PREFIXES = ["KL5", "MU6", "AT3", "EX1", "HE4", "PE9", "RI2", "OL7"];

export function pick<T>(a: T[]): T {
  const index = Math.floor(Math.random() * a.length);
  const item = a[index];
  if (item === undefined) throw new Error("Array is empty");
  return item;
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const ai = a[i];
    const aj = a[j];
    if (ai === undefined || aj === undefined) continue;
    a[i] = aj;
    a[j] = ai;
  }
  return a;
}

export function makePhone(): string {
  const p = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  return `${p}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

/**
 * Map a transformation function over coordinate tuples with proper type preservation.
 */
function mapCoordinates(
  arr: readonly (readonly [number, number])[],
  fn: (x: number, y: number) => [number, number]
): [number, number][] {
  const result: [number, number][] = [];
  for (const tuple of arr) {
    result.push(fn(tuple[0], tuple[1]));
  }
  return result;
}

// ---- Network state ----
let peer: InstanceType<typeof Peer> | null = null;
let isHost = false;
let mySlot = 0;
let conns: Array<DataConnection | null> = [];
let isSolo = false;

// Host-authoritative state
const HS: {
  seed: number;
  grid: ColKey[][][];
  hands: Record<number, Card[]>;
  picks: Record<number, Pick>;
  scores: Record<number, number>;
  turn: number;
  playerIds: string[];
  playerNames: Record<number, string>;
  started: boolean;
  N: number;
} = {
  seed: 0,
  grid: [],
  hands: {},
  picks: {},
  scores: {},
  turn: 1,
  playerIds: [],
  playerNames: {},
  started: false,
  N: 1,
};

// ---- Game logic ----
function topColorIn(grid: ColKey[][][], x: number, y: number): ColKey | null {
  const stack = grid[x]?.[y] ?? [];
  return stack.length ? (stack[stack.length - 1] ?? null) : null;
}

function topColor(x: number, y: number): ColKey | null {
  return topColorIn(gs.grid, x, y);
}

function validatesIn(grid: ColKey[][][], sel: [number, number][], card: Card): boolean {
  if (sel.length !== card.shape.cells.length) return false;
  for (const pos of sel) {
    if (topColorIn(grid, pos[0] ?? 0, pos[1] ?? 0) !== card.color) return false;
  }
  const norm = function (a: [number, number][]) {
    const mx = Math.min(...a.map((p) => p[0] ?? 0));
    const my = Math.min(...a.map((p) => p[1] ?? 0));
    return mapCoordinates(a, (x, y) => [(x ?? 0) - mx, (y ?? 0) - my]).sort(
      (a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0)
    );
  };
  const s = JSON.stringify(norm(sel));
  let cells: [number, number][] = cloneTupleArray(card.shape.cells);
  for (let r = 0; r < 4; r++) {
    if (JSON.stringify(norm(cells)) === s) return true;
    cells = mapCoordinates(cells, (x, y) => [-(y ?? 0), x ?? 0]);
  }
  return false;
}

function validates(sel: [number, number][], card: Card): boolean {
  return validatesIn(gs.grid, sel, card);
}

function generateGrid(): ColKey[][][] {
  const g: ColKey[][][] = [];
  for (let x = 0; x < W; x++) {
    const row: ColKey[][] = [];
    g[x] = row;
    for (let y = 0; y < H; y++) {
      const col: ColKey[] = [];
      for (let z = 0; z < D; z++) {
        col.push(COLKEYS[Math.floor(rand() * COLKEYS.length)] ?? "R");
      }
      row.push(col);
    }
  }
  return g;
}

function generateHand(): Card[] {
  const h: Card[] = [];
  const inits = new Set<number>();
  while (h.length < 5) {
    const init = 1 + Math.floor(rand() * MAX_INITIATIVE);
    if (inits.has(init)) continue;
    inits.add(init);
    const maxIdx = Math.min(SHAPES.length - 1, Math.floor(init / 4));
    const shapeIdx = Math.floor(rand() * (maxIdx + 1));
    const shape = SHAPES[shapeIdx] ?? SHAPES[0];
    if (!shape) continue;
    h.push({
      init,
      shape,
      color: COLKEYS[Math.floor(rand() * COLKEYS.length)] ?? "R",
    });
  }
  return h.sort((a, b) => a.init - b.init);
}

/**
 * Returns true if this card can legally be placed somewhere on the client's
 * current grid. Used to gray-out cards that have no valid placement.
 */
export function cardHasPlacement(card: Card): boolean {
  return findPlacement(gs.grid, card) !== null;
}

function findPlacement(grid: ColKey[][][], card: Card): [number, number][] | null {
  const tops: [number, number][] = [];
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      if (topColorIn(grid, x, y) === card.color) tops.push([x, y]);
    }
  let cells: [number, number][] = cloneTupleArray(card.shape.cells);
  for (let r = 0; r < 4; r++) {
    for (const anchor of tops) {
      const mx = Math.min(...cells.map((p) => p[0] ?? 0));
      const my = Math.min(...cells.map((p) => p[1] ?? 0));
      const placed: [number, number][] = cells.map((c) => [
        (c[0] ?? 0) - mx + (anchor[0] ?? 0),
        (c[1] ?? 0) - my + (anchor[1] ?? 0),
      ]);
      if (
        placed.every(
          (p) =>
            (p[0] ?? 0) >= 0 &&
            (p[0] ?? 0) < W &&
            (p[1] ?? 0) >= 0 &&
            (p[1] ?? 0) < H &&
            topColorIn(grid, p[0] ?? 0, p[1] ?? 0) === card.color
        )
      )
        return placed;
    }
    cells = cells.map((c) => [-(c[1] ?? 0), c[0] ?? 0]);
  }
  return null;
}

function cpuFind(card: Card): [number, number][] | null {
  const tops: [number, number][] = [];
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      if (topColor(x, y) === card.color) tops.push([x, y]);
    }
  let cells: [number, number][] = cloneTupleArray(card.shape.cells);
  for (let r = 0; r < 4; r++) {
    for (const anchor of tops) {
      const mx = Math.min(...cells.map((p) => p[0] ?? 0));
      const my = Math.min(...cells.map((p) => p[1] ?? 0));
      const placed: [number, number][] = cells.map((c) => [
        (c[0] ?? 0) - mx + (anchor[0] ?? 0),
        (c[1] ?? 0) - my + (anchor[1] ?? 0),
      ]);
      if (
        placed.every(
          (p) =>
            (p[0] ?? 0) >= 0 &&
            (p[0] ?? 0) < W &&
            (p[1] ?? 0) >= 0 &&
            (p[1] ?? 0) < H &&
            topColor(p[0] ?? 0, p[1] ?? 0) === card.color
        )
      )
        return placed;
    }
    cells = cells.map((c) => [-(c[1] ?? 0), c[0] ?? 0]);
  }
  return null;
}

function removeCubes(sel: [number, number][]) {
  for (const pos of sel) {
    const stack = HS.grid[pos[0] ?? 0]?.[pos[1] ?? 0];
    if (stack && stack.length) stack.pop();
  }
}

function slotName(slot: number): string {
  if (slot === mySlot) return "You";
  return gs.playerNames[slot] || (isSolo ? "CPU" : "P" + (slot + 1));
}

function log(msg: string, cls?: string) {
  const entry = cls ? { text: msg, kind: cls } : { text: msg };
  gs.logEntries = [entry, ...gs.logEntries].slice(0, 50);
}

function showMsg(m: string, cls?: string) {
  gs.msgText = m;
  gs.msgKind = cls ?? "";
}

function showWait(show: boolean) {
  gs.showWait = show;
}

function animateBlockRemoval(sel: [number, number][], heights: number[][]) {
  const triggers: BlockRiseTrigger[] = [];
  sel.forEach(function (pos) {
    const bx = pos[0] ?? 0,
      by = pos[1] ?? 0;
    const h = heights[bx]?.[by] ?? 0;
    if (h > 0) {
      const topZ = h - 1;
      const [wx, wy, wz] = gridToWorld(bx, by, topZ);
      const colorKey = gs.grid[bx]?.[by]?.[topZ] ?? "R";
      triggers.push({
        id: nextTriggerId(`rise-${bx}-${by}`),
        colorKey,
        worldX: wx,
        worldY: wy,
        worldZ: wz,
        vel: 0.015 + Math.random() * 0.025,
        rotXRate: (Math.random() - 0.5) * 0.12,
        rotZRate: (Math.random() - 0.5) * 0.12 * 0.7,
      });
    }
  });
  if (triggers.length > 0) {
    gs.risingBlockTriggers = [...gs.risingBlockTriggers, ...triggers];
  }
}

function spawnSignalRipples(sel: [number, number][], colorKey: ColKey, heights: number[][]) {
  const triggers: SignalRingTrigger[] = [];
  sel.forEach(function (pos) {
    const bx = pos[0] ?? 0,
      by = pos[1] ?? 0;
    const h = heights[bx]?.[by] ?? 0;
    const topZ = Math.max(0, h - 1);
    const [wx, wy, wz] = gridToWorld(bx, by, topZ);
    triggers.push({
      id: nextTriggerId(`ring-${bx}-${by}`),
      worldX: wx,
      worldZ: wz,
      worldY: wy,
      colorKey,
      duration: 0.9,
    });
  });
  if (triggers.length > 0) {
    gs.signalRingTriggers = [...gs.signalRingTriggers, ...triggers];
  }
}

// ---- Turn resolution ----
function resolveTurn(moves: MoveResult[], gridAfter: ColKey[][][] | null) {
  const visualHeights: number[][] = Array.from({ length: W }, (_, x) =>
    Array.from({ length: H }, (_, y) => gs.grid[x]?.[y]?.length ?? 0)
  );

  let delay = 0;
  moves.forEach(function (m: MoveResult) {
    setTimeout(function () {
      if (m.points > 0 && m.sel && m.card) {
        animateBlockRemoval(m.sel, visualHeights);
        spawnSignalRipples(m.sel, m.card.color, visualHeights);
        m.sel.forEach(([bx, by]) => {
          const row = visualHeights[bx];
          if (row !== undefined && row[by] !== undefined) {
            row[by] = Math.max(0, (row[by] ?? 0) - 1);
          }
        });
        log(
          "✓ " +
            slotName(m.slot) +
            " Δ" +
            m.card.init +
            " decoded " +
            m.card.shape.name +
            " on " +
            COLOR_NAMES[m.card.color] +
            " — +" +
            m.sel.length,
          "ok"
        );
      } else if (m.card) {
        log("✗ " + slotName(m.slot) + " Δ" + m.card.init + " — channel silent. Signal lost.");
      } else {
        log("· " + slotName(m.slot) + " held carrier.");
      }
    }, delay);
    delay += 450;
  });

  setTimeout(function () {
    if (gridAfter) gs.grid = gridAfter;
  }, delay + 200);
}

// ---- Host logic ----
function refillHand(existing: Card[]): Card[] {
  // Preserve unplayed cards across rounds; only top up to 5.
  const used = new Set(existing.map((c) => c.init));
  const next: Card[] = existing.slice();
  let safety = 200;
  while (next.length < 5 && safety-- > 0) {
    const init = 1 + Math.floor(rand() * MAX_INITIATIVE);
    if (used.has(init)) continue;
    used.add(init);
    const maxIdx = Math.min(SHAPES.length - 1, Math.floor(init / 4));
    const shapeIdx = Math.floor(rand() * (maxIdx + 1));
    const shape = SHAPES[shapeIdx] ?? SHAPES[0];
    if (!shape) continue;
    next.push({
      init,
      shape,
      color: COLKEYS[Math.floor(rand() * COLKEYS.length)] ?? "R",
    });
  }
  return next.sort((a, b) => a.init - b.init);
}

function hostStartRound() {
  if (HS.turn === 1) {
    HS.seed = (Math.random() * 2 ** 32) >>> 0;
    setSeed(HS.seed);
    HS.grid = generateGrid();
  }
  HS.picks = {};
  const n = HS.N;
  for (let i = 0; i < n; i++) {
    const existing = HS.hands[i];
    if (HS.turn === 1 || !existing || existing.length === 0) {
      HS.hands[i] = generateHand();
    } else {
      HS.hands[i] = refillHand(existing);
    }
  }
  const scores: ScoreEntry[] = [];
  for (let i = 0; i < n; i++) {
    scores.push({ slot: i, score: HS.scores[i] || 0 });
  }

  for (let i = 0; i < n; i++) {
    const msg: RoundStartMsg = {
      type: "round-start",
      grid: HS.grid,
      hand: HS.hands[i] ?? [],
      turn: HS.turn,
      scores,
      playerCount: n,
      yourSlot: i,
      names: HS.playerNames,
    };
    if (i === 0) onRoundStart(msg);
    else sendTo(i, msg);
  }
}

function hostOnPick(slot: number, cardIdx: number, sel: [number, number][] | null) {
  HS.picks[slot] = { cardIdx, sel };

  const n = HS.N;
  for (let i = 0; i < n; i++) {
    if (i !== slot && i !== 0) sendTo(i, { type: "player-locked", slot });
  }
  if (slot !== 0) log("· " + (HS.playerNames[slot] || "P" + (slot + 1)) + " transmitted.");

  if (Object.keys(HS.picks).length === n) hostResolveTurn();
}

function hostResolveTurn() {
  const n = HS.N;
  const actions: Array<{
    slot: number;
    card: Card | null;
    sel: [number, number][] | null;
    init: number;
  }> = [];
  for (let i = 0; i < n; i++) {
    const pick = HS.picks[i];
    if (!pick || pick.cardIdx < 0) {
      actions.push({ slot: i, card: null, sel: null, init: Infinity });
    } else {
      const hand = HS.hands[i] ?? [];
      const card = hand[pick.cardIdx] ?? null;
      if (card) actions.push({ slot: i, card, sel: pick.sel, init: card.init });
      else actions.push({ slot: i, card: null, sel: null, init: Infinity });
    }
  }
  actions.sort((a, b) => a.init - b.init || a.slot - b.slot);

  const results: MoveResult[] = [];
  for (const act of actions) {
    if (!act.card) {
      results.push({ slot: act.slot, card: null, sel: null, points: 0 });
      continue;
    }
    const playedCard = act.card;
    if (act.sel && validatesIn(HS.grid, act.sel, playedCard)) {
      removeCubes(act.sel);
      const pts = act.sel.length;
      HS.scores[act.slot] = (HS.scores[act.slot] || 0) + pts;
      // Remove the played card from the player's hand so unplayed cards persist.
      const hand = HS.hands[act.slot];
      if (hand) HS.hands[act.slot] = hand.filter((c) => c.init !== playedCard.init);
      results.push({
        slot: act.slot,
        card: playedCard,
        sel: act.sel,
        points: pts,
      });
    } else {
      // Played card was invalid (silent channel). Still consume it so players can't
      // retry the same dud card indefinitely.
      const hand = HS.hands[act.slot];
      if (hand) HS.hands[act.slot] = hand.filter((c) => c.init !== playedCard.init);
      results.push({
        slot: act.slot,
        card: playedCard,
        sel: act.sel,
        points: 0,
      });
    }
  }

  HS.turn++;
  const gameOver = HS.turn > TOTAL_ROUNDS;
  let winnerSlot = -1;
  if (gameOver) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if ((HS.scores[i] ?? 0) > best) {
        best = HS.scores[i] ?? 0;
        winnerSlot = i;
      }
    }
    let tiedCount = 0;
    for (let i = 0; i < n; i++) {
      if ((HS.scores[i] || 0) === best) tiedCount++;
    }
    if (tiedCount > 1) winnerSlot = WINNER_TIED;
  }
  const scores: ScoreEntry[] = [];
  for (let i = 0; i < n; i++) scores.push({ slot: i, score: HS.scores[i] || 0 });

  for (let j = 0; j < n; j++) {
    const msg = {
      type: "turn-result",
      results,
      grid: HS.grid,
      scores,
      turn: HS.turn,
      gameOver,
      winnerSlot,
      yourSlot: j,
      names: HS.playerNames,
    };
    if (j === 0) onTurnResult(msg);
    else sendTo(j, msg);
  }
  if (!gameOver) {
    setTimeout(function () {
      hostStartRound();
    }, 2400);
  }
}

// ---- Client-side handlers ----
type RoundStartMsg = DeconstructRoundStartMsg;
type TurnResultMsg = DeconstructTurnResultMsg;

function onRoundStart(data: RoundStartMsg) {
  gs.grid = JSON.parse(JSON.stringify(data.grid));
  gs.myHand = data.hand;
  gs.selectedCardIdx = null;
  gs.selected = [];
  gs.locked = false;
  gs.turn = data.turn;
  gs.allScores = data.scores;
  gs.playerCount = data.playerCount;
  gs.playerNames = Object.fromEntries(
    Object.entries(data.names)
      .map(([k, v]) => [parseInt(k, 10), v])
      .filter((entry) => Number.isFinite(entry[0]))
  );
  gs.mySlot = data.yourSlot;
  mySlot = data.yourSlot;
  showWait(false);
  gs.showRoundSummary = false;
  if (data.turn === 1)
    log(
      "▶ Transmission detected. Select a filter card, then click matching tiles on the grid.",
      "ok"
    );
}

function onTurnResult(data: TurnResultMsg) {
  gs.allScores = data.scores;
  gs.playerNames = Object.fromEntries(
    Object.entries(data.names)
      .map(([k, v]) => [parseInt(k, 10), v])
      .filter((entry) => Number.isFinite(entry[0]))
  );
  gs.locked = false;
  gs.selectedCardIdx = null;
  gs.selected = [];

  // Remember which turn just completed (data.turn is already advanced to the next round).
  const completedTurn = Math.max(1, data.turn - 1);
  gs.lastRoundResults = data.results;
  gs.lastRoundTurn = completedTurn;

  resolveTurn(data.results, data.grid);

  const totalDelay = data.results.length * 450 + 1200;
  if (data.gameOver) {
    setTimeout(function () {
      let msg: string;
      if (data.winnerSlot === WINNER_TIED) msg = "Signal split — tied transmission!";
      else if (data.winnerSlot === mySlot) msg = "You intercepted the transmission!";
      else msg = slotName(data.winnerSlot) + " intercepted the transmission.";
      const scoreText = data.scores.map((s) => slotName(s.slot) + ": " + s.score).join("  |  ");
      log("━━ CARRIER LOST — " + msg + " ━━", "ok");
      log(scoreText);
      showMsg(msg, "ok");
      gs.finalResults = { winnerSlot: data.winnerSlot, scores: data.scores };
      gs.showRoundSummary = false;
      gs.phase = "end";
    }, totalDelay);
  } else {
    // Show the per-round summary so players can see exactly what each operator played.
    // The summary is cleared when onRoundStart fires for the next round.
    setTimeout(function () {
      gs.showRoundSummary = true;
      gs.turn = data.turn;
    }, totalDelay);
  }
}

function resetGameState() {
  gs.logEntries = [];
  gs.lastRoundResults = [];
  gs.lastRoundTurn = 0;
  gs.showRoundSummary = false;
  gs.finalResults = null;
  gs.msgText = "";
  gs.msgKind = "";
  gs.showWait = false;
  gs.invalidShake = 0;
  gs.selected = [];
  gs.selectedCardIdx = null;
  gs.locked = false;
  gs.turn = 1;
  gs.allScores = [];
}

export function dismissResults() {
  gs.showRoundSummary = false;
}

export function returnToLobby() {
  destroy();
  HS.started = false;
  HS.turn = 1;
  HS.picks = {};
  HS.hands = {};
  HS.scores = {};
  HS.playerIds = [];
  HS.playerNames = {};
  HS.N = 1;
  mySlot = 0;
  conns = [];
  isHost = false;
  isSolo = false;
  gs.finalResults = null;
  gs.phase = "lobby";
  gs.lobbyPanel = "menu";
  gs.roomCode = "";
  gs.joinCodeInput = "";
  gs.joinStatus = "";
  gs.playerList = [];
  gs.playerCount = 1;
  gs.mySlot = 0;
  gs.isSolo = false;
  resetGameState();
}

export function triggerInvalidShake() {
  gs.invalidShake = gs.invalidShake + 1;
}

// ---- Networking ----
function sendTo(slot: number, data: unknown) {
  const conn = conns[slot];
  if (isHost && conn && conn.open) conn.send(data);
}
function sendToHost(data: unknown) {
  if (isHost) return;
  const conn = conns[0];
  if (conn && conn.open) conn.send(data);
}

function onMessage(data: unknown, fromSlot: number) {
  if (typeof data !== "object" || data === null) return;
  if (!isTypedMessage(data)) return;

  const obj = data;
  try {
    if (obj["type"] === "round-start") {
      const validated = DeconstructRoundStartMsgSchema.parse(data);
      onRoundStart(validated);
    } else if (obj["type"] === "turn-result") {
      const validated = DeconstructTurnResultMsgSchema.parse(data);
      onTurnResult(validated);
    } else if (obj["type"] === "player-locked") {
      const slot = typeof obj["slot"] === "number" ? obj["slot"] : 0;
      log("· " + slotName(slot) + " transmitted.");
    } else if (obj["type"] === "pick" && isHost) {
      const cardIdx = typeof obj["cardIdx"] === "number" ? obj["cardIdx"] : 0;
      let sel: [number, number][] | null = null;
      if (isCoordinateTuples(obj["sel"])) {
        sel = obj["sel"];
      }
      hostOnPick(fromSlot, cardIdx, sel);
    }
  } catch {
    // Invalid message, ignore
  }
}

// ---- Lobby / PeerJS ----
function updatePlayerList() {
  gs.playerList = HS.playerIds.map((_, i) => {
    const stored = HS.playerNames[i];
    const display = i === mySlot ? "You" : (stored ?? "Player " + (i + 1));
    return {
      slot: i,
      name: display + (i === 0 ? " (Host)" : ""),
      color: PLAYER_CSS[i] ?? "#ffffff",
    };
  });
  gs.lobbyStatus = HS.playerIds.length + "/" + MAX_PLAYERS + " operators tuned in.";
}

function startGame() {
  gs.phase = "game";
}

// ---- Exported API ----
export function toggleSel(x: number, y: number) {
  if (gs.selectedCardIdx == null) {
    showMsg("Select a decode filter first.");
    return;
  }
  const i = gs.selected.findIndex((s) => s[0] === x && s[1] === y);
  if (i >= 0) {
    gs.selected = gs.selected.filter((_, idx) => idx !== i);
  } else {
    const card = gs.myHand[gs.selectedCardIdx];
    if (!card) return;
    if (gs.selected.length >= card.shape.cells.length) {
      showMsg("Filter saturated — clear to retarget.");
      return;
    }
    gs.selected = [...gs.selected, [x, y]];
  }
  showMsg("");
}

export function soloGame() {
  isSolo = true;
  isHost = true;
  mySlot = 0;
  gs.mySlot = 0;
  gs.isSolo = true;
  HS.playerIds = ["host", "cpu"];
  HS.scores = { 0: 0, 1: 0 };
  // Host's stored name is "Host"; the local UI renders "You" for mySlot via slotName().
  HS.playerNames = { 0: "Host", 1: "CPU" };
  HS.N = 2;
  HS.turn = 1;
  HS.started = true;
  conns = [null, null];
  gs.playerNames = HS.playerNames;
  gs.playerCount = 2;
  resetGameState();
  startGame();
  hostStartRound();
}

export function hostGame() {
  const roomCode = makeCode();
  gs.roomCode = roomCode;
  isHost = true;
  isSolo = false;
  mySlot = 0;
  gs.mySlot = 0;
  gs.isSolo = false;
  HS.playerIds = ["host"];
  HS.scores = { 0: 0 };
  // Host's stored name is "Host"; the local UI renders "You" for mySlot via slotName().
  HS.playerNames = { 0: "Host" };
  HS.N = 1;
  HS.turn = 1;
  HS.started = false;
  conns = [null];
  resetGameState();
  gs.lobbyPanel = "waiting";
  updatePlayerList();

  peer = new Peer(PEER_PREFIX + roomCode);
  peer.on("open", function () {
    gs.lobbyStatus =
      "Broadcasting — awaiting operators (" + HS.playerIds.length + "/" + MAX_PLAYERS + ")";
  });
  peer.on("connection", function (c) {
    if (HS.started || HS.playerIds.length >= MAX_PLAYERS) {
      c.close();
      return;
    }
    const slot = HS.playerIds.length;
    HS.playerIds.push(c.peer);
    HS.scores[slot] = 0;
    HS.playerNames[slot] = "P" + (slot + 1);
    conns[slot] = c;
    c.on("open", function () {
      c.send({ type: "slot-assign", slot });
      updatePlayerList();
    });
    c.on("data", function (data: unknown) {
      if (typeof data !== "object" || data === null) return;
      if (!isTypedMessage(data)) return;
      const obj = data;
      if (typeof obj["type"] !== "string") return;
      if (obj["type"] === "name") {
        const name =
          (typeof obj["name"] === "string" ? obj["name"] : "").slice(0, 16) || "P" + (slot + 1);
        HS.playerNames[slot] = name;
        updatePlayerList();
      } else {
        onMessage(data, slot);
      }
    });
    c.on("close", function () {
      if (!HS.started) {
        HS.playerIds.splice(slot, 1);
        conns.splice(slot, 1);
        HS.scores = Object.fromEntries(
          Object.entries(HS.scores).filter(([k]) => k !== String(slot))
        );
        HS.playerNames = Object.fromEntries(
          Object.entries(HS.playerNames).filter(([k]) => k !== String(slot))
        );
        updatePlayerList();
      }
    });
  });
  peer.on("error", function (err) {
    gs.lobbyStatus = "Error: " + err.type;
  });
}

export function hostStartNow() {
  if (HS.playerIds.length < 2) return;
  HS.started = true;
  HS.N = HS.playerIds.length;
  for (let i = 1; i < HS.N; i++) {
    sendTo(i, {
      type: "game-start",
      playerCount: HS.N,
      names: HS.playerNames,
    });
  }
  startGame();
  hostStartRound();
}

export function joinGame() {
  const code = gs.joinCodeInput.toUpperCase().trim();
  if (!code || code.length < 3) return;
  const roomCode = code;
  isHost = false;
  isSolo = false;
  gs.isSolo = false;
  gs.lobbyPanel = "joining";
  gs.joinStatus = "Locking onto " + roomCode + "…";
  resetGameState();

  peer = new Peer();
  peer.on("open", function () {
    if (!peer) return;
    const c = peer.connect(PEER_PREFIX + roomCode, { reliable: true });
    conns = [c];
    c.on("open", function () {
      gs.joinStatus = "Signal locked. Awaiting transmission…";
    });
    c.on("data", function (data: unknown) {
      if (typeof data !== "object" || data === null) return;
      if (!isTypedMessage(data)) return;
      const msg = data;
      if (msg["type"] === "slot-assign") {
        mySlot = typeof msg["slot"] === "number" ? msg["slot"] : -1;
        gs.mySlot = mySlot;
      } else if (msg["type"] === "game-start") {
        gs.playerCount = typeof msg["playerCount"] === "number" ? msg["playerCount"] : 0;
        const names = msg["names"];
        gs.playerNames =
          typeof names === "object" && names !== null
            ? Object.fromEntries(
                Object.entries(names)
                  .map(([k, v]) => [parseInt(k, 10), v])
                  .filter((entry) => typeof entry[1] === "string")
              )
            : {};
        startGame();
      } else {
        onMessage(data, 0);
      }
    });
    c.on("close", function () {
      showMsg("Host disconnected.", "bad");
    });
  });
  peer.on("error", function (err) {
    gs.joinStatus = "Failed: " + err.type + ". Check the code.";
  });
}

export function onPickCard() {
  if (gs.locked || gs.selectedCardIdx == null) return;
  const card = gs.myHand[gs.selectedCardIdx];
  if (!card || !validates(gs.selected, card)) {
    showMsg("Pattern & frequency mismatch — adjust selection.", "bad");
    triggerInvalidShake();
    return;
  }
  gs.locked = true;

  const cardIdx = gs.selectedCardIdx;
  const sel = cloneTupleArray(gs.selected);

  if (isSolo) {
    hostOnPick(0, cardIdx, sel);
    const cpuHand = HS.hands[1] ?? [];
    const ci = Math.floor(rand() * cpuHand.length);
    const cpuCard = cpuHand[ci];
    const cpuSel = cpuCard ? cpuFind(cpuCard) : null;
    if (cpuSel) {
      hostOnPick(1, ci, cpuSel);
    } else {
      hostOnPick(1, -1, null);
    }
  } else if (isHost) {
    hostOnPick(0, cardIdx, sel);
    showWait(true);
  } else {
    sendToHost({ type: "pick", cardIdx, sel });
    showWait(true);
  }
}

export function onClear() {
  gs.selected = [];
}

export function onPass() {
  if (gs.locked) return;
  gs.locked = true;

  if (isSolo) {
    hostOnPick(0, -1, null);
    const cpuHand = HS.hands[1] ?? [];
    const ci = Math.floor(rand() * cpuHand.length);
    const cpuCard = cpuHand[ci];
    const cpuSel = cpuCard ? cpuFind(cpuCard) : null;
    if (cpuSel) {
      hostOnPick(1, ci, cpuSel);
    } else {
      hostOnPick(1, -1, null);
    }
  } else if (isHost) {
    hostOnPick(0, -1, null);
    showWait(true);
  } else {
    sendToHost({ type: "pick", cardIdx: -1, sel: null });
    showWait(true);
  }
}

export function destroy(): void {
  if (peer) {
    peer.destroy();
    peer = null;
  }
  conns = [];
}
