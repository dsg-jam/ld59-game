// @ts-nocheck
import { blip } from "$lib/audio";

interface Character { name: string; emoji: string; }
interface Call { from: string; to: string; note: string; at: number; }
interface Level { title: string; subtitle: string; duration: number; chars: string[]; calls: Call[]; goal: number; }
interface Ticket { id: number; from: string; to: string; note: string; done: boolean; }
interface DialogueLine { s: string; t: string; }
interface GameState {
  levelIdx: number;
  score: number;
  chaos: number;
  timeLeft: number;
  lastTick: number;
  runTotal: { score: number; chaos: number };
  tickets: Ticket[];
  nextCallIdx: number;
  selected: string | null;
  dlgOpen: boolean;
  timerHandle: number | null;
  levelActive: boolean;
  completed: number;
  goal: number;
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}
/* ============================================================
   SIGNAL CROSS  —  LDJAM59
   A switchboard puzzle where you route calls between eccentric
   characters.  Correct = points.  Crossed wires = chaos bonus
   (and a funny conversation neither party asked for).
   ============================================================ */

/* ----------  Characters  ---------- */
const CHARS: Record<string, Character> = {
  mom:       { name: "Mom",           emoji: "👩" },
  butcher:   { name: "The Butcher",   emoji: "🔪" },
  mayor:     { name: "Mayor Pibbley", emoji: "🎩" },
  quack:     { name: "Dr. Quackers",  emoji: "🦆" },
  spy:       { name: "Agent Nimbus",  emoji: "🕶️" },
  elvis:     { name: "Elvis?",        emoji: "🎸" },
  moon:      { name: "The Moon",      emoji: "🌙" },
  henderson: { name: "Mrs. H.",       emoji: "👵" },
  ghost:     { name: "Ghost Line",    emoji: "👻" },
  traveler:  { name: "Time Traveler", emoji: "⏳" },
  pope:      { name: "The Pope",      emoji: "⛪" },
  dog:       { name: "Tired Dog",     emoji: "🐕" },
};

/* ----------  Levels  ---------- */
const LEVELS: Level[] = [
  {
    title: "FIRST SHIFT",
    subtitle: "Tuesday. 7:02pm. Everyone wants the butcher.",
    duration: 70,
    chars: ["mom", "butcher", "mayor", "quack", "henderson", "dog"],
    calls: [
      { from: "henderson", to: "butcher", note: "re: pot roast",         at: 0.5 },
      { from: "mayor",     to: "quack",   note: "re: the duck situation", at: 8 },
      { from: "mom",       to: "dog",     note: "good boy check",         at: 18 },
    ],
    goal: 2,
  },
  {
    title: "RUSH HOUR",
    subtitle: "Everyone wants to talk. Nobody wants to wait.",
    duration: 85,
    chars: ["mom", "butcher", "mayor", "quack", "spy", "elvis", "henderson", "dog"],
    calls: [
      { from: "henderson", to: "mayor",   note: "a complaint",       at: 0.5 },
      { from: "spy",       to: "mom",     note: "URGENT",             at: 6 },
      { from: "elvis",     to: "quack",   note: "it's for the pet",   at: 14 },
      { from: "butcher",   to: "henderson", note: "return call",      at: 24 },
      { from: "mayor",     to: "spy",     note: "off the record",     at: 36 },
    ],
    goal: 4,
  },
  {
    title: "GRAVEYARD SHIFT",
    subtitle: "After midnight, the signals get… weird.",
    duration: 100,
    chars: ["mom", "butcher", "mayor", "quack", "spy", "elvis", "moon", "henderson", "ghost", "traveler", "pope", "dog"],
    calls: [
      { from: "ghost",     to: "henderson", note: "unfinished business", at: 0.5 },
      { from: "moon",      to: "pope",      note: "theological query",   at: 10 },
      { from: "traveler",  to: "mayor",     note: "don't eat the clams", at: 20 },
      { from: "elvis",     to: "mom",       note: "yes, THAT Elvis",     at: 30 },
      { from: "dog",       to: "butcher",   note: "woof" ,               at: 42 },
      { from: "spy",       to: "ghost",     note: "classified",          at: 54 },
      { from: "pope",      to: "quack",     note: "the swan is ill",     at: 68 },
    ],
    goal: 5,
  },
];

