import { Audio } from "./audio.js";
import { GRID_H, GRID_W, LEVELS, type Level, type Source, type Sink } from "./levels.js";

// SIGNAL // ldjam59 -- main game logic
// Tile-based signal routing puzzle. See levels.js for level data.

// ---------------- Types ----------------
interface PipeShapeDef {
  name: string;
  glyph: string;
  conn: number[];
}

interface Tile {
  type: string;
  fixed?: boolean;
  shape: number;
  n: number;
  op: string;
  axis: string;
  dir: number;
  x: number;
  y: number;
  seq?: number[];
  period?: number;
  offset?: number;
  loop?: boolean;
  expected?: number[];
  _emittedIdx?: number;
  _lastEmitTick?: number;
}

interface Signal {
  id: string;
  x: number;
  y: number;
  dir: number;
  value: number;
  born: number;
  prevX: number;
  prevY: number;
}

interface Hold {
  x: number;
  y: number;
  dir: number;
  value: number;
  untilTick: number;
}

interface Cell {
  x: number;
  y: number;
}

interface GameState {
  level: Level | null;
  levelIdx: number;
  grid: (Tile | null)[][];
  bin: Record<string, number>;
  signals: Signal[];
  tick: number;
  running: boolean;
  speedMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  tool: string | null;
  toolPipeShape: number;
  selected: Cell | null;
  solved: Set<number>;
  results: Record<string, number[]>;
  status: string;
  holds: Hold[];
  lastTickAt: number;
}

// ---------------- Constants ----------------
const N = 0,
  E = 1,
  S = 2,
  W = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIR_NAMES = ["N", "E", "S", "W"];
const OPP = (d: number): number => (d + 2) % 4;
const TURN_R = (d: number): number => (d + 1) % 4;
const TURN_L = (d: number): number => (d + 3) % 4;

const CELL = 56; // px per tile
const PADDING = 16;

// Pipe shapes: connection sets (sorted compass dirs)
const PIPE_SHAPES: PipeShapeDef[] = [
  { name: "H", glyph: "━", conn: [E, W] },
  { name: "V", glyph: "┃", conn: [N, S] },
  { name: "NE", glyph: "┗", conn: [N, E] },
  { name: "SE", glyph: "┏", conn: [E, S] },
  { name: "SW", glyph: "┓", conn: [S, W] },
  { name: "NW", glyph: "┛", conn: [N, W] },
  { name: "T-N", glyph: "┻", conn: [N, E, W] }, // T with no south arm
  { name: "T-E", glyph: "┣", conn: [N, E, S] }, // T with no west arm
  { name: "T-S", glyph: "┳", conn: [E, S, W] }, // T with no north arm
  { name: "T-W", glyph: "┫", conn: [N, S, W] }, // T with no east arm
  { name: "X", glyph: "╋", conn: [N, E, S, W] },
];

const DEFAULT_PIPE: PipeShapeDef = { name: "H", glyph: "━", conn: [E, W] };

// ---------------- DOM ----------------
function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}
const $ = <T extends HTMLElement>(id: string): T => getEl<T>(id);
const board = $<HTMLCanvasElement>("board");
const rawCtx = board.getContext("2d");
if (!rawCtx) throw new Error("2d context not available");
const ctx: CanvasRenderingContext2D = rawCtx;

// ---------------- Game State ----------------
const state: GameState = {
  level: null,
  levelIdx: 0,
  grid: [],
  bin: {},
  signals: [],
  tick: 0,
  running: false,
  speedMs: 100,
  timer: null,
  tool: null, // currently selected palette tool
  toolPipeShape: 0, // which pipe shape next placed
  selected: null, // selected cell {x,y}
  solved: new Set(),
  results: {}, // sinkKey -> received[]
  status: "IDLE",
  holds: [],
  lastTickAt: 0,
};

// Load progress
try {
  const s = localStorage.getItem("signal_solved");
  if (s) state.solved = new Set(JSON.parse(s));
} catch (e) {
  void e;
}

function saveProgress() {
  try {
    localStorage.setItem("signal_solved", JSON.stringify([...state.solved]));
  } catch (e) {
    void e;
  }
}

// ---------------- Tile factory ----------------
function makeTile(type: string, props: Partial<Tile> = {}): Tile {
  const t: Tile = {
    type,
    shape: props.shape ?? 0,
    n: props.n ?? 0,
    op: props.op ?? "%2==",
    axis: props.axis ?? "H",
    dir: props.dir ?? 0,
    x: props.x ?? 0,
    y: props.y ?? 0,
    fixed: props.fixed,
    seq: props.seq,
    period: props.period,
    offset: props.offset,
    loop: props.loop,
    expected: props.expected,
    _emittedIdx: props._emittedIdx,
  };
  if (type === "pipe" && props.shape == null) t.shape = 0;
  if (type === "amp" && props.n == null) t.n = 1;
  if (type === "mul" && props.n == null) t.n = 2;
  if (type === "filt" && props.op == null) {
    t.op = "%2==";
    t.n = 0;
  }
  if (type === "delay" && props.n == null) t.n = 1;
  if (type === "router" && props.op == null) {
    t.op = "%2==";
    t.n = 0;
  }
  return t;
}

// Returns the array of compass directions a tile connects to (for routing logic).
// For pipes, depends on shape. For gates, they act as straight pipes (H or V).
function tileConnections(tile: Tile): number[] | null {
  if (!tile) return null;
  if (tile.type === "pipe") return (PIPE_SHAPES[tile.shape] ?? DEFAULT_PIPE).conn;
  if (tile.type === "wall") return [];
  if (tile.type === "source") return [tile.dir]; // emits along dir
  if (tile.type === "sink") return [N, E, S, W]; // accepts from any side
  // Routers need all 4 sides available for turn-left/turn-right outputs.
  if (tile.type === "router") return [N, E, S, W];
  // Gates (amp/mul/filt/delay): act like a straight pipe along axis.
  if (["amp", "mul", "filt", "delay"].includes(tile.type)) {
    return tile.axis === "V" ? [N, S] : [E, W];
  }
  return null;
}

