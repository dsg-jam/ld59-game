// Legacy game logic migrated from JavaScript; keep no-check until this file is incrementally typed.
import Peer from "peerjs";
import type { DataConnection } from "peerjs";

/* ---- Type definitions ---- */
type CharDef = { name: string; emoji: string };
type DialogLine = { s: string; t: string };
type Slip = { slipNum: string; callerName: string; line: string; requestId: string; requestName: string; dirty: boolean; flagged: boolean };
type AgencyQuestion = { text: string; choices: { label: string; tag: unknown }[]; correctIdx: number };
type Connection = { byPlayer: string; actualTo: string; correct: boolean; lines: DialogLine[]; lineIdx: number; nextLineAt: number; completed: boolean; completedAt: number | null };
type Ticket = { id: number; kind?: string; from: string; to: string | null; note: string; status: string; ringingSince: number; ringDurationMs: number; timeoutAt: number; connection: Connection | null; slip: Slip | null; approval: string; reviewer: string | null; agencyQ?: AgencyQuestion; agencyPickedBy?: string | null };
type Player = { id: string; name: string; color: string; cables: number; maxCables: number; selected: string | null };
type LogEntry = { ticketId: number; from: string; actual: string; intended: string; byPlayer: string; correct: boolean; lines: DialogLine[]; status: string; result: string | null };
type CallDef = { from: string; to: string; note: string; at: number };
type LevelDef = { title: string; subtitle: string; duration: number; ringTimeoutSec: number; lineIntervalMs: number; chars: string[]; calls: CallDef[]; goal: number; restricted: string[] };
type NetObj = {
  peer: InstanceType<typeof Peer> | null;
  isHost: boolean; myId: string | null; myName: string; myColor: string; roomCode: string | null;
  hostConn: DataConnection | null; clientConns: Map<string, DataConnection>;
  onMessage: ((peerId: string, data: unknown) => void) | null;
  onClientConnect: ((conn: DataConnection) => void) | null;
  onClientDisconnect: ((peerId: string) => void) | null;
  status(msg: string, kind?: string): void;
  host(name: string, onReady?: () => void): void;
  _tryHost(onReady?: () => void, attempt?: number): void;
  join(code: string, name: string, onReady?: () => void): void;
  broadcast(msg: unknown): void;
  sendToHost(msg: unknown): void;
  leave(): void;
};
type GameState = {
  phase: string; levelIdx: number; timeLeft: number; duration: number; goal: number;
  nextCallIdx: number; teamScore: number; teamChaos: number; teamPenalty: number;
  correctCount: number; players: Player[]; tickets: Ticket[]; log: LogEntry[];
  levelTitle: string; levelSubtitle: string; gameMode: string; supervisorId: string | null;
  _timeoutCount?: number; _agencyNextAt?: number;
};


/* ============================================================
   SIGNAL CROSS — LDJAM59  (co-op, multiplayer via PeerJS)
   ============================================================
   - One player HOSTS (authoritative state + loop).
   - Others JOIN via room code.
   - TEAM SCORE is shared.
   - Each operator has a personal pool of CABLES (default 3).
     To answer a ringing call you spend one of your cables to
     plug the caller into a recipient.  The cable stays in
     place.  Dialogue streams into the shared Call Log, line
     by line, in real time.
   - YOU MUST READ.  When the conversation naturally ends
     (look for the closing line), click a plug (or the cable)
     to disconnect.  Your cable returns to you.
   - Disconnect TOO EARLY — while the parties are still
     talking — and the crew takes a penalty.
   - Let a ring go unanswered too long, also a penalty.
   - Correct routing = team score.  Crossed wires = smaller
     chaos bonus, still funny.
   ============================================================ */

/* ---------- Characters ---------- */
const CHARS: Record<string, CharDef> = {
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
  agency:    { name: "The Agency",    emoji: "🕴" },
};

/* ---------- Levels ---------- */
const LEVELS: LevelDef[] = [
  {
    title: "FIRST SHIFT",
    subtitle: "Tuesday. 7:02pm. The board will not wait.",
    duration: 95,
    ringTimeoutSec: 20,
    lineIntervalMs: 1500,
    chars: ["mom","butcher","mayor","quack","henderson","dog"],
    calls: [
      { from: "henderson", to: "butcher",   note: "re: pot roast",          at: 1 },
      { from: "mayor",     to: "quack",     note: "re: the duck situation", at: 8 },
      { from: "mom",       to: "dog",       note: "good boy check",         at: 18 },
      { from: "butcher",   to: "henderson", note: "return call",            at: 26 },
      { from: "quack",     to: "mom",       note: "vet bill",               at: 38 },
      { from: "dog",       to: "butcher",   note: "scraps plz",             at: 52 },
      { from: "henderson", to: "quack",     note: "bird advice",            at: 66 },
    ],
    goal: 5,
    restricted: [],
  },
  {
    title: "RUSH HOUR",
    subtitle: "Everyone wants to talk. Nobody wants to wait.",
    duration: 135,
    ringTimeoutSec: 16,
    lineIntervalMs: 1300,
    chars: ["mom","butcher","mayor","quack","spy","elvis","henderson","dog"],
    calls: [
      { from: "henderson", to: "mayor",     note: "a complaint",        at: 1 },
      { from: "spy",       to: "mom",       note: "URGENT",             at: 8 },
      { from: "elvis",     to: "quack",     note: "it's for the pet",   at: 16 },
      { from: "butcher",   to: "henderson", note: "return call",        at: 22 },
      { from: "mayor",     to: "spy",       note: "off the record",     at: 32 },
      { from: "dog",       to: "mom",       note: "woof",               at: 42 },
      { from: "quack",     to: "butcher",   note: "re: scraps",         at: 54 },
      { from: "henderson", to: "butcher",   note: "ANOTHER roast",      at: 66 },
      { from: "elvis",     to: "mom",       note: "wrong ma?",          at: 80 },
      { from: "spy",       to: "mayor",     note: "abort abort",        at: 94 },
      { from: "mom",       to: "dog",       note: "dinner time",        at: 108 },
    ],
    goal: 8,
    restricted: ["spy"],
  },
  {
    title: "GRAVEYARD SHIFT",
    subtitle: "After midnight, the signals get… weird.",
    duration: 165,
    ringTimeoutSec: 13,
    lineIntervalMs: 1100,
    chars: ["mom","butcher","mayor","quack","spy","elvis","moon","henderson","ghost","traveler","pope","dog"],
    calls: [
      { from: "ghost",     to: "henderson", note: "unfinished business", at: 1 },
      { from: "moon",      to: "pope",      note: "theological query",   at: 8 },
      { from: "traveler",  to: "mayor",     note: "don't eat the clams", at: 16 },
      { from: "elvis",     to: "mom",       note: "yes, THAT Elvis",     at: 24 },
      { from: "dog",       to: "butcher",   note: "woof",                at: 34 },
      { from: "spy",       to: "ghost",     note: "classified",          at: 44 },
      { from: "pope",      to: "quack",     note: "the swan is ill",     at: 54 },
      { from: "henderson", to: "mayor",     note: "another complaint",   at: 66 },
      { from: "ghost",     to: "spy",       note: "message from beyond", at: 80 },
      { from: "moon",      to: "mom",       note: "are you eating",      at: 94 },
      { from: "traveler",  to: "butcher",   note: "clams again",         at: 108 },
      { from: "elvis",     to: "henderson", note: "hound help",          at: 122 },
      { from: "pope",      to: "moon",      note: "correction",          at: 136 },
    ],
    goal: 10,
    restricted: ["ghost","spy","moon"],
  },
];

/* ---------- Dialogue: correct routes ---------- */
const CORRECT: Record<string, DialogLine[]> = {
  "henderson>butcher": [
    { s: "henderson", t: "Marty dear, quick question about the pot roast." },
    { s: "butcher",   t: "Three-twenty-five, ma'am. Three hours. Like Sunday." },
    { s: "henderson", t: "And Tuesday. And Thursday." },
    { s: "butcher",   t: "…I know. Goodbye, Edna." },
    { s: "henderson", t: "Goodbye, Marty." },
  ],
  "mayor>quack": [
    { s: "mayor", t: "Doctor, the ducks in the fountain are… organizing." },
    { s: "quack", t: "Organizing how, exactly?" },
    { s: "mayor", t: "They have a flag now." },
    { s: "quack", t: "I'll bring the net. Good day." },
  ],
  "mom>dog": [
    { s: "mom", t: "Who's a good boy??" },
    { s: "dog", t: "(tail thumping, audible)" },
    { s: "mom", t: "I KNEW IT. Mama loves you." },
    { s: "dog", t: "(one dignified woof)" },
  ],
  "butcher>henderson": [
    { s: "butcher",   t: "Edna. About that roast." },
    { s: "henderson", t: "Oh Marty I ALREADY BURNED IT." },
    { s: "butcher",   t: "…I'll bring another one. Goodbye." },
  ],
  "quack>mom": [
    { s: "quack", t: "Ma'am. About last month's bill for the bird." },
    { s: "mom",   t: "The bird is FINE now. You overcharged." },
    { s: "quack", t: "Ma'am I did surgery on a parakeet." },
    { s: "mom",   t: "Goodbye." },
  ],
  "henderson>mayor": [
    { s: "henderson", t: "Mayor, the streetlight on my corner is buzzing." },
    { s: "mayor",     t: "I'll send someone first thing." },
    { s: "henderson", t: "Also your tie was CROOKED on the news." },
    { s: "mayor",     t: "…noted. Good evening." },
  ],
  "spy>mom": [
    { s: "spy", t: "Mother. The package is delivered." },
    { s: "mom", t: "Derek honey did you eat today." },
    { s: "spy", t: "Negative. I am behind enemy lines." },
    { s: "mom", t: "There's soup in the freezer. Love you." },
    { s: "spy", t: "…copy that. Out." },
  ],
  "elvis>quack": [
    { s: "elvis", t: "Doc, my hound dog's been cryin' all the time." },
    { s: "quack", t: "Sir, are you — are you Elv—" },
    { s: "elvis", t: "Thank you. Thank you very much." },
    { s: "quack", t: "…have a good one, sir." },
  ],
  "mayor>spy": [
    { s: "mayor", t: "Agent. We need to talk. Off the record." },
    { s: "spy",   t: "This line is NOT secure, Mayor." },
    { s: "mayor", t: "It's fine, the operator doesn't list—" },
    { s: "spy",   t: "…hi, operator. Goodbye, Mayor." },
  ],
  "dog>mom": [
    { s: "dog", t: "Woof." },
    { s: "mom", t: "My boy!" },
    { s: "dog", t: "Woof woof." },
    { s: "mom", t: "I'll be right home." },
  ],
  "quack>butcher": [
    { s: "quack",   t: "Marty. I've got a duck that didn't make it." },
    { s: "butcher", t: "Say no more." },
    { s: "quack",   t: "I was about to say something else." },
    { s: "butcher", t: "Say no more. Goodbye." },
  ],
  "ghost>henderson": [
    { s: "ghost",     t: "EEEEDDDNNAAAaaaa……" },
    { s: "henderson", t: "Carl?? Carl is that you??" },
    { s: "ghost",     t: "YES EDNA. FROM BEYOND." },
    { s: "henderson", t: "You still owe me twelve dollars, CARL." },
    { s: "ghost",     t: "I KNOWWW……" },
    { s: "henderson", t: "Goodbye, Carl." },
  ],
  "moon>pope": [
    { s: "moon", t: "Your Holiness. Quick one: am I in the Bible." },
    { s: "pope", t: "…you are referenced, yes." },
    { s: "moon", t: "Favorably?" },
    { s: "pope", t: "We… we don't rank. Blessings upon you." },
    { s: "moon", t: "Good enough. Peace." },
  ],
  "traveler>mayor": [
    { s: "traveler", t: "Mayor. From October. DO NOT eat the clams at the gala." },
    { s: "mayor",    t: "What gala?" },
    { s: "traveler", t: "The one where you eat the clams." },
    { s: "mayor",    t: "Understood. Over." },
  ],
  "elvis>mom": [
    { s: "elvis", t: "Ma'am, are you missin' a son who sings a little." },
    { s: "mom",   t: "…Derek is that YOU—" },
    { s: "elvis", t: "No ma'am. Wrong number. But bless you. Goodnight." },
    { s: "mom",   t: "(sobbing quietly)" },
  ],
  "dog>butcher": [
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "…how did you dial." },
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "I'll be right over with scraps. Bye." },
  ],
  "spy>ghost": [
    { s: "spy",   t: "Asset ZERO, confirm status." },
    { s: "ghost", t: "I HAVE BEEN DEAD FOR FORTY YEARS." },
    { s: "spy",   t: "Confirmed: asset stable. Extract in 0300. Out." },
  ],
  "pope>quack": [
    { s: "pope",  t: "Doctor. The basilica swan appears unwell." },
    { s: "quack", t: "How unwell, exactly?" },
    { s: "pope",  t: "She hissed at a cardinal." },
    { s: "quack", t: "That's just swans. Bless you. Bye." },
  ],
};