/* ----------  Dialogue lines  ----------
   Key format for correct: `${from}>${to}`
   Key format for misconnect: `${from}>${actual}!${expected}`  (expected can be dropped → generic)
   Each exchange is an array of { s, t } where s is speaker id.
*/

const CORRECT = {
  "henderson>butcher": [
    { s: "henderson", t: "Marty dear, quick question about the pot roast." },
    { s: "butcher",   t: "Three-twenty-five, ma'am. Three hours. Like I told you Sunday." },
    { s: "henderson", t: "And Tuesday. And Thursday." },
    { s: "butcher",   t: "…I know." },
  ],
  "mayor>quack": [
    { s: "mayor", t: "Doctor, the ducks in the fountain are… organizing." },
    { s: "quack", t: "Organizing how, exactly?" },
    { s: "mayor", t: "They have a flag now." },
    { s: "quack", t: "I'll bring the net." },
  ],
  "mom>dog": [
    { s: "mom", t: "Who's a good boy??" },
    { s: "dog", t: "…" },
    { s: "dog", t: "(tail thumping audible through the receiver)" },
    { s: "mom", t: "I KNEW IT." },
  ],
  "henderson>mayor": [
    { s: "henderson", t: "Mayor. The streetlight on my corner is buzzing." },
    { s: "mayor",     t: "I'll send someone first thing." },
    { s: "henderson", t: "Also your hair looks different in the paper." },
    { s: "mayor",     t: "…thank you, Edna." },
  ],
  "spy>mom": [
    { s: "spy", t: "Mother. The package is delivered." },
    { s: "mom", t: "Derek honey did you eat today." },
    { s: "spy", t: "Negative. I am behind enemy lines." },
    { s: "mom", t: "There's soup in the freezer." },
  ],
  "elvis>quack": [
    { s: "elvis", t: "Doc, my hound dog's been cryin' all the time." },
    { s: "quack", t: "Sir, is this — are you Elv—" },
    { s: "elvis", t: "Thank you. Thank you very much." },
  ],
  "butcher>henderson": [
    { s: "butcher",   t: "Edna. Returning your call about the roast." },
    { s: "henderson", t: "Oh Marty I ALREADY BURNED IT." },
    { s: "butcher",   t: "…I'll bring another one." },
  ],
  "mayor>spy": [
    { s: "mayor", t: "Agent. We need to talk. Off the record." },
    { s: "spy",   t: "This line is NOT secure, Mayor." },
    { s: "mayor", t: "It's fine, the operator doesn't list—" },
    { s: "spy",   t: "…hi, operator." },
  ],
  "ghost>henderson": [
    { s: "ghost",     t: "EEEEDDDNNAAAaaaa……" },
    { s: "henderson", t: "Carl?? Carl is that you??" },
    { s: "ghost",     t: "YES EDNA. IT IS ME. FROM BEYOND." },
    { s: "henderson", t: "You still owe me twelve dollars, CARL." },
  ],
  "moon>pope": [
    { s: "moon", t: "Your Holiness. Quick one: am I in the Bible." },
    { s: "pope", t: "…you are referenced, yes." },
    { s: "moon", t: "Favorably?" },
    { s: "pope", t: "We… we don't rank." },
  ],
  "traveler>mayor": [
    { s: "traveler", t: "Mayor. From October. DO NOT eat the clams at the gala." },
    { s: "mayor",    t: "What gala?" },
    { s: "traveler", t: "The one where you eat the clams." },
    { s: "mayor",    t: "Understood." },
  ],
  "elvis>mom": [
    { s: "elvis", t: "Ma'am. Are you missin' a son who sings a little." },
    { s: "mom",   t: "…Derek is that YOU—" },
    { s: "elvis", t: "No ma'am. Wrong number. But bless you." },
    { s: "mom",   t: "*sobbing quietly*" },
  ],
  "dog>butcher": [
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "…how did you dial." },
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "I'll be right over with the scraps." },
  ],
  "spy>ghost": [
    { s: "spy",   t: "Asset ZERO, confirm status." },
    { s: "ghost", t: "I HAVE BEEN DEAD FOR FORTY YEARS." },
    { s: "spy",   t: "Confirmed asset status: stable." },
  ],
  "pope>quack": [
    { s: "pope",  t: "Doctor. The basilica swan appears unwell." },
    { s: "quack", t: "How unwell, exactly?" },
    { s: "pope",  t: "She hissed at a cardinal." },
    { s: "quack", t: "That's just swans." },
  ],
};