// Given a tile + the direction the signal is *traveling*, return the next direction(s).
// Signal arrives FROM direction OPP(travel) and exits travelDir if that's connected.
// For T/X pipes: prefer straight-through, else any non-incoming connected dir.
// Gates: straight through. Routers: branch by predicate.
function tileExits(tile: Tile, incomingDir: number, value: number): number[] {
  // incomingDir is the direction the signal was traveling when it entered.
  const conns = tileConnections(tile);
  if (!conns) return [];
  const fromSide = OPP(incomingDir); // side of tile signal came in from
  if (!conns.includes(fromSide)) return []; // pipe doesn't open on that side

  // Routers branch on predicate
  if (tile.type === "router") {
    const cond = evalCond(value, tile.op, tile.n);
    // True -> turn right, False -> turn left, relative to incoming travel dir.
    const exit = cond ? TURN_R(incomingDir) : TURN_L(incomingDir);
    if (conns.includes(exit)) return [exit];
    // fallback: straight
    if (conns.includes(incomingDir)) return [incomingDir];
    return [];
  }

  // Pipes:
  //  - Straight/corner (2 conns): exit is the other connection.
  //  - Cross (4 conns): pass straight through, never split.
  //  - T-junction (3 conns): always split to ALL other connected sides
  //    (one input → two outputs duplicated). Use this for forking.
  if (tile.type === "pipe") {
    if (conns.length === 2) {
      const other = conns.find((c) => c !== fromSide);
      return other != null ? [other] : [];
    }
    if (conns.length === 4) {
      // Cross: pass through (signals can cross independently)
      return [incomingDir];
    }
    // T-junction: SPLIT to other connections (duplicate signal)
    return conns.filter((c) => c !== fromSide);
  }

  // Source/sink/gate behave straight if connected
  if (conns.includes(incomingDir)) return [incomingDir];
  return [];
}

function evalCond(value: number, op: string, n: number): boolean {
  switch (op) {
    case "==":
      return value === n;
    case "!=":
      return value !== n;
    case ">":
      return value > n;
    case "<":
      return value < n;
    case ">=":
      return value >= n;
    case "<=":
      return value <= n;
    case "%2==":
      return value % 2 === n; // n is 0 or 1
  }
  return false;
}

// ---------------- Level setup ----------------
function loadLevel(idx: number) {
  const lvl = LEVELS[idx];
  if (!lvl) return;
  state.level = lvl;
  state.levelIdx = idx;
  state.grid = Array.from({ length: GRID_H }, () => Array<Tile | null>(GRID_W).fill(null));
  // Install fixed tiles
  lvl.fixed.forEach((f) => {
    const row = state.grid[f.y];
    if (row) row[f.x] = makeTile(f.kind, { ...f, fixed: true } as Partial<Tile>);
  });
  (lvl.walls ?? []).forEach((w) => {
    const row = state.grid[w.y];
    if (row) row[w.x] = makeTile("wall", { ...w, fixed: true });
  });
  state.bin = { ...(lvl.bin ?? {}) } as Record<string, number>;
  state.signals = [];
  state.tick = 0;
  state.running = false;
  state.tool = null;
  state.toolPipeShape = 0;
  state.selected = null;
  state.results = {};
  state.status = "IDLE";
  resetSinks();

  $("hud-level").textContent = String(idx + 1).padStart(2, "0");
  $("brief-title").textContent = lvl.title;
  $("brief-text").textContent = lvl.brief;
  renderGoals();
  renderPalette();
  renderInspector();
  renderLevelList();
  clearLog();
  log("Level loaded: " + lvl.title, "info");
  draw();
}

function resetSinks() {
  state.results = {};
  if (!state.level) return;
  state.level.fixed
    .filter((f): f is Sink => f.kind === "sink")
    .forEach((snk) => {
      const k = snk.x + "," + snk.y;
      state.results[k] = [];
    });
}

function renderGoals() {
  const ul = $("goal-list");
  ul.innerHTML = "";
  if (!state.level) return;
  state.level.fixed
    .filter((f): f is Sink => f.kind === "sink")
    .forEach((snk, i) => {
      const k = snk.x + "," + snk.y;
      const got = state.results[k] ?? [];
      const ok = arraysEq(got, snk.expected);
      const li = document.createElement("li");
      li.className = ok ? "done" : "";
      li.textContent = `RX-${i + 1} (${snk.x},${snk.y}): need [${snk.expected.join(", ")}] | got [${got.join(", ")}]`;
      ul.appendChild(li);
    });
}