/* ---------- Dialogue: misconnects ---------- */
const WRONG: Record<string, DialogLine[]> = {
  "henderson>ghost": [
    { s: "henderson", t: "Marty?? Connection is AWFUL." },
    { s: "ghost",     t: "ooooooOOOOOoooo……" },
    { s: "henderson", t: "Oh. Oh hello Carl." },
    { s: "henderson", t: "You still owe me twelve dollars." },
    { s: "ghost",     t: "gooodbyyye edddnaaa……" },
  ],
  "moon>quack": [
    { s: "moon",  t: "Doctor. The tides are acting up." },
    { s: "quack", t: "Ma'am this is a veterinary line." },
    { s: "moon",  t: "I KNOW." },
    { s: "quack", t: "Goodbye." },
  ],
  "elvis>pope": [
    { s: "elvis", t: "Doc I got a hound dog situation—" },
    { s: "pope",  t: "My son, this is the Holy See." },
    { s: "elvis", t: "Oh. Thank you, thank you very much, Your Holiness." },
    { s: "pope",  t: "…may your hound find peace. Go with God." },
  ],
  "spy>mom": [
    { s: "spy", t: "Contact. This is Nimbus. Package in motion." },
    { s: "mom", t: "Derek did you call your AUNT yet." },
    { s: "spy", t: "…abort. Abort. Out." },
  ],
  "mayor>henderson": [
    { s: "mayor",     t: "Chief, I need that report on my desk by—" },
    { s: "henderson", t: "MAYOR your tie was CROOKED on the news." },
    { s: "mayor",     t: "OPERATOR!! …goodbye." },
  ],
  "traveler>butcher": [
    { s: "traveler", t: "Mayor. DO NOT eat the clams at the gala." },
    { s: "butcher",  t: "Pal, this is a meat counter." },
    { s: "traveler", t: "Then also: do not stock clams next Thursday." },
    { s: "butcher",  t: "…noted. Bye." },
  ],
  "ghost>butcher": [
    { s: "ghost",   t: "FLLLEEESSSHHH……" },
    { s: "butcher", t: "Sir we're closed." },
    { s: "ghost",   t: "FLESH?????" },
    { s: "butcher", t: "Tuesday special is chuck roast. Good night." },
  ],
  "dog>mayor": [
    { s: "dog",   t: "Woof." },
    { s: "mayor", t: "Is this about the fountain ducks." },
    { s: "dog",   t: "Woof." },
    { s: "mayor", t: "It always is. Goodbye." },
  ],
  "pope>butcher": [
    { s: "pope",    t: "Doctor, the swan—" },
    { s: "butcher", t: "We got swan in Tuesday." },
    { s: "pope",    t: "WE DO NOT. Goodbye." },
  ],
  "moon>mom": [
    { s: "moon", t: "Hello. I'm the Moon." },
    { s: "mom",  t: "Derek if this is a prank—" },
    { s: "moon", t: "It is not, ma'am. It's the Moon." },
    { s: "mom",  t: "Are you eating." },
    { s: "moon", t: "…goodnight." },
  ],
  "henderson>quack": [
    { s: "henderson", t: "Marty about the pot roast—" },
    { s: "quack",     t: "This is Dr. Quackers, ma'am." },
    { s: "henderson", t: "…can I braise a duck." },
    { s: "quack",     t: "NO. Goodbye." },
  ],
  "elvis>henderson": [
    { s: "elvis",     t: "Ma'am, hound dog situation—" },
    { s: "henderson", t: "MARTY! It's that singer!" },
    { s: "elvis",     t: "I just need a vet, ma'am." },
    { s: "henderson", t: "Marty's on his way. Ta-ta." },
  ],
  "spy>elvis": [
    { s: "spy",   t: "Contact ZULU. Extract protocol." },
    { s: "elvis", t: "Partner I don't know who Zulu is but I'm in." },
    { s: "spy",   t: "…who is this." },
    { s: "elvis", t: "The King, baby. Out." },
  ],
  "spy>butcher": [
    { s: "spy",     t: "Transmission. Package frozen. Repeat — frozen." },
    { s: "butcher", t: "Pal we got a freezer sale." },
    { s: "spy",     t: "…the asset is a pork loin?" },
    { s: "butcher", t: "It can be. Buh-bye." },
  ],
};

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
  "…right. Sorry. Goodbye.",
  "Nevermind. Bye.",
  "Forget I called. Bye.",
  "Hello? Wait no. Goodbye.",
];

const CLOSERS = [
  "*click — line goes dead*",
  "*click — receiver set down*",
  "*tone — call ended*",
  "*click — both hung up*",
];

/* ---------- Colors assigned to players ---------- */
const PLAYER_COLORS = ["#68c6ff","#6fe07a","#ffd561","#ff8fc8","#c792ea","#7fe0c4","#ffae6c","#ff5a4e"];

/* ---------- Tunables ---------- */
const CABLES_PER_PLAYER = 2;
const LINE_INTERVAL_MS  = 1500;
const LINE_FIRST_DELAY  = 500;
const RING_TIMEOUT_MS   = 22000;   // baseline; overridden per level
const SCORE_CORRECT     = 10;
const SCORE_CHAOS       = 4;
const PENALTY_EARLY     = 22;
const PENALTY_TIMEOUT   = 16;
const PENALTY_TIMEOUT_STEP = 4;    // +4 per subsequent timeout this shift
const SCORE_DENY_RIGHT  = 14;
const PENALTY_DENY_WRONG = 14;
const PENALTY_APPROVE_BAD = 14;
const DIRTY_SLIP_CHANCE = 0.42;
const FORGED_NAME_CHANCE = 0.18;   // slip caller name lies (verify/supervisor)

/* Agency check-ins: operators are spies, Agency pops in to quiz them on past calls */
const AGENCY_FIRST_DELAY_SEC  = 45;
const AGENCY_MIN_INTERVAL_SEC = 38;
const AGENCY_MAX_INTERVAL_SEC = 65;
const AGENCY_TIMEOUT_MS       = 17000;
const SCORE_AGENCY            = 22;
const PENALTY_AGENCY          = 26;

/* ---------- Papers-Please helpers ---------- */
const PHONE_PREFIXES = ["KL5","MU6","AT3","EX1","HE4","PE9","RI2","OL7"];
function makePhone() {
  const p = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  return `${p}-${String(Math.floor(Math.random() * 10000)).padStart(4,"0")}`;
}
function makeSlip(call: CallDef, levelIdx: number) {
  const lvl = LEVELS[levelIdx];
  if (!lvl) return null;
  const restricted = lvl.restricted || [];
  const flagged = restricted.includes(call.from) || restricted.includes(call.to);
  const dirtyReq = Math.random() < DIRTY_SLIP_CHANCE;
  const forgedName = Math.random() < FORGED_NAME_CHANCE;
  const dirty = !flagged && (dirtyReq || forgedName);

  let requestId = call.to;
  if (dirtyReq) {
    const pool = lvl.chars.filter(c => c !== call.to && c !== call.from);
    if (pool.length) requestId = pool[Math.floor(Math.random() * pool.length)] ?? call.to;
  }
  let callerName = CHARS[call.from]?.name ?? call.from;
  if (forgedName) {
    const pool = lvl.chars.filter(c => c !== call.from);
    if (pool.length) callerName = CHARS[pool[Math.floor(Math.random() * pool.length)] ?? call.from]?.name ?? call.from;
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

/* ---------- Audio ---------- */
let audioCtx: AudioContext | null = null;
function ac() { if (!audioCtx) audioCtx = new AudioContext(); return audioCtx; }
function beep(f: number, d=0.08, type: OscillatorType="square", v=0.06) {
  try {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
    g.gain.setValueAtTime(v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + d);
  } catch { /* ignore */ }
}
const sfx = {
  ring:     () => { beep(880,0.12); setTimeout(()=>beep(880,0.12), 180); },
  select:   () => beep(660,0.05),
  connect:  () => { beep(523,0.06); setTimeout(()=>beep(784,0.10), 70); },
  chaos:    () => { beep(300,0.08); setTimeout(()=>beep(450,0.08), 70); setTimeout(()=>beep(250,0.14,"sawtooth"), 140); },
  penalty:  () => { beep(180,0.18,"sawtooth",0.08); setTimeout(()=>beep(130,0.24,"sawtooth",0.07), 160); },
  hangup:   () => { beep(440,0.05); setTimeout(()=>beep(330,0.09), 60); },
  line:     () => beep(720 + Math.random()*250, 0.02,"square",0.025),
  tick:     () => beep(1200,0.02,"square",0.03),
  denied:   () => beep(160,0.15,"triangle",0.05),
  stamp:    () => { beep(200,0.04,"square",0.08); setTimeout(()=>beep(90,0.12,"sawtooth",0.07), 50); },
  agency:   () => { beep(140,0.22,"triangle",0.09); setTimeout(()=>beep(180,0.22,"triangle",0.08), 240); setTimeout(()=>beep(110,0.30,"sawtooth",0.07), 500); },
};
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T; a[i] = a[j] as T; a[j] = tmp;
  }
  return a;
}
function unlockAudio() {
  try { const c = ac(); if (c.state === "suspended") c.resume(); beep(1,0.001,"sine",0.0001); } catch { /* ignore */ }
}
const $ = (id: string) => document.getElementById(id);
const screens: Record<string, HTMLElement | null> = {
  get title() { return $("title-screen"); },
  get lobby() { return $("lobby-screen"); },
  get game()  { return $("game-screen");  },
  get end()   { return $("end-screen");   },
};
function showScreen(name: string) {
  ["title","lobby","game","end"].forEach(k => {
    const el = screens[k];
    if (el) el.classList.remove("active");
  });
  const target = screens[name];
  if (target) target.classList.add("active");
}

/* ============================================================
   NETWORK LAYER
   ============================================================ */