/* Misconnects — specific funny ones (key: `from>actual`) */
const WRONG = {
  "henderson>ghost": [
    { s: "henderson", t: "Marty?? Marty the connection is AWFUL." },
    { s: "ghost",     t: "ooooooOOOOOoooo……" },
    { s: "henderson", t: "Oh. Oh hello Carl." },
    { s: "ghost",     t: "Edna." },
    { s: "henderson", t: "Carl you still owe me twelve dollars." },
  ],
  "moon>quack": [
    { s: "moon",  t: "Doctor. The tides are acting up." },
    { s: "quack", t: "Ma'am this is a veterinary line." },
    { s: "moon",  t: "I KNOW." },
  ],
  "elvis>pope": [
    { s: "elvis", t: "Doc I got a hound dog situation—" },
    { s: "pope",  t: "My son, this is the Holy See." },
    { s: "elvis", t: "Oh. Well. Thank you, thank you very much, Your Holiness." },
    { s: "pope",  t: "…may your hound find peace." },
  ],
  "spy>mom": [
    { s: "spy", t: "Contact. This is Nimbus. Package in motion." },
    { s: "mom", t: "Derek did you call your AUNT yet." },
    { s: "spy", t: "…abort. Abort." },
  ],
  "mayor>henderson": [
    { s: "mayor",     t: "Chief, I need that report on my desk by—" },
    { s: "henderson", t: "MAYOR PIBBLEY your tie was CROOKED on the news." },
    { s: "mayor",     t: "Operator!! OPERATOR!!" },
  ],
  "traveler>butcher": [
    { s: "traveler", t: "Mayor. DO NOT eat the clams at the gala." },
    { s: "butcher",  t: "Pal this is a meat counter." },
    { s: "traveler", t: "Then also: do not stock clams next Thursday." },
    { s: "butcher",  t: "…noted." },
  ],
  "ghost>butcher": [
    { s: "ghost",   t: "FLLLEEESSSHHH……" },
    { s: "butcher", t: "Sir we're closed." },
    { s: "ghost",   t: "FLESH?????" },
    { s: "butcher", t: "Tuesday special is chuck roast." },
  ],
  "dog>mom": [
    { s: "dog", t: "Woof." },
    { s: "mom", t: "AWW WHO IS THIS GOOD BOY." },
    { s: "dog", t: "Woof woof." },
    { s: "mom", t: "I'M COMING OVER." },
  ],
  "pope>butcher": [
    { s: "pope",    t: "Doctor, the swan—" },
    { s: "butcher", t: "We got swan in Tuesday." },
    { s: "pope",    t: "WE DO NOT." },
  ],
  "moon>mom": [
    { s: "moon", t: "Hello. I'm the Moon." },
    { s: "mom",  t: "Derek if this is a prank call—" },
    { s: "moon", t: "It is not, ma'am. It's the Moon." },
    { s: "mom",  t: "Are you eating." },
  ],
  "henderson>quack": [
    { s: "henderson", t: "Marty about the pot roast—" },
    { s: "quack",     t: "This is Dr. Quackers, ma'am." },
    { s: "henderson", t: "…can I braise a duck." },
    { s: "quack",     t: "NO." },
  ],
  "elvis>henderson": [
    { s: "elvis",     t: "Ma'am I got a situation with a hound dog." },
    { s: "henderson", t: "Oh dear. Marty! MARTY! It's that singer!" },
    { s: "elvis",     t: "Ma'am I just need a vet." },
    { s: "henderson", t: "Marty's on his way." },
  ],
  "spy>elvis": [
    { s: "spy",   t: "Contact ZULU. Extract protocol." },
    { s: "elvis", t: "Partner I don't know who Zulu is but I'm in." },
    { s: "spy",   t: "…who is this." },
    { s: "elvis", t: "The King, baby." },
  ],
};