function arraysEq(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function renderLevelList() {
  const wrap = $("level-list");
  wrap.innerHTML = "";
  LEVELS.forEach((lv, i) => {
    const b = document.createElement("button");
    b.className =
      "lvl-btn" +
      (i === state.levelIdx ? " active" : "") +
      (state.solved.has(lv.id) ? " solved" : "");
    b.textContent = String(i + 1).padStart(2, "0");
    b.title = lv.name;
    b.onclick = () => {
      Audio.click();
      loadLevel(i);
    };
    wrap.appendChild(b);
  });
}

// ---------------- Palette ----------------
const PALETTE_DEFS = [
  { key: "pipe", icon: "╋", label: "WIRE" },
  { key: "amp", icon: "＋", label: "AMP" },
  { key: "mul", icon: "✕", label: "MUL" },
  { key: "filt", icon: "⩤", label: "FILT" },
  { key: "delay", icon: "⏲", label: "DELAY" },
  { key: "router", icon: "⟚", label: "ROUTER" },
];

function renderPalette() {
  const wrap = $("palette");
  wrap.innerHTML = "";
  PALETTE_DEFS.forEach((p) => {
    const count = state.bin[p.key] ?? 0;
    const div = document.createElement("div");
    div.className =
      "part" + (state.tool === p.key ? " active" : "") + (count <= 0 ? " depleted" : "");
    let icon = p.icon;
    let label = p.label;
    if (p.key === "pipe") {
      const sh = PIPE_SHAPES[state.toolPipeShape] ?? DEFAULT_PIPE;
      icon = sh.glyph;
      label = `WIRE · ${sh.name}`;
    }
    div.innerHTML = `<span class="icon">${icon}</span>${label}<span class="count">${count}</span>`;
    div.onclick = () => {
      if (count <= 0) return;
      Audio.click();
      if (state.tool === p.key && p.key === "pipe") {
        state.toolPipeShape = (state.toolPipeShape + 1) % PIPE_SHAPES.length;
      } else {
        state.tool = p.key;
        if (p.key !== "pipe") state.toolPipeShape = 0;
      }
      renderPalette();
      draw();
    };
    wrap.appendChild(div);
  });
  // Shape strip appears when WIRE is the active tool
  document.querySelectorAll(".shape-strip").forEach((s) => s.remove());
  if (state.tool === "pipe") {
    const strip = document.createElement("div");
    strip.className = "shape-strip";
    PIPE_SHAPES.forEach((sh, i) => {
      const b = document.createElement("button");
      b.className = "shape-btn" + (i === state.toolPipeShape ? " active" : "");
      b.textContent = sh.glyph;
      b.title = sh.name;
      b.onclick = (e) => {
        e.stopPropagation();
        state.toolPipeShape = i;
        Audio.click();
        renderPalette();
        draw();
      };
      strip.appendChild(b);
    });
    wrap.appendChild(strip);
  }
}

// ---------------- Inspector ----------------
function renderInspector() {
  const insp = $("inspector");
  if (!state.selected) {
    insp.innerHTML = '<div class="hint">Click a placed gate to program it.</div>';
    return;
  }
  const sel = state.selected;
  const t = state.grid[sel.y]?.[sel.x];
  if (!t || t.fixed) {
    insp.innerHTML = '<div class="hint">This tile cannot be programmed.</div>';
    return;
  }
  let html = `<div class="insp-title">${t.type.toUpperCase()} @ (${sel.x}, ${sel.y})</div>`;
  if (t.type === "pipe") {
    html += `<div class="insp-row"><label>SHAPE</label><select id="i-shape">`;
    PIPE_SHAPES.forEach(
      (s, i) =>
        (html += `<option value="${i}" ${t.shape === i ? "selected" : ""}>${s.name}</option>`)
    );
    html += `</select></div>`;
  }
  if (["amp", "mul", "filt", "delay", "router"].includes(t.type)) {
    html += `<div class="insp-row"><label>AXIS</label><select id="i-axis">
      <option value="H" ${t.axis !== "V" ? "selected" : ""}>HORIZONTAL ─</option>
      <option value="V" ${t.axis === "V" ? "selected" : ""}>VERTICAL │</option>
    </select></div>`;
  }
  if (t.type === "amp") {
    html += `<div class="insp-row"><label>ADD N</label><input type="number" id="i-n" value="${t.n}" step="1"></div>`;
  }
  if (t.type === "mul") {
    html += `<div class="insp-row"><label>MUL N</label><input type="number" id="i-n" value="${t.n}" step="1"></div>`;
  }
  if (t.type === "delay") {
    html += `<div class="insp-row"><label>TICKS</label><input type="number" id="i-n" value="${t.n}" min="1" step="1"></div>`;
  }
  if (t.type === "filt" || t.type === "router") {
    html += `<div class="insp-row"><label>OP</label><select id="i-op">
      ${["==", "!=", ">", "<", ">=", "<=", "%2=="].map((op) => `<option value="${op}" ${t.op === op ? "selected" : ""}>${op}</option>`).join("")}
    </select></div>`;
    html += `<div class="insp-row"><label>N</label><input type="number" id="i-n" value="${t.n}" step="1"></div>`;
    if (t.type === "router") {
      html += `<div class="hint">If true → signal turns RIGHT (relative to travel). Else → LEFT.</div>`;
    } else {
      html += `<div class="hint">Pass signal only if condition is true.</div>`;
    }
  }
  insp.innerHTML = html;
  ["i-shape", "i-axis", "i-op"].forEach((id) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    el.onchange = () => {
      if (!state.selected) return;
      const sel2 = state.selected;
      const tt = state.grid[sel2.y]?.[sel2.x];
      if (!tt) return;
      if (id === "i-shape") tt.shape = parseInt(el.value, 10);
      if (id === "i-axis") tt.axis = el.value;
      if (id === "i-op") tt.op = el.value;
      draw();
    };
  });
  const nEl = document.getElementById("i-n") as HTMLInputElement | null;
  if (nEl)
    nEl.oninput = () => {
      if (!state.selected) return;
      const sel3 = state.selected;
      const tt = state.grid[sel3.y]?.[sel3.x];
      if (!tt) return;
      tt.n = parseInt(nEl.value, 10) || 0;
      draw();
    };
}

// ---------------- Board input ----------------
function cellFromMouse(ev: MouseEvent): Cell | null {
  const r = board.getBoundingClientRect();
  const sx = (ev.clientX - r.left) * (board.width / r.width);
  const sy = (ev.clientY - r.top) * (board.height / r.height);
  const x = Math.floor((sx - PADDING) / CELL);
  const y = Math.floor((sy - PADDING) / CELL);
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
  return { x, y };
}

board.addEventListener("contextmenu", (e) => e.preventDefault());

// Find the pipe shape whose connection set exactly matches a dir-list.
function findPipeShape(dirs: number[]): number {
  const key = [...new Set(dirs)].sort().join(",");
  return PIPE_SHAPES.findIndex((s) => [...s.conn].sort().join(",") === key);
}