const Net: NetObj = {
  peer: null,
  isHost: false,
  myId: null,
  myName: "",
  myColor: "",
  roomCode: null,
  hostConn: null,
  clientConns: new Map(),
  onMessage: null,
  onClientConnect: null,
  onClientDisconnect: null,
  status(msg: string, kind="") {
    const el = $("net-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "net-status " + kind;
  },

  host(name: string, onReady?: () => void) {
    this.isHost = true;
    this.myName = name;
    this._tryHost(onReady);
  },
  _tryHost(onReady?: () => void, attempt = 0) {
    const code = makeRoomCode();
    this.roomCode = code;
    this.peer = new Peer(code);
    this.peer.on("open", (id: string) => {
      this.myId = id;
      this.status("HOST READY — code: " + code, "ok");
      if (onReady) onReady();
    });
    this.peer.on("connection", (conn: DataConnection) => {
      this.clientConns.set(conn.peer, conn);
      conn.on("open", () => { if (this.onClientConnect) this.onClientConnect(conn); });
      conn.on("data", (data: unknown) => { if (this.onMessage) this.onMessage(conn.peer, data); });
      conn.on("close", () => {
        this.clientConns.delete(conn.peer);
        if (this.onClientDisconnect) this.onClientDisconnect(conn.peer);
      });
      conn.on("error", () => {
        this.clientConns.delete(conn.peer);
        if (this.onClientDisconnect) this.onClientDisconnect(conn.peer);
      });
    });
    this.peer.on("error", (err) => {
      if (err.type === "unavailable-id" && attempt < 4) {
        try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
        this._tryHost(onReady, attempt + 1);
      } else {
        this.status("HOST ERROR: " + err.type, "err");
      }
    });
  },

  join(code: string, name: string, onReady?: () => void) {
    this.isHost = false;
    this.myName = name;
    this.roomCode = code;
    this.peer = new Peer();
    this.peer.on("open", () => {
      if (!this.peer) return;
      this.myId = this.peer.id;
      const conn = this.peer.connect(code, { reliable: true, metadata: { name } });
      this.hostConn = conn;
      conn.on("open", () => {
        this.status("CONNECTED TO " + code, "ok");
        conn.send({ type: "hello", name });
        if (onReady) onReady();
      });
      conn.on("data", (data: unknown) => { if (this.onMessage) this.onMessage(code, data); });
      conn.on("close", () => {
        this.status("DISCONNECTED", "err");
        if (this.onClientDisconnect) this.onClientDisconnect(code);
      });
      conn.on("error", (err) => { this.status("JOIN ERROR: " + (err?.type || "unknown"), "err"); });
    });
    this.peer.on("error", (err) => { this.status("JOIN ERROR: " + err.type, "err"); });
  },

  broadcast(msg: unknown) {
    for (const conn of this.clientConns.values()) {
      if (conn.open) { try { conn.send(msg); } catch { /* ignore */ } }
    }
  },
  sendToHost(msg: unknown) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(msg); } catch { /* ignore */ } }
  },
  leave() {
    try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
    this.peer = null;
    this.hostConn = null;
    this.clientConns.clear();
    this.isHost = false;
    this.roomCode = null;
  },
};

function makeRoomCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "SIG-";
  for (let i = 0; i < 4; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

/* ============================================================
   STATE
   ============================================================ */
const state: GameState = {
  phase: "lobby",
  levelIdx: 0,
  timeLeft: 0,
  duration: 0,
  goal: 0,
  nextCallIdx: 0,
  teamScore: 0,
  teamChaos: 0,
  teamPenalty: 0,
  correctCount: 0,
  players: [],      // {id,name,color,cables,maxCables,selected}
  tickets: [],      // {id,from,to,note,status,ringingSince,timeoutAt,connection?,slip,approval,reviewer}
  log: [],          // {ticketId,from,actual,intended,byPlayer,correct,lines,status,result}
  levelTitle: "",
  levelSubtitle: "",
  gameMode: "classic",   // "classic" | "verify" | "supervisor"
  supervisorId: null,
};
let lobbyMode = "classic";
let lobbySupervisorId: string | null = null;
let slipModalTicketId: number | null = null;
let _nextTicketId = 1;
let lastTick = 0;
let timerHandle: number | null = null;
let _broadcastAccum = 0;

/* ---------- Reconciliation caches ---------- */
const plugEls = new Map();          // plugId -> element
const queueEls = new Map();         // "r"+ticketId / "l"+ticketId -> element
const opEls = new Map();            // playerId -> element
const logEls = new Map();           // ticketId -> element (+ .linesEl cached)
const cableEls = new Map();         // ticketId -> svg <g>
let renderedLevelIdx = -1;
let cableSvg: SVGElement | null = null;

/* ---------- Client timer interpolation anchors ---------- */
let snapTimeLeft = 0;      // last server-reported timeLeft
let snapTakenAt = 0;       // performance.now() when we received it

/* ---------- Utilities ---------- */
function myPlayer() { return state.players.find(p => p.id === Net.myId); }
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)] as T; }
function findLivePlug(plugId: string) {
  return state.tickets.find(t =>
    t.status === "live" && (t.from === plugId || t.connection?.actualTo === plugId)
  );
}
function isPlugBusy(plugId: string) {
  return !!findLivePlug(plugId);
}

/* ---------- Host: level lifecycle ---------- */
function hostStartLevel(idx: number) {
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
  state._timeoutCount = 0;
  state._agencyNextAt = Date.now() + AGENCY_FIRST_DELAY_SEC * 1000;
  state.gameMode = lobbyMode;
  // Validate supervisor choice
  if (state.gameMode === "supervisor") {
    const pickedExists = state.players.some(p => p.id === lobbySupervisorId);
    state.supervisorId = pickedExists ? lobbySupervisorId : (state.players[0]?.id || null);
  } else {
    state.supervisorId = null;
  }
  _nextTicketId = 1;
  state.players.forEach(p => {
    // Supervisor gets no cables in supervisor mode
    const isSupervisor = state.gameMode === "supervisor" && p.id === state.supervisorId;
    p.maxCables = isSupervisor ? 0 : CABLES_PER_PLAYER;
    p.cables = p.maxCables;
    p.selected = null;
  });
  resetRenderCaches();
  broadcastState();
  if (!timerHandle) { lastTick = performance.now(); loop(); }
}

function resetRenderCaches() {
  plugEls.clear();
  queueEls.clear();
  opEls.clear();
  logEls.clear();
  cableEls.clear();
  renderedLevelIdx = -1;
  cableSvg = null;
  const board = $("board");       if (board)  board.innerHTML = "";
  const queue = $("queue");       if (queue)  queue.innerHTML = "";
  const ops   = $("operators");   if (ops)    ops.innerHTML = "";
  const log   = $("log");         if (log)    log.innerHTML = "";
  const cl    = $("cable-layer"); if (cl)     cl.innerHTML = "";
}

function hostEndLevel() {
  // Clean up any lingering live calls as mid-call terminations (no penalty — timer ran out)
  state.tickets.forEach(t => {
    if (t.status === "live") t.status = "done";
  });
  state.phase = "ended";
  broadcastState();
}

function hostSpawnTicket(call: CallDef) {
  const now = Date.now();
  const slip = state.gameMode === "classic" ? null : makeSlip(call, state.levelIdx);
  const approval =
    state.gameMode === "classic" ? "none" :
    state.gameMode === "verify"  ? "pending" :
    /* supervisor */               "awaiting-stamp";
  const lvl = LEVELS[state.levelIdx];
  const ringMs = (lvl?.ringTimeoutSec ? lvl.ringTimeoutSec * 1000 : RING_TIMEOUT_MS);
  state.tickets.push({
    id: _nextTicketId++,
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
    reviewer: null,     // verify mode: player currently viewing slip
  });
  broadcastState();
  broadcastEvent({ type: "ring" });
}