/* Generic fallback misconnect lines (the "oh no wrong number" template) */
const WRONG_FALLBACK_A = [
  "Hello? [EXPECT]?",
  "Is this [EXPECT]?",
  "[EXPECT], is that you?",
  "Put [EXPECT] on.",
  "This is about [EXPECT].",
];
const WRONG_FALLBACK_B = [
  "No, this is [ACTUAL].",
  "Wrong line, pal. This is [ACTUAL].",
  "Negative. [ACTUAL] speaking.",
  "You've got [ACTUAL]. Who is this?",
  "[ACTUAL] here. Who are you calling for?",
];
const WRONG_FALLBACK_C = [
  "…right. Sorry. Put me back.",
  "Nevermind. Operator!",
  "Forget I called.",
  "Hello? Wait no. Hang up.",
  "This is that operator's fault, isn't it.",
];

/* ----------  State  ---------- */
const state: GameState = {
  levelIdx: 0,
  score: 0,
  chaos: 0,
  timeLeft: 0,
  lastTick: 0,
  runTotal: { score: 0, chaos: 0 },
  tickets: [],
  nextCallIdx: 0,
  selected: null,
  dlgOpen: false,
  timerHandle: null,
  levelActive: false,
  completed: 0,
  goal: 0,
};

/* ----------  Audio (synth beeps)  ---------- */
function beep(freq, dur = 0.08, type = "square", vol = 0.06) {
  blip(freq, dur, type as OscillatorType, vol);
}
function sfxRing()       { beep(880, 0.12); setTimeout(() => beep(880, 0.12), 180); }
function sfxSelect()     { beep(660, 0.05); }
function sfxConnect()    { beep(523, 0.06); setTimeout(() => beep(784, 0.10), 70); }
function sfxWrong()      { beep(220, 0.15, "sawtooth", 0.07); setTimeout(() => beep(180, 0.18, "sawtooth", 0.07), 120); }
function sfxChaos()      { beep(300, 0.08, "square"); setTimeout(() => beep(450, 0.08), 70); setTimeout(() => beep(250, 0.14, "sawtooth"), 140); }
function sfxTick()       { beep(1200, 0.02, "square", 0.03); }

/* ----------  DOM refs  ---------- */
const $ = <T extends HTMLElement>(id: string): T => getEl<T>(id);
const titleScreen = $("title-screen");
const gameScreen  = $("game-screen");
const endScreen   = $("end-screen");
const board       = $("board");
const queueEl     = $("queue");
const cableLayer  = $("cable-layer");
const floaterLayer= $("floater-layer");
const dlgEl       = $("dialogue");
const dlgA        = $("dlg-a");
const dlgB        = $("dlg-b");
const dlgLines    = $("dlg-lines");
const dlgNext     = $("dlg-next");

function showScreen(el) {
  [titleScreen, gameScreen, endScreen].forEach(s => s.classList.remove("active"));
  el.classList.add("active");
}

/* ----------  Start / title  ---------- */
function unlockAudio() {
  try {
    const ctx = ac();
    if (ctx.state === "suspended") ctx.resume();
    // warm up one silent beep
    beep(1, 0.001, "sine", 0.0001);
  } catch (e) {}
}

$("start-btn").addEventListener("click", () => {
  unlockAudio();
  state.levelIdx = 0;
  state.runTotal = { score: 0, chaos: 0 };
  startLevel(0);
});
$("next-btn").addEventListener("click", () => {
  if (state.levelIdx + 1 >= LEVELS.length) {
    state.levelIdx = 0;
    state.runTotal = { score: 0, chaos: 0 };
    showScreen(titleScreen);
  } else {
    startLevel(state.levelIdx + 1);
  }
});
$("replay-btn").addEventListener("click", () => {
  startLevel(state.levelIdx);
});