// Remove a tile at (x,y), refunding the bin. Returns true if something was removed.
function removeTileAt(x: number, y: number): boolean {
  const row = state.grid[y];
  const t = row?.[x];
  if (!t || t.fixed) return false;
  state.bin[t.type] = (state.bin[t.type] ?? 0) + 1;
  if (row) row[x] = null;
  if (state.selected && state.selected.x === x && state.selected.y === y) state.selected = null;
  return true;
}

// Place the current tool at (x,y). If fromDir is given and tool is wire,
// pick a shape whose connections include fromDir (i.e. connects back to the
// previous cell in a drag). Returns true if placement happened.
function placeToolAt(x: number, y: number, fromDir: number | null): boolean {
  if (!state.tool) return false;
  const row = state.grid[y];
  if (!row) return false;
  const existing = row[x];
  if (existing && existing.fixed) return false;

  if (state.tool === "pipe") {
    // Wire: build or extend a pipe so it connects to fromDir (if given).
    let conns: number[] = [];
    if (existing && existing.type === "pipe") {
      conns = [...(PIPE_SHAPES[existing.shape] ?? DEFAULT_PIPE).conn];
    }
    if (fromDir != null && !conns.includes(fromDir)) {
      conns.push(fromDir);
    }
    if (conns.length === 0) {
      // Fresh place with no drag context: use currently-selected shape.
      conns = [...(PIPE_SHAPES[state.toolPipeShape] ?? DEFAULT_PIPE).conn];
    }
    if (conns.length === 1) {
      // A single stub: promote to straight so signal can pass through.
      const d = conns[0];
      if (d != null) conns.push(OPP(d));
    }
    const shapeIdx = findPipeShape(conns);
    if (shapeIdx < 0) return false;
    // Refund any existing non-pipe tile first
    if (existing && existing.type !== "pipe") {
      state.bin[existing.type] = (state.bin[existing.type] ?? 0) + 1;
    }
    // Only debit bin when adding a new pipe (not when upgrading an existing one).
    if (!existing || existing.type !== "pipe") {
      if ((state.bin.pipe ?? 0) <= 0) return false;
      state.bin.pipe = (state.bin.pipe ?? 1) - 1;
    }
    row[x] = makeTile("pipe", { shape: shapeIdx });
    return true;
  }

  // Non-wire tools: one-shot placement per cell.
  if ((state.bin[state.tool] ?? 0) <= 0) return false;
  if (existing && existing.type === state.tool) return false; // nothing to do
  if (existing && !existing.fixed) {
    state.bin[existing.type] = (state.bin[existing.type] ?? 0) + 1;
  }
  row[x] = makeTile(state.tool);
  state.bin[state.tool] = (state.bin[state.tool] ?? 1) - 1;
  return true;
}

// Drag state
const drag = { active: false, button: -1, last: null as Cell | null, placed: false };

function dirFromTo(from: Cell, to: Cell): number | null {
  if (to.x === from.x && to.y === from.y - 1) return N;
  if (to.x === from.x + 1 && to.y === from.y) return E;
  if (to.x === from.x && to.y === from.y + 1) return S;
  if (to.x === from.x - 1 && to.y === from.y) return W;
  return null;
}

// Walk a Bresenham-ish path of 4-connected cells from a→b so fast mouse
// movement does not skip over cells.
function walkCells(a: Cell, b: Cell): Cell[] {
  const path: Cell[] = [];
  let x = a.x,
    y = a.y;
  while (x !== b.x || y !== b.y) {
    const dx = b.x - x,
      dy = b.y - y;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) x += Math.sign(dx);
    else if (dy !== 0) y += Math.sign(dy);
    else break;
    path.push({ x, y });
  }
  return path;
}

board.addEventListener("mousedown", (ev) => {
  const c = cellFromMouse(ev);
  if (!c) return;
  drag.active = true;
  drag.button = ev.button;
  drag.last = c;
  drag.placed = false;
  handleDragCell(c, null, ev.button);
});

board.addEventListener("mousemove", (ev) => {
  if (!drag.active) return;
  const c = cellFromMouse(ev);
  if (!c) return;
  const last = drag.last;
  if (!last) return;
  if (c.x === last.x && c.y === last.y) return;
  const steps = walkCells(last, c);
  for (const step of steps) {
    const fromDir = dirFromTo(step, last); // side we came from, relative to new cell
    const toDir = dirFromTo(last, step); // side we went toward, relative to previous cell
    // Extend the previous cell so it connects to the step cell (wire only).
    if (state.tool === "pipe" && drag.button === 0 && toDir != null) {
      extendPipeAt(last.x, last.y, toDir);
    }
    handleDragCell(step, fromDir, drag.button);
    drag.last = step;
  }
});

function endDrag() {
  if (drag.active && drag.placed) {
    renderPalette();
    renderInspector();
    draw();
  }
  drag.active = false;
}
board.addEventListener("mouseup", endDrag);
board.addEventListener("mouseleave", endDrag);
window.addEventListener("blur", endDrag);

function extendPipeAt(x: number, y: number, dir: number) {
  const t = state.grid[y]?.[x];
  if (!t || t.type !== "pipe" || t.fixed) return;
  const conns = [...(PIPE_SHAPES[t.shape] ?? DEFAULT_PIPE).conn];
  if (conns.includes(dir)) return;
  conns.push(dir);
  const idx = findPipeShape(conns);
  if (idx >= 0) t.shape = idx;
}