/* ---------- Agency check-ins ---------- */
function hostSpawnAgency() {
  const q = buildAgencyQuestion();
  if (!q) return false;
  const now = Date.now();
  state.tickets.push({
    id: _nextTicketId++,
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

function buildAgencyQuestion() {
  const lvl = LEVELS[state.levelIdx];
  if (!lvl) return null;
  // Log is newest-first; include only completed entries with a result
  const ended = state.log.filter(e =>
    e.status === "ended" && (e.result === "routed" || e.result === "chaos" || e.result === "cut")
  );
  const types = shuffle(["whoSpokeTo","crossedCount","whoRoutedByOp","whoCutEarly","lastCallerTo"]);
  for (const t of types) {
    const q = _buildAgencyQ(t, ended, lvl);
    if (q) return q;
  }
  return null;
}

function _buildAgencyQ(type: string, ended: LogEntry[], lvl: LevelDef) {
  const pickChars = (except: string[], n: number) => {
    const pool = lvl.chars.filter(c => !except.includes(c) && c !== "agency");
    shuffle(pool);
    return pool.slice(0, n);
  };

  if (type === "whoSpokeTo") {
    // Ask about a caller who had a completed (not-cut) call
    const ref = ended.find(e => e.result !== "cut");
    if (!ref) return null;
    const callerId = ref.from, actualId = ref.actual;
    if (!CHARS[callerId] || !CHARS[actualId]) return null;
    const distractors = pickChars([callerId, actualId], 3);
    if (distractors.length < 2) return null;
    const choices = shuffle([actualId, ...distractors]).map(id => ({ label: CHARS[id]?.name ?? id, tag: id }));
    const correctIdx = choices.findIndex(c => c.tag === actualId);
    return {
      text: `"${CHARS[callerId]?.name.toUpperCase() ?? callerId} — who did you put them through to?"`,
      choices, correctIdx,
    };
  }

  if (type === "crossedCount") {
    const count = state.log.filter(e => e.status === "ended" && e.result === "chaos").length;
    const opts = new Set([count, Math.max(0, count - 1), count + 1, count + 2]);
    const arr = shuffle([...opts]).slice(0, 4);
    while (arr.length < 4) arr.push((arr[arr.length - 1] ?? 0) + 1);
    const choices = arr.map(n => ({ label: String(n), tag: n }));
    const correctIdx = choices.findIndex(c => c.tag === count);
    return {
      text: `"How many crossed wires slipped through tonight?"`,
      choices, correctIdx,
    };
  }

  if (type === "whoRoutedByOp") {
    // Pick an operator with at least one routed call
    const byOp = new Map();
    for (const e of ended) {
      if (e.result === "routed" && !byOp.has(e.byPlayer)) byOp.set(e.byPlayer, e);
    }
    if (!byOp.size) return null;
    const picks = [...byOp.entries()];
    const picked = picks[Math.floor(Math.random() * picks.length)];
    if (!picked) return null;
    const [opId, entry] = picked;
    const op = state.players.find(p => p.id === opId);
    if (!op) return null;
    const callerId = entry.from;
    if (!CHARS[callerId]) return null;
    const distractors = pickChars([callerId], 3);
    if (distractors.length < 2) return null;
    const choices = shuffle([callerId, ...distractors]).map(id => ({ label: CHARS[id]?.name ?? id, tag: id }));
    const correctIdx = choices.findIndex(c => c.tag === callerId);
    return {
      text: `"Operator ${op.name} — who was the last caller you routed?"`,
      choices, correctIdx,
    };
  }

  if (type === "whoCutEarly") {
    const cut = ended.find(e => e.result === "cut");
    if (!cut) return null;
    const actualId = cut.actual;
    if (!CHARS[actualId]) return null;
    const distractors = pickChars([actualId], 3);
    if (distractors.length < 2) return null;
    const choices = shuffle([actualId, ...distractors]).map(id => ({ label: CHARS[id]?.name ?? id, tag: id }));
    const correctIdx = choices.findIndex(c => c.tag === actualId);
    return {
      text: `"A line was CUT EARLY. Which recipient was mid-call?"`,
      choices, correctIdx,
    };
  }

  if (type === "lastCallerTo") {
    // Find the most recent completed call with a known actual, then ask "who called X?"
    const ref = ended.find(e => e.result !== "cut");
    if (!ref) return null;
    const actualId = ref.actual, callerId = ref.from;
    if (!CHARS[callerId]) return null;
    const distractors = pickChars([callerId, actualId], 3);
    if (distractors.length < 2) return null;
    const choices = shuffle([callerId, ...distractors]).map(id => ({ label: CHARS[id]?.name ?? id, tag: id }));
    const correctIdx = choices.findIndex(c => c.tag === callerId);
    return {
      text: `"Who most recently called ${CHARS[actualId]?.name.toUpperCase() ?? actualId}?"`,
      choices, correctIdx,
    };
  }

  return null;
}

/* ---------- Dialogue selection ---------- */
function getExchangeLines(fromId: string, actualId: string, expectedId: string): DialogLine[] {
  const correct = actualId === expectedId;
  const key = `${fromId}>${actualId}`;
  let base: DialogLine[];
  if (correct) {
    base = CORRECT[key] || [
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
      { s: fromId,   t: pick(WRONG_FALLBACK_A).replace("[EXPECT]", expectName) },
      { s: actualId, t: pick(WRONG_FALLBACK_B).replace("[ACTUAL]", actualName) },
      { s: fromId,   t: pick(WRONG_FALLBACK_C) },
    ];
  }
  return [...base, { s: "sys", t: pick(CLOSERS) }];
}

/* ---------- Host: handle actions ---------- */
function hostHandleAction(playerId: string | null, msg: Record<string, unknown>) {
  if (!playerId) return;
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (state.phase !== "playing") return;

  if (msg.type === "select") {
    if (p.selected) return;
    if (isPlugBusy(msg.plugId as string)) return;
    const other = state.players.find(x => x.selected === (msg.plugId as string));
    if (other) return;
    const ticket = state.tickets.find(t => t.from === msg.plugId && t.status === "ringing" && t.kind !== "agency");
    if (!ticket) return;
    if (p.cables <= 0) return;
    // Mode gating
    if (state.gameMode === "supervisor" && ticket.approval !== "approved") return;
    if (state.gameMode === "verify" && ticket.approval !== "approved") {
      // Selecting a not-yet-approved ticket opens review (reviewer = this player)
      if (ticket.reviewer && ticket.reviewer !== p.id) return;
      p.selected = msg.plugId as string | null;
      ticket.reviewer = p.id;
      broadcastState();
      return;
    }
    p.selected = msg.plugId as string | null;
    broadcastState();
  }

  else if (msg.type === "verifyDecision") {
    // Verify mode: player who selected the ticket submits a decision
    if (state.gameMode !== "verify") return;
    const ticket = state.tickets.find(t => t.id === msg.ticketId && t.status === "ringing");
    if (!ticket) return;
    if (ticket.reviewer !== p.id) return;
    if (msg.decision === "approve") {
      ticket.approval = "approved";
      ticket.reviewer = null;
      // Player already has selected = ticket.from; they now proceed to pick recipient
      // If they approved a flagged/dirty slip, penalize now.
      if (ticket.slip && (ticket.slip.dirty || ticket.slip.flagged)) {
        state.teamPenalty += PENALTY_APPROVE_BAD;
        broadcastEvent({ type: "badApprove", fromId: ticket.from });
      }
      broadcastState();
    } else if (msg.decision === "deny") {
      const correctDeny = !!(ticket.slip && (ticket.slip.dirty || ticket.slip.flagged));
      if (correctDeny) state.teamScore += SCORE_DENY_RIGHT;
      else state.teamPenalty += PENALTY_DENY_WRONG;
      ticket.status = "done";
      ticket.approval = "denied";
      ticket.reviewer = null;
      p.selected = null;
      broadcastEvent({ type: "denied", ticketId: ticket.id, fromId: ticket.from, correct: correctDeny });
      broadcastState();
    } else if (msg.decision === "cancel") {
      // Abandon review without a stamp
      ticket.reviewer = null;
      p.selected = null;
      broadcastState();
    }
  }

  else if (msg.type === "agencyAnswer") {
    const ticket = state.tickets.find(t => t.id === msg.ticketId && t.status === "ringing" && t.kind === "agency");
    if (!ticket) return;
    if (ticket.agencyPickedBy) return;
    ticket.agencyPickedBy = p.id;
    const correct = Number(msg.choiceIdx) === ticket.agencyQ?.correctIdx;
    if (correct) state.teamScore += SCORE_AGENCY;
    else state.teamPenalty += PENALTY_AGENCY;
    ticket.status = "done";
    broadcastEvent({
      type: correct ? "agencyCorrect" : "agencyWrong",
      score: correct ? SCORE_AGENCY : 0,
      penalty: correct ? 0 : PENALTY_AGENCY,
      operatorName: p.name,
    });
    broadcastState();
  }

  else if (msg.type === "stamp") {
    if (state.gameMode !== "supervisor") return;
    if (p.id !== state.supervisorId) return;
    const ticket = state.tickets.find(t => t.id === msg.ticketId && t.status === "ringing");
    if (!ticket) return;
    if (ticket.approval !== "awaiting-stamp") return;
    if (msg.decision === "approve") {
      ticket.approval = "approved";
      if (ticket.slip && (ticket.slip.dirty || ticket.slip.flagged)) {
        state.teamPenalty += PENALTY_APPROVE_BAD;
        broadcastEvent({ type: "badApprove", fromId: ticket.from });
      }
      broadcastEvent({ type: "stamp", approved: true });
      broadcastState();
    } else if (msg.decision === "deny") {
      const correctDeny = !!(ticket.slip && (ticket.slip.dirty || ticket.slip.flagged));
      if (correctDeny) state.teamScore += SCORE_DENY_RIGHT;
      else state.teamPenalty += PENALTY_DENY_WRONG;
      ticket.status = "done";
      ticket.approval = "denied";
      broadcastEvent({ type: "denied", ticketId: ticket.id, fromId: ticket.from, correct: correctDeny });
      broadcastEvent({ type: "stamp", approved: false });
      broadcastState();
    }
  }

  else if (msg.type === "deselect") {
    if (!p.selected) return;
    // Release verify-reviewer if this player was reviewing a pending ticket
    const reviewing = state.tickets.find(t => t.reviewer === p.id && t.approval === "pending");
    if (reviewing) reviewing.reviewer = null;
    p.selected = null;
    broadcastState();
  }

  else if (msg.type === "connect") {
    if (!p.selected) return;
    if (p.selected === msg.toId) return;
    if (p.cables <= 0) return;
    const ticket = state.tickets.find(t => t.from === p.selected && t.status === "ringing");
    if (!ticket) return;
    if (state.gameMode !== "classic" && ticket.approval !== "approved") return;
    if (isPlugBusy(msg.toId as string) || isPlugBusy(ticket.from)) return;

    const correct = ticket.to === (msg.toId as string);
    const lines = getExchangeLines(ticket.from, msg.toId as string, ticket.to ?? "");
    const now = Date.now();
    ticket.status = "live";
    ticket.connection = {
      byPlayer: p.id,
      actualTo: msg.toId as string,
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
      actual: msg.toId as string,
      intended: ticket.to ?? "",
      byPlayer: p.id,
      correct,
      lines: [],
      status: "streaming",
      result: null,
    });
    if (state.log.length > 30) state.log.length = 30;

    broadcastState();
    broadcastEvent({ type: "connect", byPlayer: p.id, fromId: ticket.from, toId: msg.toId, correct });
  }

  else if (msg.type === "disconnect") {
    const ticket = state.tickets.find(t => t.id === msg.ticketId && t.status === "live");
    if (!ticket) return;
    const conn = ticket.connection;
    if (!conn) return;
    const connector = state.players.find(x => x.id === conn.byPlayer);
    const entry = state.log.find(e => e.ticketId === ticket.id);

    if (!conn.completed) {
      // EARLY — penalty
      state.teamPenalty += PENALTY_EARLY;
      if (entry) { entry.status = "ended"; entry.result = "cut"; }
      broadcastEvent({ type: "disconnected", ticketId: ticket.id, fromId: ticket.from, toId: conn.actualTo, result: "cut" });
    } else {
      // Successful disconnect
      if (conn.correct) {
        state.teamScore += SCORE_CORRECT;
        state.correctCount += 1;
      } else {
        state.teamChaos += SCORE_CHAOS;
      }
      if (entry) { entry.status = "ended"; entry.result = conn.correct ? "routed" : "chaos"; }
      broadcastEvent({ type: "disconnected", ticketId: ticket.id, fromId: ticket.from, toId: conn.actualTo, result: conn.correct ? "routed" : "chaos" });
    }

    if (connector) connector.cables = Math.min(connector.maxCables, connector.cables + 1);
    ticket.status = "done";
    ticket.connection = null;
    broadcastState();
  }
}

/* ---------- Sync ---------- */
function buildSnapshot() {
  return {
    type: "state",
    phase: state.phase, levelIdx: state.levelIdx,
    timeLeft: state.timeLeft, duration: state.duration, goal: state.goal,
    teamScore: state.teamScore, teamChaos: state.teamChaos, teamPenalty: state.teamPenalty,
    correctCount: state.correctCount,
    tickets: state.tickets, players: state.players, log: state.log,
    levelTitle: state.levelTitle, levelSubtitle: state.levelSubtitle,
    gameMode: state.gameMode, supervisorId: state.supervisorId,
  };
}
function broadcastState() {
  const snap = buildSnapshot();
  Net.broadcast(snap);
  applyStateLocally(snap);
}
function broadcastEvent(ev: unknown) {
  Net.broadcast({ type: "event", event: ev });
  applyEventLocally(ev as Record<string, unknown>);
}
function applyStateLocally(snap: Partial<GameState> & Record<string, unknown>) {
  Object.assign(state, {
    phase: snap.phase, levelIdx: snap.levelIdx,
    timeLeft: snap.timeLeft, duration: snap.duration, goal: snap.goal,
    teamScore: snap.teamScore, teamChaos: snap.teamChaos, teamPenalty: snap.teamPenalty,
    correctCount: snap.correctCount,
    tickets: snap.tickets, players: snap.players, log: snap.log,
    levelTitle: snap.levelTitle, levelSubtitle: snap.levelSubtitle,
    gameMode: snap.gameMode || "classic",
    supervisorId: snap.supervisorId || null,
  });
  snapTimeLeft = snap.timeLeft ?? 0;
  snapTakenAt = performance.now();
  render();
  reconcileSlipModal();
  reconcileAgencyModal();
  ensureClientLoop();
}
function applyEventLocally(ev: Record<string, unknown>) {
  if (ev.type === "ring") sfx.ring();
  else if (ev.type === "connect") {
    if (ev.correct) sfx.connect(); else sfx.chaos();
  } else if (ev.type === "disconnected") {
    const rect = plugRect(String(ev.toId ?? ""));
    if (ev.result === "cut") {
      sfx.penalty();
      if (rect) floater(`−${PENALTY_EARLY} EARLY CUT`, rect.x, rect.y - 20, "chaos");
    } else if (ev.result === "routed") {
      sfx.hangup();
      if (rect) floater(`+${SCORE_CORRECT} ROUTED`, rect.x, rect.y - 20, "score");
    } else if (ev.result === "chaos") {
      sfx.hangup();
      if (rect) floater(`+${SCORE_CHAOS} CHAOS`, rect.x, rect.y - 20, "miss");
    }
  } else if (ev.type === "line") {
    sfx.line();
  } else if (ev.type === "timeout") {
    sfx.penalty();
    const rect = plugRect(String(ev.fromId ?? ""));
    if (rect) floater(`−${ev.penalty ?? PENALTY_TIMEOUT} TIMEOUT`, rect.x, rect.y - 20, "chaos");
  } else if (ev.type === "tick") {
    sfx.tick();
  } else if (ev.type === "stamp") {
    sfx.stamp();
  } else if (ev.type === "denied") {
    sfx.stamp();
    const rect = plugRect(String(ev.fromId ?? ""));
    if (rect) {
      if (ev.correct) floater(`+${SCORE_DENY_RIGHT} DENIED`, rect.x, rect.y - 20, "score");
      else floater(`−${PENALTY_DENY_WRONG} WRONG DENY`, rect.x, rect.y - 20, "chaos");
    }
  } else if (ev.type === "badApprove") {
    sfx.penalty();
    const rect = plugRect(String(ev.fromId ?? ""));
    if (rect) floater(`−${PENALTY_APPROVE_BAD} BAD APPROVE`, rect.x, rect.y - 20, "chaos");
  } else if (ev.type === "agencyRing") {
    sfx.agency();
    showToast("☎ THE AGENCY IS ON THE LINE");
  } else if (ev.type === "agencyCorrect") {
    sfx.connect();
    showToast(`+${ev.score} AGENCY • ${ev.operatorName} HELD COVER`);
  } else if (ev.type === "agencyWrong") {
    sfx.penalty();
    showToast(`−${ev.penalty} AGENCY • ${ev.operatorName} FUMBLED`);
  } else if (ev.type === "agencyMiss") {
    sfx.penalty();
    showToast(`−${ev.penalty} AGENCY • NO ANSWER`);
  }
}

/* ============================================================
   CLIENT / HOST MESSAGE HANDLERS
   ============================================================ */
Net.onClientConnect = (conn) => {
  // Send lobby mode to new connection so their picker reflects host's choice.
  try { conn.send({ type: "lobby", mode: lobbyMode, supervisorId: lobbySupervisorId }); } catch { /* ignore */ }
};
Net.onClientDisconnect = (peerId) => {
  if (Net.isHost) {
    const idx = state.players.findIndex(p => p.id === peerId);
    if (idx >= 0) {
      const pl = state.players[idx];
      if (!pl) return;
      // Abandon any live connections from this player (no penalty — treat as graceful)
      state.tickets.forEach(t => {
        if (t.status === "live" && t.connection?.byPlayer === pl.id) {
          // Leave them live — anyone else can disconnect. Or end them? Let's leave them for coop.
        }
      });
      state.players.splice(idx, 1);
      broadcastState();
    }
  } else {
    showToast("Host disconnected. Returning to title.");
    setTimeout(() => { Net.leave(); resetLocal(); showScreen("title"); }, 1500);
  }
};
Net.onMessage = (peerId, rawMsg) => {
  const msg = rawMsg as Record<string, unknown>;
  if (Net.isHost) {
    if (msg.type === "hello") {
      if (!state.players.find(p => p.id === peerId)) {
        const color = PLAYER_COLORS[state.players.length % PLAYER_COLORS.length] ?? "#fff";
        state.players.push({
          id: peerId,
          name: ((msg.name as string | undefined) ?? "OP").toUpperCase().slice(0,14),
          color,
          cables: CABLES_PER_PLAYER,
          maxCables: CABLES_PER_PLAYER,
          selected: null,
        });
        broadcastState();
        broadcastLobbyState();
      }
    } else {
      hostHandleAction(peerId, msg);
    }
  } else {
    if (msg.type === "state") applyStateLocally(msg as Partial<GameState> & Record<string, unknown>);
    else if (msg.type === "event") applyEventLocally(msg.event as Record<string, unknown>);
    else if (msg.type === "lobby") {
      lobbyMode = (msg.mode as string) || "classic";
      lobbySupervisorId = (msg.supervisorId as string | null) || null;
      renderLobby();
    }
  }
};

/* ============================================================
   INPUT
   ============================================================ */
function onPlugClick(plugId: string) {
  if (state.phase !== "playing") return;
  const me = myPlayer();
  if (!me) return;

  // Live connection endpoint? → disconnect
  const live = findLivePlug(plugId);
  if (live) {
    sendAction({ type: "disconnect", ticketId: live.id });
    return;
  }

  // I have a selection
  if (me.selected && me.selected !== plugId) {
    if (me.cables <= 0) { sfx.denied(); showToast("no cables free"); return; }
    sendAction({ type: "connect", toId: plugId });
    return;
  }
  if (me.selected === plugId) {
    sendAction({ type: "deselect" });
    return;
  }

  // Try to claim ringing plug
  const ticket = state.tickets.find(t => t.from === plugId && t.status === "ringing");
  if (!ticket) { sfx.denied(); return; }

  // Supervisor mode: supervisor clicks to open stamp modal; non-supervisors blocked on pending
  if (state.gameMode === "supervisor") {
    if (ticket.approval === "awaiting-stamp") {
      if (me.id === state.supervisorId) { openSlipModal(ticket, "supervisor"); sfx.select(); }
      else { sfx.denied(); showToast("awaiting supervisor stamp"); }
      return;
    }
    if (me.id === state.supervisorId) { sfx.denied(); showToast("supervisors do not patch"); return; }
  }

  // Verify mode: opening a pending ticket begins review (select is also the review claim)
  if (state.gameMode === "verify" && ticket.approval === "pending") {
    if (ticket.reviewer && ticket.reviewer !== me.id) { sfx.denied(); showToast("another op reviewing"); return; }
    if (me.cables <= 0) { sfx.denied(); showToast("no cables free"); return; }
    sendAction({ type: "select", plugId });
    sfx.select();
    return;
  }

  if (me.cables <= 0) { sfx.denied(); showToast("no cables free"); return; }
  sendAction({ type: "select", plugId });
  sfx.select();
}

function onCableClick(ticketId: number) {
  if (state.phase !== "playing") return;
  sendAction({ type: "disconnect", ticketId });
}

function sendAction(msg: Record<string, unknown>) {
  if (Net.isHost) hostHandleAction(Net.myId, msg);
  else Net.sendToHost(msg);
}

/* ============================================================
   UI HOOKS
   ============================================================ */
function on(id: string, ev: string, fn: EventListener) { const el = $(id); if (el) el.addEventListener(ev, fn); }

function readName() {
  const inp = $("name-input") as HTMLInputElement | null;
  let n = (inp?.value || "").trim();
  if (!n) { n = "OP-" + Math.floor(100 + Math.random()*900); if (inp) inp.value = n; }
  return n;
}

function bindUI() {
  on("host-btn", "click", () => {
    unlockAudio();
    const name = readName();
    Net.status("opening host channel...", "");
    Net.host(name, () => {
      state.players = [{
        id: Net.myId ?? "",
        name: name.toUpperCase().slice(0,14),
        color: PLAYER_COLORS[0] ?? "#fff",
        cables: CABLES_PER_PLAYER,
        maxCables: CABLES_PER_PLAYER,
        selected: null,
      }];
      Net.myColor = PLAYER_COLORS[0] ?? "#fff";
      lobbyMode = "classic";
      lobbySupervisorId = Net.myId;
      const rc = $("room-code"); if (rc) rc.textContent = Net.roomCode;
      const hr = $("hud-room"); if (hr) hr.textContent = Net.roomCode;
      showScreen("lobby");
      renderLobby();
    });
  });

  on("join-btn", "click", () => {
    unlockAudio();
    const name = readName();
    const code = (($("room-input") as HTMLInputElement | null)?.value || "").trim().toUpperCase();
    if (!code) { Net.status("enter a room code first", "err"); return; }
    Net.status("connecting...", "");
    Net.join(code, name, () => {
      const rc2 = $("room-code"); if (rc2) rc2.textContent = code;
      const hr2 = $("hud-room"); if (hr2) hr2.textContent = code;
      showScreen("lobby");
      renderLobby();
    });
  });

  on("lobby-start-btn", "click", () => {
    if (!Net.isHost) return;
    hostStartLevel(0);
    showScreen("game");
  });
  on("copy-btn", "click", () => {
    const code = $("room-code")?.textContent;
    if (!code) return;
    navigator.clipboard?.writeText(code).catch(()=>{});
    showToast("copied " + code);
  });
  on("lobby-leave-btn", "click", leaveRoom);
  on("end-leave-btn",   "click", leaveRoom);

  on("next-btn", "click", () => {
    if (!Net.isHost) return;
    if (state.levelIdx + 1 >= LEVELS.length) hostStartLevel(0);
    else hostStartLevel(state.levelIdx + 1);
    showScreen("game");
  });
  on("replay-btn", "click", () => {
    if (!Net.isHost) return;
    hostStartLevel(state.levelIdx);
    showScreen("game");
  });

  on("room-input", "input", (e) => { const t = e.target as HTMLInputElement; t.value = t.value.toUpperCase(); });

  // Mode picker (host only — everyone else's clicks ignored)
  const modeDescs = {
    classic:    "Classic switchboard. Ring → patch → hang up.",
    verify:     "Every call comes with a call slip. Before patching, review caller, line, and request. Deny forged or flagged slips.",
    supervisor: "One operator becomes Supervisor: no cables, stamps APPROVE/DENY. Patchers only see calls after they're approved.",
  };
  ["classic","verify","supervisor"].forEach(mode => {
    on(`mode-${mode}`, "click", () => {
      if (!Net.isHost) return;
      lobbyMode = mode;
      renderLobby();
      broadcastLobbyState();
    });
  });
  on("supervisor-select", "change", (e) => {
    if (!Net.isHost) return;
    lobbySupervisorId = (e.target as HTMLSelectElement).value || null;
    broadcastLobbyState();
  });

  // Slip modal buttons
  on("slip-approve", "click", () => {
    const tid = slipModalTicketId;
    if (!tid) return;
    if (state.gameMode === "verify") sendAction({ type: "verifyDecision", ticketId: tid, decision: "approve" });
    else if (state.gameMode === "supervisor") sendAction({ type: "stamp", ticketId: tid, decision: "approve" });
    sfx.stamp();
    closeSlipModal();
  });
  on("slip-deny", "click", () => {
    const tid = slipModalTicketId;
    if (!tid) return;
    if (state.gameMode === "verify") sendAction({ type: "verifyDecision", ticketId: tid, decision: "deny" });
    else if (state.gameMode === "supervisor") sendAction({ type: "stamp", ticketId: tid, decision: "deny" });
    sfx.stamp();
    closeSlipModal();
  });
  on("slip-cancel", "click", () => {
    const tid = slipModalTicketId;
    if (!tid) { closeSlipModal(); return; }
    if (state.gameMode === "verify") sendAction({ type: "verifyDecision", ticketId: tid, decision: "cancel" });
    closeSlipModal();
  });

  // Store mode descs for renderLobby
  (window as Window & { _modeDescs?: Record<string,string> })._modeDescs = modeDescs;

  document.addEventListener("contextmenu", (e) => {
    if (state.phase === "playing" && screens.game?.classList.contains("active")) {
      const me = myPlayer();
      if (me && me.selected) { e.preventDefault(); sendAction({ type: "deselect" }); }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.phase === "playing") {
      const me = myPlayer();
      if (me && me.selected) sendAction({ type: "deselect" });
    }
  });

  showScreen("title");
}

function leaveRoom() {
  Net.leave();
  resetLocal();
  showScreen("title");
  Net.status("left room", "");
}
function resetLocal() {
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
  state._agencyNextAt = 0;
  state._timeoutCount = 0;
  lobbyMode = "classic";
  lobbySupervisorId = null;
  closeSlipModal();
  closeAgencyModal();
  if (timerHandle) { cancelAnimationFrame(timerHandle); timerHandle = null; }
  if (clientHandle) { cancelAnimationFrame(clientHandle); clientHandle = null; }
  ["board","queue","operators","log","leaderboard"].forEach(id => { const el = $(id); if (el) el.innerHTML = ""; });
  resetRenderCaches();
  clearCables();
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  if (state.phase === "lobby")  renderLobby();
  if (state.phase === "playing") {
    const gameScreen = screens.game;
    if (gameScreen && !gameScreen.classList.contains("active")) showScreen("game");
    renderBoard();
    renderQueue();
    renderOperators();
    renderLog();
    renderCables();
    updateHud();
  }
  if (state.phase === "ended") {
    const endScreen = screens.end;
    if (endScreen && !endScreen.classList.contains("active")) showScreen("end");
    renderSummary();
  }
}

function renderLobby() {
  const el = $("lobby-players");
  if (!el) return;
  el.innerHTML = "";
  state.players.forEach(p => {
    const isSv = lobbyMode === "supervisor" && lobbySupervisorId === p.id;
    const row = document.createElement("div");
    row.className = "lobby-player";
    row.innerHTML = `
      <div class="dot" style="background:${p.color};color:${p.color}"></div>
      <div class="name">${escape(p.name)}${isSv ? ' <span class="sv-badge">SV</span>' : ''}</div>
      <div class="tag">${p.id === Net.myId ? (Net.isHost ? "HOST / YOU" : "YOU") : "OPERATOR"}</div>
    `;
    el.appendChild(row);
  });
  if ($("lobby-start-btn")) ($("lobby-start-btn") as HTMLElement).style.display = Net.isHost ? "" : "none";
  if ($("lobby-wait")) ($("lobby-wait") as HTMLElement).style.display = Net.isHost ? "none" : "";

  // Mode buttons
  ["classic","verify","supervisor"].forEach(m => {
    const b = $(`mode-${m}`) as HTMLButtonElement | null;
    if (!b) return;
    b.classList.toggle("active", lobbyMode === m);
    b.disabled = !Net.isHost;
    if (m === "supervisor") b.disabled = b.disabled || state.players.length < 2;
  });
  const desc = $("mode-desc");
  if (desc) {
    const modeDescsWin = (window as Window & { _modeDescs?: Record<string,string> })._modeDescs;
    const base = (modeDescsWin && modeDescsWin[lobbyMode]) || "";
    desc.textContent = lobbyMode === "supervisor" && state.players.length < 2
      ? "Supervisor mode requires 2+ operators."
      : base;
  }

  // Supervisor picker
  const pick2 = $("supervisor-pick");
  if (pick2) pick2.style.display = lobbyMode === "supervisor" ? "" : "none";
  const sel = $("supervisor-select") as HTMLSelectElement | null;
  if (sel) {
    const prev = lobbySupervisorId || state.players[0]?.id || "";
    sel.innerHTML = "";
    state.players.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === prev) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.disabled = !Net.isHost;
    // Ensure lobbySupervisorId is one of the current players
    if (!state.players.some(p => p.id === lobbySupervisorId)) {
      lobbySupervisorId = state.players[0]?.id ?? null;
    }
  }

  // Disable Start if supervisor mode with <2 players
  const startBtn = $("lobby-start-btn") as HTMLButtonElement | null;
  if (startBtn) startBtn.disabled = lobbyMode === "supervisor" && state.players.length < 2;
}

function broadcastLobbyState() {
  if (!Net.isHost) return;
  Net.broadcast({ type: "lobby", mode: lobbyMode, supervisorId: lobbySupervisorId });
}

function updateHud() {
  const levelNumEl = $("level-num");    if (levelNumEl)   levelNumEl.textContent = String(state.levelIdx + 1);
  const correctValEl = $("correct-val"); if (correctValEl) correctValEl.textContent = `${state.correctCount} / ${state.goal}`;
  const teamScoreEl = $("team-score");  if (teamScoreEl)  teamScoreEl.textContent = String(state.teamScore + state.teamChaos);
  const teamPenEl = $("team-pen");      if (teamPenEl)    teamPenEl.textContent = "-" + state.teamPenalty;
  const totalMax = state.players.reduce((s,p) => s + p.maxCables, 0);
  const free = state.players.reduce((s,p) => s + p.cables, 0);
  const cablesFreeEl = $("cables-free"); if (cablesFreeEl) cablesFreeEl.textContent = `${free} / ${totalMax}`;
  const hudRoomEl = $("hud-room");      if (hudRoomEl)    hudRoomEl.textContent = Net.roomCode || "---";
  const hudModeEl = $("hud-mode");
  if (hudModeEl) {
    const m = state.gameMode || "classic";
    const iAmSv = m === "supervisor" && Net.myId === state.supervisorId;
    hudModeEl.textContent = m === "classic" ? "CLASSIC"
                           : m === "verify" ? "VERIFY"
                           : (iAmSv ? "SUPERVISOR (YOU)" : "SUPERVISOR");
  }
  const pct = Math.max(0, state.duration > 0 ? (state.timeLeft / state.duration) : 0) * 100;
  const timerFillEl = $("timer-fill") as HTMLElement | null;
  if (timerFillEl) timerFillEl.style.width = pct + "%";
}

function renderBoard() {
  const lvl = LEVELS[state.levelIdx];
  const board = $("board");
  if (!board || !lvl) return;

  // Full rebuild only if level changed
  if (renderedLevelIdx !== state.levelIdx) {
    board.innerHTML = "";
    plugEls.clear();
    const n = lvl.chars.length;
    const cols = n <= 6 ? 3 : n <= 8 ? 4 : 4;
    board.style.gridTemplateColumns = `repeat(${cols}, 92px)`;
    lvl.chars.forEach(id => {
      const c = CHARS[id];
      if (!c) return;
      const el = document.createElement("div");
      el.className = "plug";
      el.dataset.id = id;
      el.innerHTML = `
        <div class="bulb"></div>
        <div class="jack"></div>
        <div class="emoji">${c.emoji}</div>
        <div class="name">${c.name}</div>
        <div class="claim-tag" style="display:none"></div>
      `;
      el.addEventListener("click", () => onPlugClick(id));
      board.appendChild(el);
      plugEls.set(id, el);
    });
    renderedLevelIdx = state.levelIdx;
  }

  // Reconcile class/attr per plug
  lvl.chars.forEach(id => {
    const el = plugEls.get(id);
    if (!el) return;
    const ringingTicket = state.tickets.find(t => t.from === id && t.status === "ringing");
    const liveTicket = findLivePlug(id);
    const claimer = state.players.find(p => p.selected === id);

    const wantRing = !!(ringingTicket && !liveTicket);
    const wantLive = !!liveTicket;
    const wantSelf = !!(claimer && claimer.id === Net.myId);
    const wantOther = !!(claimer && claimer.id !== Net.myId);

    if (el.classList.contains("ringing") !== wantRing)       el.classList.toggle("ringing", wantRing);
    if (el.classList.contains("live") !== wantLive)          el.classList.toggle("live", wantLive);
    if (el.classList.contains("claimed-self") !== wantSelf)  el.classList.toggle("claimed-self", wantSelf);
    if (el.classList.contains("claimed-other") !== wantOther) el.classList.toggle("claimed-other", wantOther);

    let color = null;
    if (claimer) color = claimer.color;
    else if (liveTicket) color = state.players.find(p => p.id === liveTicket.connection?.byPlayer)?.color;
    const prev = el.style.getPropertyValue("--claimColor");
    if (color) { if (prev !== color) el.style.setProperty("--claimColor", color); }
    else if (prev) el.style.removeProperty("--claimColor");

    const tag = el.querySelector(".claim-tag");
    if (claimer) {
      if (tag.textContent !== claimer.name) tag.textContent = claimer.name;
      tag.style.display = "";
      const prevTagColor = tag.style.getPropertyValue("--claimColor");
      if (prevTagColor !== claimer.color) tag.style.setProperty("--claimColor", claimer.color);
    } else {
      if (tag.style.display !== "none") tag.style.display = "none";
    }
  });
}

function renderQueue() {
  const el = $("queue");
  if (!el) return;

  const want = new Set();
  const ringing = state.tickets.filter(t => t.status === "ringing" && t.kind !== "agency");
  const agencyRinging = state.tickets.filter(t => t.status === "ringing" && t.kind === "agency");
  const live = state.tickets.filter(t => t.status === "live");

  // Ensure a "LIVE" header exists only when we have live items
  let liveHead = el.querySelector(":scope > .live-head");
  if (live.length) {
    if (!liveHead) {
      liveHead = document.createElement("div");
      liveHead.className = "live-head";
      el.appendChild(liveHead);
    }
    liveHead.textContent = `${live.length} LIVE`;
  } else if (liveHead) {
    liveHead.remove();
    liveHead = null;
  }

  // Ringing tickets
  ringing.forEach(t => {
    const key = "r" + t.id;
    want.add(key);
    let div = queueEls.get(key);
    const from = CHARS[t.from], to = t.to ? CHARS[t.to] : null;
    const slip = t.slip;
    const showSlipPreview = (state.gameMode === "supervisor") || (state.gameMode === "verify" && t.approval !== "approved");
    const requestName = (showSlipPreview && slip) ? slip.requestName : (to?.name ?? "?");
    const requestEmoji = (showSlipPreview && slip) ? (CHARS[slip.requestId]?.emoji || to?.emoji || "?") : (to?.emoji ?? "?");
    if (!div) {
      div = document.createElement("div");
      div.className = "ticket";
      div.dataset.tid = t.id;
      const slipExtra = slip ? `
        <div class="slip-mini">
          <span class="slip-k">LINE</span> <b>${escape(slip.line)}</b>
          ${slip.flagged ? '<span class="slip-flag-mini">⚠ FLAGGED</span>' : ''}
        </div>` : "";
      div.innerHTML = `
        <span class="num">#${String(t.id).padStart(3,"0")}</span>
        <div class="row"><span class="emoji">${from?.emoji ?? ""}</span><b>${escape(from?.name ?? t.from)}</b></div>
        <div class="arrow">│ WANTS ▼</div>
        <div class="row"><span class="emoji">${requestEmoji}</span><b class="req-name">${escape(requestName)}</b></div>
        <div class="note">${escape(t.note || "")}</div>
        ${slipExtra}
        <div class="ring-bar"><div class="ring-bar-fill" style="width:100%"></div></div>
      `;
      // Supervisor: click a pending ticket in the queue to stamp it
      div.addEventListener("click", () => {
        if (state.phase !== "playing") return;
        if (state.gameMode === "supervisor" && Net.myId === state.supervisorId
            && t.approval === "awaiting-stamp") {
          openSlipModal(t, "supervisor");
          sfx.select();
        }
      });
      if (liveHead) el.insertBefore(div, liveHead); else el.appendChild(div);
      queueEls.set(key, div);
    } else {
      // Reconcile requested-party display if approval flips
      const reqB = div.querySelector(".req-name");
      if (reqB && reqB.textContent !== requestName) reqB.textContent = requestName;
    }
    // Approval class reconciliation
    const wantAwaiting = state.gameMode === "supervisor" && t.approval === "awaiting-stamp";
    const wantApprovedStamp = state.gameMode === "supervisor" && t.approval === "approved";
    const wantReview = state.gameMode === "verify" && t.approval === "pending" && t.reviewer === Net.myId;
    div.classList.toggle("awaiting-stamp", wantAwaiting);
    div.classList.toggle("approved-stamp", wantApprovedStamp);
    div.classList.toggle("pending-review", wantReview);
    div.style.cursor = wantAwaiting && Net.myId === state.supervisorId ? "pointer" : "";
  });

  // Live tickets
  live.forEach(t => {
    const key = "l" + t.id;
    want.add(key);
    let div = queueEls.get(key);
    const conn = t.connection;
    if (!conn) return;
    const from = CHARS[t.from], to = CHARS[conn.actualTo];
    const owner = state.players.find(p => p.id === conn.byPlayer);
    const color = owner?.color || "#68c6ff";
    if (!div) {
      div = document.createElement("div");
      div.className = "ticket live";
      div.dataset.tid = t.id;
      div.innerHTML = `
        <span class="num">LIVE</span>
        <div class="row"><span class="emoji">${from?.emoji ?? ""}</span>${escape(from?.name ?? t.from)} ↔ <span class="emoji">${to?.emoji ?? ""}</span>${escape(to?.name ?? conn.actualTo)}</div>
        <div class="note">cable by ${escape(owner?.name || "—")}</div>
      `;
      div.addEventListener("click", () => onCableClick(t.id));
      el.appendChild(div);
      queueEls.set(key, div);
    }
    if (div.style.getPropertyValue("--claimColor") !== color) div.style.setProperty("--claimColor", color);
  });

  // Remove stale
  for (const [key, node] of queueEls) {
    if (!want.has(key)) { node.remove(); queueEls.delete(key); }
  }

  // Agency tickets
  agencyRinging.forEach(t => {
    const key = "a" + t.id;
    want.add(key);
    let div = queueEls.get(key);
    if (!div) {
      div = document.createElement("div");
      div.className = "ticket agency";
      div.dataset.tid = t.id;
      div.innerHTML = `
        <span class="num">🕴 AGENCY</span>
        <div class="agency-row">CHECK-IN CALL</div>
        <div class="row"><span class="emoji">☎</span><b>ENCRYPTED LINE</b></div>
        <div class="agency-row mono">CLICK TO ANSWER</div>
        <div class="ring-bar"><div class="ring-bar-fill" style="width:100%"></div></div>
      `;
      div.addEventListener("click", () => openAgencyModal(t));
      el.appendChild(div);
      queueEls.set(key, div);
    }
  });

  // Reorder DOM: agency first (most urgent), ringing, liveHead, then live
  const fragAgency = agencyRinging.map(t => queueEls.get("a" + t.id)).filter(Boolean);
  const fragRinging = ringing.map(t => queueEls.get("r" + t.id)).filter(Boolean);
  const fragLive = live.map(t => queueEls.get("l" + t.id)).filter(Boolean);
  fragAgency.forEach(n => el.appendChild(n));
  fragRinging.forEach(n => el.appendChild(n));
  if (liveHead) el.appendChild(liveHead);
  fragLive.forEach(n => el.appendChild(n));
}

/* Update just the ring-bar widths without touching the rest */
function tickRingBars() {
  if (state.phase !== "playing") return;
  const now = Date.now();
  state.tickets.forEach(t => {
    if (t.status !== "ringing") return;
    const prefix = t.kind === "agency" ? "a" : "r";
    const div = queueEls.get(prefix + t.id);
    if (!div) return;
    const fill = div.querySelector(".ring-bar-fill");
    if (!fill) return;
    const dur = t.ringDurationMs || RING_TIMEOUT_MS;
    const pct = Math.max(0, (t.timeoutAt - now) / dur);
    fill.style.width = (pct * 100).toFixed(1) + "%";
  });
}

function renderOperators() {
  const el = $("operators");
  if (!el) return;
  const want = new Set();
  state.players.forEach(p => {
    want.add(p.id);
    let row = opEls.get(p.id);
    if (!row) {
      row = document.createElement("div");
      row.className = "op-row" + (p.id === Net.myId ? " self" : "");
      row.innerHTML = `
        <div class="dot" style="background:${p.color};color:${p.color}"></div>
        <div class="name"></div>
        <div class="cables" style="color:${p.color}"></div>
      `;
      el.appendChild(row);
      opEls.set(p.id, row);
    }
    const nameEl = row.querySelector(".name");
    if (nameEl.textContent !== p.name) nameEl.textContent = p.name;
    const cablesEl = row.querySelector(".cables");
    const max = p.maxCables || 0;
    // reconcile dot nodes
    while (cablesEl.childElementCount < max) {
      const d = document.createElement("span");
      d.className = "cable-dot";
      cablesEl.appendChild(d);
    }
    while (cablesEl.childElementCount > max) cablesEl.lastChild.remove();
    for (let i = 0; i < max; i++) {
      const used = i >= p.cables;
      const d = cablesEl.children[i];
      if (d.classList.contains("used") !== used) d.classList.toggle("used", used);
    }
  });
  for (const [id, node] of opEls) {
    if (!want.has(id)) { node.remove(); opEls.delete(id); }
  }
  // reorder
  state.players.forEach(p => { const n = opEls.get(p.id); if (n) el.appendChild(n); });
}

function renderLog() {
  const el = $("log");
  if (!el) return;
  const want = new Set();

  // state.log is newest-first; build DOM newest-first (prepend new ones)
  state.log.forEach(entry => {
    want.add(entry.ticketId);
    let div = logEls.get(entry.ticketId);
    if (!div) {
      div = document.createElement("div");
      div.className = "entry";
      const fromName = CHARS[entry.from]?.name || "";
      const actualName = CHARS[entry.actual]?.name || "";
      const routedBy = state.players.find(p => p.id === entry.byPlayer);
      div.innerHTML = `
        <div class="header">
          <span class="badge"></span>
          <span class="who">${escape(fromName)} → ${escape(actualName)}</span>
          <span class="by">by ${escape(routedBy?.name || "—")}</span>
        </div>
        <div class="lines"></div>
      `;
      if (routedBy) div.querySelector(".by").style.color = routedBy.color;
      el.prepend(div);
      logEls.set(entry.ticketId, div);
    }

    // Status badge
    const header = div.querySelector(".header");
    const badge = header.querySelector(".badge");
    let cls = "streaming", txt = "LIVE";
    if (entry.status === "ended") {
      if (entry.result === "cut")         { cls = "cut";    txt = "EARLY CUT"; }
      else if (entry.result === "routed") { cls = "ok";     txt = "ROUTED"; }
      else if (entry.result === "chaos")  { cls = "chaos";  txt = "CROSSED"; }
    }
    ["streaming","cut","ok","chaos"].forEach(c => { if (c !== cls && header.classList.contains(c)) header.classList.remove(c); });
    if (!header.classList.contains(cls)) header.classList.add(cls);
    if (badge.textContent !== txt) badge.textContent = txt;
    const isStreaming = (cls === "streaming");
    if (div.classList.contains("streaming") !== isStreaming) div.classList.toggle("streaming", isStreaming);

    // Append any new lines
    const linesEl = div.querySelector(".lines");
    const have = linesEl.childElementCount;
    for (let i = have; i < entry.lines.length; i++) {
      const l = entry.lines[i];
      if (!l) continue;
      const sp = document.createElement("span");
      sp.className = "line" + (l.s === "sys" ? " system" : "");
      const speakerName = CHARS[l.s]?.name || "";
      sp.innerHTML = `<span class="speaker">${escape(speakerName)}${l.s === "sys" ? "" : ":"}</span> ${escape(l.t)}`;
      linesEl.appendChild(sp);
    }
  });

  // Drop stale (log trimmed)
  for (const [id, node] of logEls) {
    if (!want.has(id)) { node.remove(); logEls.delete(id); }
  }
}

function renderSummary() {
  const lb = $("leaderboard");
  if (!lb) return;
  lb.innerHTML = "";

  const total = state.teamScore + state.teamChaos - state.teamPenalty;
  const passed = state.correctCount >= state.goal;
  const lastLevel = state.levelIdx + 1 >= LEVELS.length;

  const summary = document.createElement("div");
  summary.className = "team-summary";
  summary.innerHTML = `
    <div class="ts-row"><span class="hud-label">CORRECT ROUTES</span><span class="score">${state.correctCount} / ${state.goal}</span></div>
    <div class="ts-row"><span class="hud-label">ROUTED POINTS</span><span class="score">+${state.teamScore}</span></div>
    <div class="ts-row"><span class="hud-label">CHAOS BONUS</span><span class="chaos">+${state.teamChaos}</span></div>
    <div class="ts-row"><span class="hud-label">PENALTIES</span><span class="pen">-${state.teamPenalty}</span></div>
    <div class="ts-row final"><span class="hud-label">TEAM TOTAL</span><span class="total">${total}</span></div>
  `;
  lb.appendChild(summary);

  const ops = document.createElement("div");
  ops.className = "ops-footer";
  ops.innerHTML = `<div class="hud-label">CREW</div>` + state.players.map(p => `
    <div class="lb-row">
      <div class="dot" style="background:${p.color};color:${p.color}"></div>
      <div class="name">${escape(p.name)}${p.id === Net.myId ? " ★" : ""}</div>
      <div class="cables" style="color:${p.color}">${"●".repeat(p.cables)}${"○".repeat(p.maxCables - p.cables)}</div>
    </div>
  `).join("");
  lb.appendChild(ops);

  if ($("end-title")) {
    const lvl2 = LEVELS[state.levelIdx];
    const endTitle = $("end-title") as HTMLElement;
    endTitle.textContent = passed
      ? (lastLevel ? "FINAL SHIFT CLEARED • PUNCH OUT" : `${lvl2?.title ?? ""} • CLEARED`)
      : `${lvl2?.title ?? ""} • SUPERVISOR DISAPPOINTED`;
  }
  if ($("end-blurb")) {
    const lvl2 = LEVELS[state.levelIdx];
    const endBlurb = $("end-blurb") as HTMLElement;
    endBlurb.textContent = passed
      ? (lastLevel ? "The board goes dark. The crew did it." : lvl2?.subtitle ?? "")
      : `Crew needed ${state.goal} correct routes. Got ${state.correctCount}.`;
  }
  document.querySelectorAll(".host-only").forEach(el => (el as HTMLElement).style.display = Net.isHost ? "" : "none");
  const endWaitEl = $("end-wait"); if (endWaitEl) endWaitEl.style.display = Net.isHost ? "none" : "";
  const nextBtnEl = $("next-btn"); if (nextBtnEl) nextBtnEl.textContent = passed ? (lastLevel ? "PLAY AGAIN ▸" : "NEXT SHIFT ▸") : "RETRY SHIFT ▸";
}

/* ============================================================
   CABLES (persistent) / FLOATERS / TOAST
   ============================================================ */
function plugRect(id: string) {
  const el = $("board")?.querySelector(`[data-id="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}
function clearCables() { const l = $("cable-layer"); if (l) l.innerHTML = ""; }

function renderCables() {
  const layer = $("cable-layer");
  if (!layer) return;
  const svgNS = "http://www.w3.org/2000/svg";
  if (!cableSvg || !layer.contains(cableSvg)) {
    layer.innerHTML = "";
    cableSvg = document.createElementNS(svgNS, "svg");
    cableSvg.setAttribute("width", "100%");
    cableSvg.setAttribute("height", "100%");
    layer.appendChild(cableSvg);
  }
  const live = state.tickets.filter(t => t.status === "live");
  const want = new Set();
  live.forEach(t => {
    want.add(t.id);
    const conn = t.connection;
    if (!conn) return;
    const a = plugRect(t.from), b = plugRect(conn.actualTo);
    if (!a || !b) return;
    const owner = state.players.find(p => p.id === conn.byPlayer);
    const color = owner?.color || "#68c6ff";
    const d = `M ${a.x} ${a.y+8} Q ${(a.x+b.x)/2} ${Math.max(a.y,b.y)+100}, ${b.x} ${b.y+8}`;
    let g = cableEls.get(t.id);
    if (!g) {
      g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "cable");
      g.setAttribute("data-tid", t.id);
      g.style.cursor = "pointer";
      const hit  = document.createElementNS(svgNS, "path");
      const main = document.createElementNS(svgNS, "path");
      const high = document.createElementNS(svgNS, "path");
      const ca   = document.createElementNS(svgNS, "circle");
      const cb   = document.createElementNS(svgNS, "circle");
      hit.setAttribute("stroke-opacity","0.3"); hit.setAttribute("stroke-width","12"); hit.setAttribute("fill","none"); hit.setAttribute("stroke-linecap","round"); hit.setAttribute("pointer-events","stroke");
      main.setAttribute("stroke-width","5");  main.setAttribute("fill","none"); main.setAttribute("stroke-linecap","round"); main.setAttribute("pointer-events","stroke");
      high.setAttribute("stroke","#fff8"); high.setAttribute("stroke-width","1"); high.setAttribute("fill","none"); high.setAttribute("stroke-linecap","round"); high.setAttribute("pointer-events","none");
      ca.setAttribute("r","7"); cb.setAttribute("r","7");
      g.append(hit, main, high, ca, cb);
      g.addEventListener("click", () => onCableClick(t.id));
      if (cableSvg) cableSvg.appendChild(g);
      cableEls.set(t.id, g);
    }
    const [hit, main, high, ca, cb] = [g.children[0], g.children[1], g.children[2], g.children[3], g.children[4]];
    hit.setAttribute("d", d);  hit.setAttribute("stroke", color);
    main.setAttribute("d", d); main.setAttribute("stroke", color);
    high.setAttribute("d", d);
    ca.setAttribute("cx", a.x); ca.setAttribute("cy", a.y); ca.setAttribute("fill", color);
    cb.setAttribute("cx", b.x); cb.setAttribute("cy", b.y); cb.setAttribute("fill", color);
  });
  for (const [id, node] of cableEls) {
    if (!want.has(id)) { node.remove(); cableEls.delete(id); }
  }
}

function floater(text: string, x: number, y: number, kind = "score") {
  const el = document.createElement("div");
  el.className = `floater ${kind}`;
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top  = y + "px";
  $("floater-layer")?.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function showToast(msg: string) {
  const t = $("toast") as (HTMLElement & { _h?: ReturnType<typeof setTimeout> }) | null;
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 1500);
}

/* ============================================================
   SLIP MODAL
   ============================================================ */
function openSlipModal(ticket: Ticket, role: string) {
  const m = $("slip-modal");
  if (!m || !ticket.slip) return;
  slipModalTicketId = ticket.id;
  m.dataset.role = role; // "verify" or "supervisor"
  const slipNum = $("slip-num"); if (slipNum) slipNum.textContent = "#" + ticket.slip.slipNum;
  const slipCaller = $("slip-caller"); if (slipCaller) slipCaller.textContent = ticket.slip.callerName;
  const slipLine = $("slip-line"); if (slipLine) slipLine.textContent = ticket.slip.line;
  const slipReq = $("slip-req"); if (slipReq) slipReq.textContent = ticket.slip.requestName;
  const slipFlag = $("slip-flag"); if (slipFlag) slipFlag.style.display = ticket.slip.flagged ? "" : "none";
  const slipHint = $("slip-hint"); if (slipHint) slipHint.textContent = role === "supervisor"
    ? "Cross-check against INCOMING. Stamp carefully."
    : "Double-check caller's request. Approve or deny.";
  m.classList.remove("hidden");
}
function closeSlipModal() {
  const m = $("slip-modal");
  if (!m) return;
  m.classList.add("hidden");
  slipModalTicketId = null;
}
/* ---------- Agency modal ---------- */
let agencyModalTicketId: number | null = null;
function openAgencyModal(ticket: Ticket) {
  const m = $("agency-modal");
  if (!m || !ticket || !ticket.agencyQ) return;
  if (ticket.status !== "ringing") return;
  agencyModalTicketId = ticket.id;
  const agencyQ = $("agency-q"); if (agencyQ) agencyQ.textContent = ticket.agencyQ.text;
  const row = $("agency-choices");
  if (!row) return;
  row.innerHTML = "";
  ticket.agencyQ.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "agency-choice";
    b.textContent = String(c.label);
    b.addEventListener("click", () => {
      sendAction({ type: "agencyAnswer", ticketId: ticket.id, choiceIdx: i });
      closeAgencyModal();
    });
    row.appendChild(b);
  });
  m.classList.remove("hidden");
  sfx.select();
}
function closeAgencyModal() {
  const m = $("agency-modal");
  if (!m) return;
  m.classList.add("hidden");
  agencyModalTicketId = null;
}
function tickAgencyModal() {
  if (agencyModalTicketId == null) return;
  const t = state.tickets.find(x => x.id === agencyModalTicketId);
  if (!t || t.status !== "ringing") { closeAgencyModal(); return; }
  const fill = $("agency-timer-fill");
  if (!fill) return;
  const dur = t.ringDurationMs || AGENCY_TIMEOUT_MS;
  const pct = Math.max(0, (t.timeoutAt - Date.now()) / dur);
  fill.style.width = (pct * 100).toFixed(1) + "%";
}
function reconcileAgencyModal() {
  if (agencyModalTicketId == null) return;
  const t = state.tickets.find(x => x.id === agencyModalTicketId);
  if (!t || t.status !== "ringing" || t.agencyPickedBy) closeAgencyModal();
}

function reconcileSlipModal() {
  // Auto-open for verify reviewer
  if (state.phase === "playing" && state.gameMode === "verify" && slipModalTicketId == null) {
    const mine = state.tickets.find(t =>
      t.status === "ringing" && t.approval === "pending" && t.reviewer === Net.myId
    );
    if (mine) openSlipModal(mine, "verify");
  }
  // If modal's ticket is gone / resolved / approval changed away from need-decision, close it.
  if (slipModalTicketId == null) return;
  const t = state.tickets.find(x => x.id === slipModalTicketId);
  if (!t || t.status !== "ringing") { closeSlipModal(); return; }
  if (state.gameMode === "verify") {
    if (t.approval !== "pending" || t.reviewer !== Net.myId) { closeSlipModal(); return; }
  }
  if (state.gameMode === "supervisor") {
    if (t.approval !== "awaiting-stamp" || Net.myId !== state.supervisorId) { closeSlipModal(); return; }
  }
}

/* ============================================================
   LOOP (host-authoritative streaming + timer)
   ============================================================ */
function loop() {
  timerHandle = requestAnimationFrame(loop);
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!Net.isHost) return;
  if (state.phase !== "playing") return;

  const prevTime = state.timeLeft;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  // Spawn scheduled calls
  const lvl = LEVELS[state.levelIdx];
  if (lvl) {
    const elapsed = state.duration - state.timeLeft;
    while (state.nextCallIdx < lvl.calls.length && (lvl.calls[state.nextCallIdx]?.at ?? Infinity) <= elapsed) {
      const call = lvl.calls[state.nextCallIdx];
      if (call) hostSpawnTicket(call);
      state.nextCallIdx++;
    }
  }

  let dirty = false;
  const nowMs = Date.now();

  // Stream dialogue lines
  state.tickets.forEach(t => {
    if (t.status !== "live") return;
    const c = t.connection;
    if (!c) return;
    if (c.lineIdx < c.lines.length && nowMs >= c.nextLineAt) {
      const line = c.lines[c.lineIdx];
      if (!line) return;
      const entry = state.log.find(e => e.ticketId === t.id);
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

  // Ring timeouts (escalating) / agency miss
  state.tickets.forEach(t => {
    if (t.status !== "ringing") return;
    if (nowMs < t.timeoutAt) return;
    if (t.kind === "agency") {
      state.teamPenalty += PENALTY_AGENCY;
      t.status = "done";
      broadcastEvent({ type: "agencyMiss", penalty: PENALTY_AGENCY });
    } else {
      const pen = PENALTY_TIMEOUT + PENALTY_TIMEOUT_STEP * (state._timeoutCount || 0);
      state.teamPenalty += pen;
      state._timeoutCount = (state._timeoutCount || 0) + 1;
      t.status = "done";
      broadcastEvent({ type: "timeout", ticketId: t.id, fromId: t.from, penalty: pen });
    }
    dirty = true;
  });

  // Agency scheduling
  if (!state._agencyNextAt) state._agencyNextAt = nowMs + AGENCY_FIRST_DELAY_SEC * 1000;
  const agencyPending = state.tickets.some(t => t.kind === "agency" && t.status === "ringing");
  if (!agencyPending && nowMs >= state._agencyNextAt) {
    const ok = hostSpawnAgency();
    const gap = (AGENCY_MIN_INTERVAL_SEC + Math.random() * (AGENCY_MAX_INTERVAL_SEC - AGENCY_MIN_INTERVAL_SEC)) * 1000;
    state._agencyNextAt = nowMs + (ok ? gap : 9000);
    if (ok) dirty = true;
  }

  // Tick sfx last 10s
  if (Math.floor(prevTime) !== Math.floor(state.timeLeft) && state.timeLeft < 10 && state.timeLeft > 0) {
    broadcastEvent({ type: "tick" });
  }

  _broadcastAccum += dt;
  if (dirty || _broadcastAccum > 0.5) {
    _broadcastAccum = 0;
    broadcastState();
  } else {
    updateHud();
    tickRingBars();
    tickAgencyModal();
  }

  if (state.timeLeft <= 0 && state.phase === "playing") hostEndLevel();
}

/* ============================================================
   CLIENT LOOP — local time interpolation + ring-bar updates
   ============================================================ */
let clientHandle: number | null = null;
function ensureClientLoop() {
  if (Net.isHost) return;        // host runs the authoritative loop()
  if (clientHandle) return;
  clientLoop();
}
function clientLoop() {
  clientHandle = requestAnimationFrame(clientLoop);
  if (state.phase !== "playing") return;
  if (snapTakenAt) {
    const dt = (performance.now() - snapTakenAt) / 1000;
    state.timeLeft = Math.max(0, snapTimeLeft - dt);
  }
  updateHud();
  tickRingBars();
  tickAgencyModal();
}

/* ============================================================
   Misc
   ============================================================ */
function escape(s: unknown) { return String(s).replace(/[&<>"]/g, c => (({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" } as Record<string,string>)[c] ?? c)); }

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}