/* ----------  Level start  ---------- */
function startLevel(idx) {
  const lvl = LEVELS[idx];
  state.levelIdx = idx;
  state.score = 0;
  state.chaos = 0;
  state.timeLeft = lvl.duration;
  state.lastTick = performance.now();
  state.tickets = [];
  state.nextCallIdx = 0;
  state.selected = null;
  state.dlgOpen = false;
  state.levelActive = true;
  state.completed = 0;
  state.goal = lvl.goal;

  $("level-num").textContent = idx + 1;
  updateHUD();

  renderBoard();
  queueEl.innerHTML = "";
  clearCables();

  showScreen(gameScreen);
  if (state.timerHandle) cancelAnimationFrame(state.timerHandle);
  loop();
}

/* ----------  Board render  ---------- */
function renderBoard() {
  const lvl = LEVELS[state.levelIdx];
  board.innerHTML = "";
  const n = lvl.chars.length;
  const cols = n <= 6 ? 3 : n <= 8 ? 4 : n <= 9 ? 3 : n <= 12 ? 4 : 4;
  board.style.gridTemplateColumns = `repeat(${cols}, 100px)`;

  lvl.chars.forEach(id => {
    const c = CHARS[id];
    const el = document.createElement("div");
    el.className = "plug";
    el.dataset.id = id;
    const ringing = state.tickets.some(t => t.from === id && !t.done);
    if (ringing) el.classList.add("ringing");
    if (state.selected === id) el.classList.add("selected");
    el.innerHTML = `
      <div class="bulb"></div>
      <div class="jack"></div>
      <div class="emoji">${c.emoji}</div>
      <div class="name">${c.name}</div>
    `;
    el.addEventListener("click", () => onPlugClick(id));
    board.appendChild(el);
  });
}

/* ----------  Queue render  ---------- */
function renderTicket(ticket) {
  const from = CHARS[ticket.from];
  const to = CHARS[ticket.to];
  const el = document.createElement("div");
  el.className = "ticket";
  if (ticket === state.tickets.find(t => !t.done)) el.classList.add("active");
  el.dataset.id = ticket.id;
  el.innerHTML = `
    <span class="num">#${String(ticket.id).padStart(3,"0")}</span>
    <div class="from"><span class="emoji">${from.emoji}</span>FROM: ${from.name}</div>
    <div class="arrow">&nbsp;│ WANTS ▼</div>
    <div class="to"><span class="emoji">${to.emoji}</span>${to.name}</div>
    <div class="note">${ticket.note || ""}</div>
    <div class="stub"></div>
  `;
  return el;
}

function refreshQueue() {
  queueEl.innerHTML = "";
  state.tickets.filter(t => !t.done).forEach(t => queueEl.appendChild(renderTicket(t)));
}

/* ----------  Tickets  ---------- */
let _nextTicketId = 1;
function spawnTicket(call) {
  const t = {
    id: _nextTicketId++,
    from: call.from,
    to: call.to,
    note: call.note,
    done: false,
  };
  state.tickets.push(t);
  refreshQueue();
  renderBoard();
  sfxRing();
}

/* ----------  Plug click logic  ---------- */
function onPlugClick(id) {
  if (state.dlgOpen || !state.levelActive) return;
  if (state.selected && state.selected !== id) {
    const fromId = state.selected;
    state.selected = null;
    resolveConnection(fromId, id);
    return;
  }
  if (state.selected === id) {
    state.selected = null;
    renderBoard();
    return;
  }
  const ticket = state.tickets.find(t => t.from === id && !t.done);
  if (!ticket) {
    sfxWrong();
    floater("NOT RINGING", plugRect(id), "miss");
    return;
  }
  state.selected = id;
  sfxSelect();
  renderBoard();
}

function resolveConnection(fromId, toId) {
  const ticket = state.tickets.find(t => t.from === fromId && !t.done);
  if (!ticket) return;
  if (fromId === toId) return; // can't connect to self
  const correct = ticket.to === toId;
  ticket.done = true;

  drawCable(fromId, toId, correct);
  if (correct) sfxConnect(); else sfxChaos();

  const exchange = getExchange(fromId, toId, ticket.to);
  showDialogue(fromId, toId, exchange, () => {
    clearCables();
    if (correct) {
      state.score += 10;
      state.completed += 1;
      floater("+10 ROUTED", plugRect(toId), "score");
    } else {
      state.chaos += 15;
      floater("+15 CHAOS!", plugRect(toId), "chaos");
    }
    updateHUD();
    refreshQueue();
    renderBoard();
    checkLevelEnd();
  });
}