function handleDragCell(c: Cell, fromDir: number | null, button: number) {
  const t = state.grid[c.y]?.[c.x];

  // Right-button drag: delete non-fixed tiles (pipes and gates both).
  if (button === 2) {
    if (t && !t.fixed) {
      if (removeTileAt(c.x, c.y)) {
        drag.placed = true;
        Audio.remove();
      }
    }
    return;
  }

  // Left-button on fixed tile: select it (for inspector).
  if (t && t.fixed) {
    state.selected = { x: c.x, y: c.y };
    renderInspector();
    draw();
    return;
  }

  if (state.tool && (state.bin[state.tool] ?? 0) >= 0) {
    if (placeToolAt(c.x, c.y, fromDir)) {
      state.selected = { x: c.x, y: c.y };
      drag.placed = true;
      Audio.place();
      // Immediate redraw for responsive drag feel
      renderPalette();
      renderInspector();
      draw();
    }
    return;
  }

  // No tool: just select whatever is there.
  state.selected = t ? { x: c.x, y: c.y } : null;
  renderInspector();
  draw();
}

// ---------------- Simulation ----------------
function spawnId() {
  return Math.random().toString(36).slice(2, 8);
}

function startRun() {
  if (state.running) return;
  resetSimState();
  state.running = true;
  state.status = "RUNNING";
  $("hud-status").textContent = state.status;
  Audio.boot();
  loop();
}

function resetSimState() {
  state.tick = 0;
  state.signals = [];
  state.holds = []; // delayed signals { x, y, dir, value, untilTick }
  resetSinks();
  // Clear emitted state on sources
  if (!state.level) return;
  state.level.fixed
    .filter((f): f is Source => f.kind === "source")
    .forEach((s) => {
      const t = state.grid[s.y]?.[s.x];
      if (!t) return;
      t._emittedIdx = 0;
      t._lastEmitTick = -999;
    });
  $("hud-tick").textContent = "000";
  renderGoals();
}

function stopRun() {
  state.running = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.status = "STOPPED";
  $("hud-status").textContent = state.status;
}

function loop() {
  if (!state.running) return;
  step();
  state.timer = setTimeout(loop, state.speedMs);
}

function step() {
  if (!state.level) return;
  state.tick++;
  state.lastTickAt = Date.now();
  $("hud-tick").textContent = String(state.tick).padStart(3, "0");

  // 1. Sources emit
  state.level.fixed
    .filter((f): f is Source => f.kind === "source")
    .forEach((s) => {
      const t = state.grid[s.y]?.[s.x];
      if (!t) return;
      const emittedIdx = t._emittedIdx ?? 0;
      const period = s.period || 3;
      const offset = s.offset || 0;
      const seq = s.seq || [];
      if (emittedIdx >= seq.length && !s.loop) return;
      if (state.tick - offset >= 0 && (state.tick - offset) % period === 0) {
        const v = seq[emittedIdx % seq.length];
        if (v === undefined) return;
        state.signals.push({
          id: spawnId(),
          x: s.x,
          y: s.y,
          dir: s.dir,
          value: v,
          born: state.tick,
          prevX: s.x,
          prevY: s.y,
        });
        t._emittedIdx = emittedIdx + 1;
        Audio.pulse(v);
        log(`TX (${s.x},${s.y}) → emit ${v} → ${DIR_NAMES[s.dir] ?? "?"}`, "info");
      }
    });

  // 2. Release delayed signals
  if (state.holds && state.holds.length) {
    const ready = state.holds.filter((h) => h.untilTick <= state.tick);
    state.holds = state.holds.filter((h) => h.untilTick > state.tick);
    ready.forEach((h) => {
      // Re-emit signal at the delay tile position with born=tick so the
      // standard "first move" branch advances it one cell forward.
      state.signals.push({
        id: spawnId(),
        x: h.x,
        y: h.y,
        dir: h.dir,
        value: h.value,
        born: state.tick,
        prevX: h.x,
        prevY: h.y,
      });
    });
  }

  // 3. Move every signal one cell forward and resolve what happens at the target tile.
  const newSignals: Signal[] = [];
  for (const sig of state.signals) {
    const nx = sig.x + (DX[sig.dir] ?? 0);
    const ny = sig.y + (DY[sig.dir] ?? 0);
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) {
      log(`✗ signal ${sig.value} fell off the grid at (${sig.x},${sig.y})`, "bad");
      Audio.hit();
      continue;
    }
    const tile = state.grid[ny]?.[nx];
    if (!tile) {
      log(`✗ signal ${sig.value} dissipated at (${nx},${ny})`, "bad");
      Audio.hit();
      continue;
    }
    handleEnter(tile, sig, nx, ny, sig.dir, newSignals);
  }
  state.signals = newSignals;

  // 4. Render & check
  renderGoals();
  draw();
  Audio.tick();

  // 5. Win/lose check
  checkComplete();

  // 6. Tick-limit
  if (state.tick >= (state.level.tickLimit || 200)) {
    if (state.running) {
      stopRun();
      state.status = "TIMEOUT";
      $("hud-status").textContent = state.status;
      log("⏱ tick limit reached. Press RESET to retry.", "warn");
    }
  }
}

function handleEnter(
  tile: Tile,
  sig: Signal,
  nx: number,
  ny: number,
  travelDir: number,
  outArr: Signal[]
) {
  // Sink: absorb
  if (tile.type === "sink") {
    const k = nx + "," + ny;
    if (!state.results[k]) state.results[k] = [];
    state.results[k].push(sig.value);
    log(`★ RX (${nx},${ny}) ← ${sig.value}`, "good");
    Audio.pulse(sig.value);
    return;
  }
  // Source on entry: ignore (signals from other paths just get absorbed)
  if (tile.type === "source" || tile.type === "wall") {
    log(`✗ signal ${sig.value} blocked at ${tile.type} (${nx},${ny})`, "bad");
    Audio.hit();
    return;
  }
  // Filter
  if (tile.type === "filt") {
    const ok = evalCond(sig.value, tile.op, tile.n);
    if (!ok) {
      log(`⩤ FILT (${nx},${ny}) drops ${sig.value}`, "warn");
      return;
    }
    // pass through straight
    advance(tile, sig.value, nx, ny, travelDir, outArr, sig);
    return;
  }
  // Delay: hold for n ticks, then release into the cell after this one
  if (tile.type === "delay") {
    state.holds.push({
      x: nx,
      y: ny,
      dir: travelDir,
      value: sig.value,
      untilTick: state.tick + (tile.n || 1),
    });
    log(`⏲ DELAY (${nx},${ny}) holds ${sig.value} for ${tile.n}t`, "info");
    return;
  }
  // AMP/MUL/Router transform value first
  let val = sig.value;
  if (tile.type === "amp") val = val + (tile.n || 0);
  if (tile.type === "mul") val = val * (tile.n || 1);
  // Determine exits
  const exits = tileExits(tile, travelDir, val);
  if (exits.length === 0) {
    log(`✗ signal ${val} stuck at ${tile.type} (${nx},${ny})`, "bad");
    Audio.hit();
    return;
  }
  exits.forEach((d) => {
    outArr.push({
      id: spawnId(),
      x: nx,
      y: ny,
      dir: d,
      value: val,
      born: state.tick - 1, // already on grid this tick
      prevX: sig.x,
      prevY: sig.y,
    });
  });
  if (tile.type === "amp") log(`＋AMP (${nx},${ny}) ${sig.value} → ${val}`, "info");
  if (tile.type === "mul") log(`✕MUL (${nx},${ny}) ${sig.value} → ${val}`, "info");
  if (tile.type === "router") {
    const cond = evalCond(val, tile.op, tile.n);
    const exit0 = exits[0];
    log(
      `⟚ROUTER (${nx},${ny}) ${val} ${tile.op}${tile.n}=${cond ? "T" : "F"} → ${DIR_NAMES[exit0 ?? 0] ?? "?"}`,
      "info"
    );
  }
}

function advance(
  tile: Tile,
  val: number,
  nx: number,
  ny: number,
  travelDir: number,
  outArr: Signal[],
  sig: Signal
) {
  const exits = tileExits(tile, travelDir, val);
  if (exits.length === 0) {
    log(`✗ signal ${val} stuck at filter (${nx},${ny})`, "bad");
    Audio.hit();
    return;
  }
  exits.forEach((d) => {
    outArr.push({
      id: spawnId(),
      x: nx,
      y: ny,
      dir: d,
      value: val,
      born: state.tick - 1,
      prevX: sig.x,
      prevY: sig.y,
    });
  });
}

function checkComplete() {
  if (!state.level) return;
  const sinks = state.level.fixed.filter((f): f is Sink => f.kind === "sink");
  const allDone = sinks.every((s) => arraysEq(state.results[s.x + "," + s.y] ?? [], s.expected));
  // overflow check (received more than expected -> fail this attempt)
  const overflow = sinks.some((s) => {
    const got = state.results[s.x + "," + s.y] ?? [];
    if (got.length > s.expected.length) return true;
    for (let i = 0; i < got.length; i++) if (got[i] !== s.expected[i]) return true;
    return false;
  });
  if (overflow && state.running) {
    stopRun();
    state.status = "MISMATCH";
    $("hud-status").textContent = state.status;
    log("✗ Sink received wrong value. Press RESET to retry.", "bad");
    Audio.bad();
    return;
  }
  if (allDone) {
    if (state.running) stopRun();
    state.status = "SOLVED";
    $("hud-status").textContent = state.status;
    if (state.level) {
      state.solved.add(state.level.id);
      saveProgress();
      Audio.win();
      showDialog("SIGNAL LOCKED ✓", state.level.win || "Level complete.");
    }
    renderLevelList();
  }
}

// ---------------- Dialog ----------------
function showDialog(title: string, body: string) {
  $("dialog-title").textContent = title;
  $("dialog-body").textContent = body;
  $("dialog").classList.remove("hidden");
}
$("dialog-close").onclick = () => {
  $("dialog").classList.add("hidden");
  Audio.click();
  // auto-advance to next level
  if (state.status === "SOLVED" && state.levelIdx < LEVELS.length - 1) {
    loadLevel(state.levelIdx + 1);
  }
};

// ---------------- Log ----------------
function log(text: string, cls = "") {
  const el = $("log");
  const d = document.createElement("div");
  d.className = "log-line " + cls;
  d.textContent = `[${String(state.tick).padStart(3, "0")}] ${text}`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
  while (el.childElementCount > 80) el.firstChild?.remove();
}
function clearLog() {
  $("log").innerHTML = "";
}

// ---------------- Drawing ----------------
function draw() {
  const w = board.width,
    h = board.height;
  ctx.fillStyle = "#03060a";
  ctx.fillRect(0, 0, w, h);

  // Grid background
  ctx.strokeStyle = "#0e1a24";
  ctx.lineWidth = 1;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const px = PADDING + x * CELL;
      const py = PADDING + y * CELL;
      ctx.fillStyle = (x + y) & 1 ? "#06101a" : "#04090f";
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = "#0c1822";
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
    }
  }

  // Tiles
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const t = state.grid[y]?.[x];
      if (!t) continue;
      drawTile(x, y, t);
    }
  }

  // Hover preview (if tool selected)
  // (not implemented for simplicity)

  // Selected highlight
  if (state.selected) {
    const px = PADDING + state.selected.x * CELL;
    const py = PADDING + state.selected.y * CELL;
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
  }

  // Held (delayed) signals rendered on the delay tile
  (state.holds || []).forEach((h) => drawHeldSignal(h));

  // Signals
  state.signals.forEach((s) => drawSignal(s));
}