/* ----------  Dialogue  ---------- */
let _dlgLines = [];
let _dlgIdx = 0;
let _dlgCb = null;

function getExchange(fromId, actualId, expectedId) {
  if (fromId === actualId) return null; // shouldn't happen
  const correct = actualId === expectedId;
  if (correct) {
    const key = `${fromId}>${actualId}`;
    if (CORRECT[key]) return CORRECT[key];
    // fallback correct
    return [
      { s: fromId, t: `Hello, ${CHARS[actualId].name}?` },
      { s: actualId, t: `Speaking.` },
      { s: fromId, t: `I'll keep this brief.` },
    ];
  }
  // wrong
  const key = `${fromId}>${actualId}`;
  if (WRONG[key]) return WRONG[key];
  // generic crossed-wire
  const expectName = CHARS[expectedId].name;
  const actualName = CHARS[actualId].name;
  const a = pick(WRONG_FALLBACK_A).replace("[EXPECT]", expectName);
  const b = pick(WRONG_FALLBACK_B).replace("[ACTUAL]", actualName);
  const c = pick(WRONG_FALLBACK_C);
  return [
    { s: fromId,   t: a },
    { s: actualId, t: b },
    { s: fromId,   t: c },
    { s: "sys",    t: `(the operator frowns, visibly.)` },
  ];
}

function showDialogue(fromId, toId, lines, cb) {
  state.dlgOpen = true;
  _dlgLines = lines.slice();
  _dlgIdx = 0;
  _dlgCb = cb;
  dlgA.textContent = CHARS[fromId].emoji;
  dlgB.textContent = CHARS[toId].emoji;
  dlgLines.innerHTML = "";
  dlgEl.classList.remove("hidden");
  pushNextLine();
}

function pushNextLine() {
  if (_dlgIdx >= _dlgLines.length) {
    dlgNext.textContent = "HANG UP ▸";
    return;
  }
  const line = _dlgLines[_dlgIdx++];
  const div = document.createElement("div");
  div.className = "line" + (line.s === "sys" ? " system" : "");
  const speakerName = line.s === "sys" ? "" : (CHARS[line.s]?.name || line.s);
  div.innerHTML = `<span class="speaker">${speakerName}${line.s !== "sys" ? ":" : ""}</span> ${line.t}`;
  dlgLines.appendChild(div);
  beep(line.s === "sys" ? 600 : 900 - Math.random() * 300, 0.03, "square", 0.03);
  dlgLines.scrollTop = dlgLines.scrollHeight;

  if (_dlgIdx >= _dlgLines.length) dlgNext.textContent = "HANG UP ▸";
  else dlgNext.textContent = "NEXT ▸";
}

dlgNext.addEventListener("click", () => {
  if (_dlgIdx < _dlgLines.length) {
    pushNextLine();
  } else {
    closeDialogue();
  }
});
document.addEventListener("keydown", (e) => {
  if (state.dlgOpen && (e.key === "Enter" || e.key === " " || e.key === "Escape")) {
    e.preventDefault();
    if (e.key === "Escape") {
      while (_dlgIdx < _dlgLines.length) pushNextLine();
      closeDialogue();
    } else if (_dlgIdx < _dlgLines.length) {
      pushNextLine();
    } else {
      closeDialogue();
    }
  }
});

function closeDialogue() {
  dlgEl.classList.add("hidden");
  state.dlgOpen = false;
  const cb = _dlgCb;
  _dlgCb = null;
  if (cb) cb();
}