function drawHeldSignal(h: Hold) {
  const px = PADDING + h.x * CELL + CELL / 2;
  const py = PADDING + h.y * CELL + CELL / 2;
  const pulse = (Math.sin(Date.now() / 160) + 1) / 2;
  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#a06bff";
  ctx.fillStyle = `rgba(200, 150, 255, ${0.35 + pulse * 0.5})`;
  ctx.beginPath();
  ctx.arc(px, py - 14, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawCenterText(px, py - 22, String(h.value), "#cfa6ff", 10);
}

function drawTile(x: number, y: number, t: Tile) {
  const px = PADDING + x * CELL;
  const py = PADDING + y * CELL;
  const cx = px + CELL / 2,
    cy = py + CELL / 2;

  if (t.type === "wall") {
    ctx.fillStyle = "#1a2530";
    ctx.fillRect(px + 4, py + 4, CELL - 8, CELL - 8);
    ctx.strokeStyle = "#2a3848";
    ctx.lineWidth = 1;
    for (let i = -CELL; i < CELL; i += 6) {
      ctx.beginPath();
      ctx.moveTo(px + 4 + i, py + 4);
      ctx.lineTo(px + 4 + i + CELL - 8, py + CELL - 4);
      ctx.stroke();
    }
    ctx.strokeStyle = "#3a4858";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 4, py + 4, CELL - 8, CELL - 8);
    return;
  }

  if (t.type === "source") {
    drawNeonRect(px, py, "#ffb347", "#3a2a10");
    drawArrow(cx, cy, t.dir, "#ffb347");
    drawCenterText(cx, cy + CELL / 3 - 4, "TX", "#ffb347", 9);
    return;
  }

  if (t.type === "sink") {
    drawNeonRect(px, py, "#5cffa1", "#0e2818");
    // target rings
    ctx.strokeStyle = "#5cffa1";
    for (let r = 6; r <= CELL / 2 - 6; r += 6) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawCenterText(cx, cy + CELL / 3 - 4, "RX", "#5cffa1", 9);
    return;
  }

  if (t.type === "pipe") {
    drawPipe(x, y, t);
    return;
  }

  // Gates
  drawGateBody(px, py, t);
  drawGateConnections(x, y, t);
  drawGateLabel(cx, cy, t);
}

function drawNeonRect(px: number, py: number, color: string, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  ctx.strokeRect(px + 3.5, py + 3.5, CELL - 7, CELL - 7);
  ctx.shadowBlur = 0;
}

function drawArrow(cx: number, cy: number, dir: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.fillStyle = color;
  ctx.shadowBlur = 6;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(7, 4);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawCenterText(cx: number, cy: number, text: string, color: string, size = 10) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}