/* ----------  Cables  ---------- */
function plugRect(id) {
  const el = board.querySelector(`[data-id="${id}"]`);
  if (!el) return { x: 0, y: 0, w: 0, h: 0 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

function drawCable(fromId, toId, correct) {
  const a = plugRect(fromId);
  const b = plugRect(toId);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <path d="M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${Math.max(a.y,b.y)+80}, ${b.x} ${b.y}"
            stroke="${correct ? '#6fe07a' : '#ff5a4e'}"
            stroke-width="6" fill="none" stroke-linecap="round" opacity="0.85" />
      <circle cx="${a.x}" cy="${a.y}" r="7" fill="${correct ? '#6fe07a' : '#ff5a4e'}" />
      <circle cx="${b.x}" cy="${b.y}" r="7" fill="${correct ? '#6fe07a' : '#ff5a4e'}" />
    </svg>
  `;
  cableLayer.innerHTML = svg;
}
function clearCables() { cableLayer.innerHTML = ""; }

/* ----------  Floaters  ---------- */
function floater(text, rect, kind = "score") {
  const el = document.createElement("div");
  el.className = `floater ${kind}`;
  el.textContent = text;
  el.style.left = (rect.x) + "px";
  el.style.top = (rect.y - 20) + "px";
  el.style.transform = "translate(-50%, 0)";
  floaterLayer.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ----------  HUD  ---------- */
function updateHUD() {
  $("score-val").textContent = state.score;
  $("chaos-val").textContent = state.chaos;
  $("goal-val").textContent = `${state.completed} / ${state.goal}`;
  const lvl = LEVELS[state.levelIdx];
  const pct = Math.max(0, state.timeLeft / lvl.duration) * 100;
  $("timer-fill").style.width = pct + "%";
}

/* ----------  Loop ---------- */
function loop() {
  state.timerHandle = requestAnimationFrame(loop);
  if (!state.levelActive) return;
  const now = performance.now();
  const dt = (now - state.lastTick) / 1000;
  state.lastTick = now;
  if (!state.dlgOpen) {
    state.timeLeft -= dt;
    // Spawn scheduled calls
    const lvl = LEVELS[state.levelIdx];
    const elapsed = lvl.duration - state.timeLeft;
    while (state.nextCallIdx < lvl.calls.length && lvl.calls[state.nextCallIdx].at <= elapsed) {
      spawnTicket(lvl.calls[state.nextCallIdx]);
      state.nextCallIdx++;
    }
    if (Math.floor(state.timeLeft) !== Math.floor(state.timeLeft + dt)) {
      if (state.timeLeft < 10 && state.timeLeft > 0) sfxTick();
    }
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      endLevel();
    }
  }
  updateHUD();
}

/* ----------  Level end  ---------- */
function checkLevelEnd() {
  const lvl = LEVELS[state.levelIdx];
  const allSpawned = state.nextCallIdx >= lvl.calls.length;
  const allDone = state.tickets.every(t => t.done);
  if (allSpawned && allDone) {
    // Bonus for time left
    const timeBonus = Math.floor(state.timeLeft) * 2;
    if (timeBonus > 0) {
      state.score += timeBonus;
      floater(`+${timeBonus} TIME`, { x: window.innerWidth/2, y: 120 }, "score");
    }
    setTimeout(endLevel, 500);
  }
}

function endLevel() {
  if (!state.levelActive) return;
  state.levelActive = false;
  if (state.timerHandle) cancelAnimationFrame(state.timerHandle);
  state.runTotal.score += state.score;
  state.runTotal.chaos += state.chaos;

  const lvl = LEVELS[state.levelIdx];
  const passed = state.completed >= lvl.goal;
  const lastLevel = state.levelIdx + 1 >= LEVELS.length;

  $("end-title").textContent = passed
    ? (lastLevel ? "SHIFT COMPLETE • PUNCH OUT" : `${lvl.title} • CLEARED`)
    : `${lvl.title} • SUPERVISOR DISAPPOINTED`;

  $("end-blurb").textContent = passed
    ? (lastLevel ? "The board goes dark. You earned every cent."
                 : lvl.subtitle)
    : `You needed ${lvl.goal} correct routes. You got ${state.completed}.`;

  $("end-score").textContent  = state.score;
  $("end-chaos").textContent  = state.chaos;
  $("end-total").textContent  = state.score + state.chaos;

  $("next-btn").style.display = passed ? "" : "none";
  $("replay-btn").textContent = passed ? "REPLAY SHIFT" : "TRY AGAIN";
  if (passed && lastLevel) $("next-btn").textContent = "NEW GAME ▸";
  else if (passed) $("next-btn").textContent = "NEXT SHIFT ▸";

  showScreen(endScreen);
}

/* ----------  Utils  ---------- */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ----------  Hide screens on load  ---------- */
showScreen(titleScreen);