function drawPipe(x: number, y: number, t: Tile) {
  const px = PADDING + x * CELL;
  const py = PADDING + y * CELL;
  const cx = px + CELL / 2,
    cy = py + CELL / 2;
  const conns = (PIPE_SHAPES[t.shape] ?? DEFAULT_PIPE).conn;
  // Background
  ctx.fillStyle = "#06101a";
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  // Pipe body
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1a2c3e";
  conns.forEach((d) => {
    const tx = cx + ((DX[d] ?? 0) * CELL) / 2;
    const ty = cy + ((DY[d] ?? 0) * CELL) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  });
  // Inner glow
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#00ffd0";
  ctx.shadowBlur = 6;
  ctx.shadowColor = "#00ffd0";
  conns.forEach((d) => {
    const tx = cx + ((DX[d] ?? 0) * CELL) / 2;
    const ty = cy + ((DY[d] ?? 0) * CELL) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  // hub
  ctx.fillStyle = "#00ffd0";
  ctx.beginPath();
  ctx.arc(cx, cy, conns.length === 4 ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawGateBody(px: number, py: number, t: Tile) {
  const colorMap: Record<string, string> = {
    amp: "#ff2bd6",
    mul: "#ffaa00",
    filt: "#00b3ff",
    delay: "#a06bff",
    router: "#00ffaa",
  };
  const color = colorMap[t.type] ?? "#ffffff";
  ctx.fillStyle = "#08121b";
  ctx.fillRect(px + 5, py + 5, CELL - 10, CELL - 10);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  ctx.strokeRect(px + 5.5, py + 5.5, CELL - 11, CELL - 11);
  ctx.shadowBlur = 0;
}

function drawGateConnections(x: number, y: number, t: Tile) {
  const px = PADDING + x * CELL;
  const py = PADDING + y * CELL;
  const cx = px + CELL / 2,
    cy = py + CELL / 2;
  const conns = tileConnections(t) ?? [];
  ctx.strokeStyle = "#1a2c3e";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  conns.forEach((d) => {
    const tx = cx + ((DX[d] ?? 0) * CELL) / 2;
    const ty = cy + ((DY[d] ?? 0) * CELL) / 2;
    ctx.beginPath();
    ctx.moveTo(cx + (DX[d] ?? 0) * 8, cy + (DY[d] ?? 0) * 8);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  });
  ctx.strokeStyle = "#5d7a93";
  ctx.lineWidth = 2;
  conns.forEach((d) => {
    const tx = cx + ((DX[d] ?? 0) * CELL) / 2;
    const ty = cy + ((DY[d] ?? 0) * CELL) / 2;
    ctx.beginPath();
    ctx.moveTo(cx + (DX[d] ?? 0) * 8, cy + (DY[d] ?? 0) * 8);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  });
}

function drawGateLabel(cx: number, cy: number, t: Tile) {
  let label = "?";
  let sub = "";
  const colorMap: Record<string, string> = {
    amp: "#ff2bd6",
    mul: "#ffaa00",
    filt: "#00b3ff",
    delay: "#a06bff",
    router: "#00ffaa",
  };
  if (t.type === "amp") {
    label = "＋";
    sub = (t.n >= 0 ? "+" : "") + t.n;
  }
  if (t.type === "mul") {
    label = "✕";
    sub = "×" + t.n;
  }
  if (t.type === "filt") {
    label = "⩤";
    sub = t.op + t.n;
  }
  if (t.type === "delay") {
    label = "⏲";
    sub = t.n + "t";
  }
  if (t.type === "router") {
    label = "⟚";
    sub = t.op + t.n;
  }
  drawCenterText(cx, cy - 4, label, colorMap[t.type] ?? "#fff", 18);
  drawCenterText(cx, cy + 12, sub, colorMap[t.type] ?? "#fff", 9);
}

function drawSignal(s: Signal) {
  // Interpolate smoothly between previous and current tile based on time since last tick.
  let t = 0;
  if (state.running && state.lastTickAt) {
    const elapsed = Date.now() - state.lastTickAt;
    t = Math.max(0, Math.min(1, elapsed / state.speedMs));
  }
  const prevX = s.prevX;
  const prevY = s.prevY;
  const ix = prevX + (s.x - prevX) * t;
  const iy = prevY + (s.y - prevY) * t;
  const px = PADDING + ix * CELL + CELL / 2;
  const py = PADDING + iy * CELL + CELL / 2;
  const glow = 0.6 + 0.4 * Math.sin(Date.now() / 120);
  ctx.save();
  ctx.shadowBlur = 18 * glow;
  ctx.shadowColor = "#fff700";
  ctx.fillStyle = "#fff700";
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawCenterText(px, py - 14, String(s.value), "#fff700", 11);
}

// Animate signals smoothly
let _rafHandle = 0;
function rafLoop() {
  draw();
  _rafHandle = requestAnimationFrame(rafLoop);
}

// ---------------- Buttons ----------------
$("btn-run").onclick = () => {
  Audio.click();
  startRun();
};
$("btn-step").onclick = () => {
  if (state.running) return;
  if (state.tick === 0) resetSimState();
  Audio.click();
  step();
};
$("btn-stop").onclick = () => {
  Audio.click();
  stopRun();
};
$("btn-reset").onclick = () => {
  Audio.click();
  stopRun();
  resetSimState();
  state.status = "IDLE";
  $("hud-status").textContent = "IDLE";
  clearLog();
  draw();
};
$("btn-clear").onclick = () => {
  Audio.click();
  // restore all non-fixed tiles to bin
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const t = state.grid[y]?.[x];
      if (t && !t.fixed) {
        state.bin[t.type] = (state.bin[t.type] ?? 0) + 1;
        const row = state.grid[y];
        if (row) row[x] = null;
      }
    }
  state.selected = null;
  resetSimState();
  state.status = "IDLE";
  $("hud-status").textContent = state.status;
  renderPalette();
  renderInspector();
  clearLog();
  draw();
};
$("speed").oninput = (e) => {
  const target = e.target as HTMLInputElement | null;
  const v = parseInt(target?.value ?? "0", 10);
  state.speedMs = Math.round(550 - v * 25);
};

// ---------------- Boot sequence ----------------
const bootLines: string[] = [
  "> initializing SIGNAL/OS v0.59 ...",
  "> loading carrier wave .................. [OK]",
  "> calibrating wire impedance ............ [OK]",
  "> handshaking with cosmic background .... [OK]",
  "> dispatching welcome packet ............ [OK]",
  "",
  "   ╔══════════════════════════════════════╗",
  "   ║   SIGNAL — a programmable puzzler   ║",
  "   ║   ldjam59  //  theme: SIGNAL         ║",
  "   ╚══════════════════════════════════════╝",
  "",
  "> press any key to begin transmission ...",
];

function bootScreen() {
  const el = $("boot-text");
  let idx = 0;
  let line = "";
  let charIdx = 0;
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    Audio.boot();
    $("boot").classList.add("fade");
    setTimeout(() => {
      const b = document.getElementById("boot");
      if (b) b.remove();
    }, 1000);
  }
  document.addEventListener("keydown", dismiss);
  document.addEventListener("mousedown", dismiss);
  function tick() {
    if (dismissed) return;
    if (idx >= bootLines.length) {
      el.textContent = el.textContent?.replace(/\u2588$/, "") ?? "";
      el.textContent += "\n\n▌";
      return;
    }
    const currentLine = bootLines[idx];
    if (charIdx === 0 && (currentLine?.length ?? 0) === 0) {
      el.textContent += "\n";
      idx++;
      setTimeout(tick, 40);
      return;
    }
    line = currentLine ?? "";
    el.textContent =
      (el.textContent?.replace(/\u2588$/, "") ?? "") + line.charAt(charIdx) + "\u2588";
    charIdx++;
    if (charIdx >= line.length) {
      el.textContent = el.textContent?.replace(/\u2588$/, "\n") ?? "";
      idx++;
      charIdx = 0;
      setTimeout(tick, 40);
    } else {
      setTimeout(tick, 10);
    }
  }
  tick();
}

// ---------------- Keyboard ----------------
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
  const k = e.key.toLowerCase();
  if (k === " ") {
    e.preventDefault();
    if (state.running) stopRun();
    else startRun();
  } else if (k === "r") {
    stopRun();
    resetSimState();
    state.status = "IDLE";
    $("hud-status").textContent = state.status;
    clearLog();
    draw();
    Audio.click();
  } else if (k === "s") {
    if (state.running) return;
    if (state.tick === 0) resetSimState();
    step();
    Audio.click();
  } else if (k === "escape") {
    state.selected = null;
    renderInspector();
    draw();
  } else if (k === "[" || k === "]") {
    if (state.tool === "pipe") {
      const dir = k === "]" ? 1 : -1;
      state.toolPipeShape = (state.toolPipeShape + dir + PIPE_SHAPES.length) % PIPE_SHAPES.length;
      renderPalette();
      draw();
    }
  } else if (k >= "1" && k <= "6") {
    const idx = parseInt(k, 10) - 1;
    const p = PALETTE_DEFS[idx];
    if (p && (state.bin[p.key] ?? 0) > 0) {
      state.tool = p.key;
      renderPalette();
      draw();
    }
  }
});

// ---------------- Init ----------------
function init() {
  loadLevel(0);
  rafLoop();
  bootScreen();
}

/** Stop the RAF loop and release the simulation timer on route teardown. */
export function destroy(): void {
  cancelAnimationFrame(_rafHandle);
  _rafHandle = 0;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

init();
