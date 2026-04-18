"use strict";

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
const CHARS = {
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

/* ---------- Levels ---------- */
const LEVELS = [
  {
    title: "FIRST SHIFT",
    subtitle: "Tuesday. 7:02pm. Everyone wants the butcher.",
    duration: 110,
    chars: ["mom","butcher","mayor","quack","henderson","dog"],
    calls: [
      { from: "henderson", to: "butcher",   note: "re: pot roast",          at: 1 },
      { from: "mayor",     to: "quack",     note: "re: the duck situation", at: 16 },
      { from: "mom",       to: "dog",       note: "good boy check",         at: 36 },
      { from: "butcher",   to: "henderson", note: "return call",            at: 58 },
      { from: "quack",     to: "mom",       note: "vet bill",               at: 82 },
    ],
    goal: 3,
  },
  {
    title: "RUSH HOUR",
    subtitle: "Everyone wants to talk. Nobody wants to wait.",
    duration: 150,
    chars: ["mom","butcher","mayor","quack","spy","elvis","henderson","dog"],
    calls: [
      { from: "henderson", to: "mayor",     note: "a complaint",        at: 1 },
      { from: "spy",       to: "mom",       note: "URGENT",             at: 14 },
      { from: "elvis",     to: "quack",     note: "it's for the pet",   at: 32 },
      { from: "butcher",   to: "henderson", note: "return call",        at: 52 },
      { from: "mayor",     to: "spy",       note: "off the record",     at: 76 },
      { from: "dog",       to: "mom",       note: "woof",               at: 98 },
      { from: "quack",     to: "butcher",   note: "re: scraps",         at: 122 },
    ],
    goal: 5,
  },
  {
    title: "GRAVEYARD SHIFT",
    subtitle: "After midnight, the signals get… weird.",
    duration: 180,
    chars: ["mom","butcher","mayor","quack","spy","elvis","moon","henderson","ghost","traveler","pope","dog"],
    calls: [
      { from: "ghost",     to: "henderson", note: "unfinished business", at: 1 },
      { from: "moon",      to: "pope",      note: "theological query",   at: 18 },
      { from: "traveler",  to: "mayor",     note: "don't eat the clams", at: 38 },
      { from: "elvis",     to: "mom",       note: "yes, THAT Elvis",     at: 58 },
      { from: "dog",       to: "butcher",   note: "woof",                at: 82 },
      { from: "spy",       to: "ghost",     note: "classified",          at: 106 },
      { from: "pope",      to: "quack",     note: "the swan is ill",     at: 130 },
      { from: "henderson", to: "mayor",     note: "another complaint",   at: 154 },
    ],
    goal: 6,
  },
];

/* ---------- Dialogue: correct routes ---------- */
const CORRECT = {
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
const WRONG = {
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
const CABLES_PER_PLAYER = 3;
const LINE_INTERVAL_MS  = 2100;
const LINE_FIRST_DELAY  = 700;
const RING_TIMEOUT_MS   = 38000;
const SCORE_CORRECT     = 10;
const SCORE_CHAOS       = 4;
const PENALTY_EARLY     = 15;
const PENALTY_TIMEOUT   = 10;

/* ---------- Audio ---------- */
let audioCtx;
function ac() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
function beep(f, d=0.08, type="square", v=0.06) {
  try {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
    g.gain.setValueAtTime(v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + d);
  } catch(e){}
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
};
function unlockAudio() {
  try { const c = ac(); if (c.state === "suspended") c.resume(); beep(1,0.001,"sine",0.0001); } catch(e){}
}

/* ---------- DOM refs ---------- */
const $ = id => document.getElementById(id);
const screens = {
  get title() { return $("title-screen"); },
  get lobby() { return $("lobby-screen"); },
  get game()  { return $("game-screen");  },
  get end()   { return $("end-screen");   },
};
function showScreen(name) {
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
const Net = {
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
  status(msg, kind="") {
    const el = $("net-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "net-status " + kind;
  },

  host(name, onReady) {
    this.isHost = true;
    this.myName = name;
    this._tryHost(onReady);
  },
  _tryHost(onReady, attempt = 0) {
    const code = makeRoomCode();
    this.roomCode = code;
    this.peer = new Peer(code);
    this.peer.on("open", (id) => {
      this.myId = id;
      this.status("HOST READY — code: " + code, "ok");
      if (onReady) onReady();
    });
    this.peer.on("connection", (conn) => {
      this.clientConns.set(conn.peer, conn);
      conn.on("open", () => { if (this.onClientConnect) this.onClientConnect(conn); });
      conn.on("data", (data) => { if (this.onMessage) this.onMessage(conn.peer, data); });
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
        try { this.peer.destroy(); } catch(e){}
        this._tryHost(onReady, attempt + 1);
      } else {
        this.status("HOST ERROR: " + err.type, "err");
      }
    });
  },

  join(code, name, onReady) {
    this.isHost = false;
    this.myName = name;
    this.roomCode = code;
    this.peer = new Peer();
    this.peer.on("open", () => {
      this.myId = this.peer.id;
      const conn = this.peer.connect(code, { reliable: true, metadata: { name } });
      this.hostConn = conn;
      conn.on("open", () => {
        this.status("CONNECTED TO " + code, "ok");
        conn.send({ type: "hello", name });
        if (onReady) onReady();
      });
      conn.on("data", (data) => { if (this.onMessage) this.onMessage(code, data); });
      conn.on("close", () => {
        this.status("DISCONNECTED", "err");
        if (this.onClientDisconnect) this.onClientDisconnect(code);
      });
      conn.on("error", (err) => { this.status("JOIN ERROR: " + (err?.type || "unknown"), "err"); });
    });
    this.peer.on("error", (err) => { this.status("JOIN ERROR: " + err.type, "err"); });
  },

  broadcast(msg) {
    for (const conn of this.clientConns.values()) {
      if (conn.open) { try { conn.send(msg); } catch(e){} }
    }
  },
  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(msg); } catch(e){} }
  },
  leave() {
    try { if (this.peer) this.peer.destroy(); } catch(e){}
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
const state = {
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
  tickets: [],      // {id,from,to,note,status,ringingSince,timeoutAt,connection?}
  log: [],          // {ticketId,from,actual,intended,byPlayer,correct,lines,status,result}
  levelTitle: "",
  levelSubtitle: "",
};
let _nextTicketId = 1;
let lastTick = 0;
let timerHandle = null;
let _broadcastAccum = 0;

/* ---------- Reconciliation caches ---------- */
const plugEls = new Map();          // plugId -> element
const queueEls = new Map();         // "r"+ticketId / "l"+ticketId -> element
const opEls = new Map();            // playerId -> element
const logEls = new Map();           // ticketId -> element (+ .linesEl cached)
const cableEls = new Map();         // ticketId -> svg <g>
let renderedLevelIdx = -1;
let cableSvg = null;

/* ---------- Client timer interpolation anchors ---------- */
let snapTimeLeft = 0;      // last server-reported timeLeft
let snapTakenAt = 0;       // performance.now() when we received it

/* ---------- Utilities ---------- */
function myPlayer() { return state.players.find(p => p.id === Net.myId); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function findLivePlug(plugId) {
  return state.tickets.find(t =>
    t.status === "live" && (t.from === plugId || t.connection?.actualTo === plugId)
  );
}
function isPlugBusy(plugId) {
  return !!findLivePlug(plugId);
}

/* ---------- Host: level lifecycle ---------- */
function hostStartLevel(idx) {
  const lvl = LEVELS[idx];
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
  _nextTicketId = 1;
  state.players.forEach(p => {
    p.maxCables = CABLES_PER_PLAYER;
    p.cables = CABLES_PER_PLAYER;
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

function hostSpawnTicket(call) {
  const now = Date.now();
  state.tickets.push({
    id: _nextTicketId++,
    from: call.from,
    to: call.to,
    note: call.note,
    status: "ringing",
    ringingSince: now,
    timeoutAt: now + RING_TIMEOUT_MS,
    connection: null,
  });
  broadcastState();
  broadcastEvent({ type: "ring" });
}

/* ---------- Dialogue selection ---------- */
function getExchangeLines(fromId, actualId, expectedId) {
  const correct = actualId === expectedId;
  const key = `${fromId}>${actualId}`;
  let base;
  if (correct) {
    base = CORRECT[key] || [
      { s: fromId, t: `Hello, ${CHARS[actualId].name}?` },
      { s: actualId, t: "Speaking." },
      { s: fromId, t: "Just a quick one." },
      { s: actualId, t: "Understood. Goodbye." },
    ];
  } else if (WRONG[key]) {
    base = WRONG[key];
  } else {
    const expectName = CHARS[expectedId].name;
    const actualName = CHARS[actualId].name;
    base = [
      { s: fromId,   t: pick(WRONG_FALLBACK_A).replace("[EXPECT]", expectName) },
      { s: actualId, t: pick(WRONG_FALLBACK_B).replace("[ACTUAL]", actualName) },
      { s: fromId,   t: pick(WRONG_FALLBACK_C) },
    ];
  }
  return [...base, { s: "sys", t: pick(CLOSERS) }];
}

/* ---------- Host: handle actions ---------- */
function hostHandleAction(playerId, msg) {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (state.phase !== "playing") return;

  if (msg.type === "select") {
    if (p.selected) return;
    if (isPlugBusy(msg.plugId)) return;
    const other = state.players.find(x => x.selected === msg.plugId);
    if (other) return;
    const ticket = state.tickets.find(t => t.from === msg.plugId && t.status === "ringing");
    if (!ticket) return;
    if (p.cables <= 0) return;
    p.selected = msg.plugId;
    broadcastState();
  }

  else if (msg.type === "deselect") {
    if (!p.selected) return;
    p.selected = null;
    broadcastState();
  }

  else if (msg.type === "connect") {
    if (!p.selected) return;
    if (p.selected === msg.toId) return;
    if (p.cables <= 0) return;
    const ticket = state.tickets.find(t => t.from === p.selected && t.status === "ringing");
    if (!ticket) return;
    if (isPlugBusy(msg.toId) || isPlugBusy(ticket.from)) return;

    const correct = ticket.to === msg.toId;
    const lines = getExchangeLines(ticket.from, msg.toId, ticket.to);
    const now = Date.now();
    ticket.status = "live";
    ticket.connection = {
      byPlayer: p.id,
      actualTo: msg.toId,
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
      actual: msg.toId,
      intended: ticket.to,
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
  };
}
function broadcastState() {
  const snap = buildSnapshot();
  Net.broadcast(snap);
  applyStateLocally(snap);
}
function broadcastEvent(ev) {
  Net.broadcast({ type: "event", event: ev });
  applyEventLocally(ev);
}
function applyStateLocally(snap) {
  Object.assign(state, {
    phase: snap.phase, levelIdx: snap.levelIdx,
    timeLeft: snap.timeLeft, duration: snap.duration, goal: snap.goal,
    teamScore: snap.teamScore, teamChaos: snap.teamChaos, teamPenalty: snap.teamPenalty,
    correctCount: snap.correctCount,
    tickets: snap.tickets, players: snap.players, log: snap.log,
    levelTitle: snap.levelTitle, levelSubtitle: snap.levelSubtitle,
  });
  snapTimeLeft = snap.timeLeft;
  snapTakenAt = performance.now();
  render();
  ensureClientLoop();
}
function applyEventLocally(ev) {
  if (ev.type === "ring") sfx.ring();
  else if (ev.type === "connect") {
    if (ev.correct) sfx.connect(); else sfx.chaos();
  } else if (ev.type === "disconnected") {
    const rect = plugRect(ev.toId);
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
    const rect = plugRect(ev.fromId);
    if (rect) floater(`−${PENALTY_TIMEOUT} TIMEOUT`, rect.x, rect.y - 20, "chaos");
  } else if (ev.type === "tick") {
    sfx.tick();
  }
}

/* ============================================================
   CLIENT / HOST MESSAGE HANDLERS
   ============================================================ */
Net.onClientConnect = () => {};
Net.onClientDisconnect = (peerId) => {
  if (Net.isHost) {
    const idx = state.players.findIndex(p => p.id === peerId);
    if (idx >= 0) {
      const pl = state.players[idx];
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
Net.onMessage = (peerId, msg) => {
  if (Net.isHost) {
    if (msg.type === "hello") {
      if (!state.players.find(p => p.id === peerId)) {
        const color = PLAYER_COLORS[state.players.length % PLAYER_COLORS.length];
        state.players.push({
          id: peerId,
          name: (msg.name || "OP").toUpperCase().slice(0,14),
          color,
          cables: CABLES_PER_PLAYER,
          maxCables: CABLES_PER_PLAYER,
          selected: null,
        });
        broadcastState();
      }
    } else {
      hostHandleAction(peerId, msg);
    }
  } else {
    if (msg.type === "state") applyStateLocally(msg);
    else if (msg.type === "event") applyEventLocally(msg.event);
  }
};

/* ============================================================
   INPUT
   ============================================================ */
function onPlugClick(plugId) {
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
  if (me.cables <= 0) { sfx.denied(); showToast("no cables free"); return; }
  sendAction({ type: "select", plugId });
  sfx.select();
}

function onCableClick(ticketId) {
  if (state.phase !== "playing") return;
  sendAction({ type: "disconnect", ticketId });
}

function sendAction(msg) {
  if (Net.isHost) hostHandleAction(Net.myId, msg);
  else Net.sendToHost(msg);
}

/* ============================================================
   UI HOOKS
   ============================================================ */
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }

function readName() {
  const inp = $("name-input");
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
        id: Net.myId,
        name: name.toUpperCase().slice(0,14),
        color: PLAYER_COLORS[0],
        cables: CABLES_PER_PLAYER,
        maxCables: CABLES_PER_PLAYER,
        selected: null,
      }];
      Net.myColor = PLAYER_COLORS[0];
      if ($("room-code")) $("room-code").textContent = Net.roomCode;
      if ($("hud-room"))  $("hud-room").textContent  = Net.roomCode;
      showScreen("lobby");
      renderLobby();
    });
  });

  on("join-btn", "click", () => {
    unlockAudio();
    const name = readName();
    const code = ($("room-input")?.value || "").trim().toUpperCase();
    if (!code) { Net.status("enter a room code first", "err"); return; }
    Net.status("connecting...", "");
    Net.join(code, name, () => {
      if ($("room-code")) $("room-code").textContent = code;
      if ($("hud-room"))  $("hud-room").textContent  = code;
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

  on("room-input", "input", (e) => { e.target.value = e.target.value.toUpperCase(); });

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
    if (!screens.game.classList.contains("active")) showScreen("game");
    renderBoard();
    renderQueue();
    renderOperators();
    renderLog();
    renderCables();
    updateHud();
  }
  if (state.phase === "ended") {
    if (!screens.end.classList.contains("active")) showScreen("end");
    renderSummary();
  }
}

function renderLobby() {
  const el = $("lobby-players");
  if (!el) return;
  el.innerHTML = "";
  state.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "lobby-player";
    row.innerHTML = `
      <div class="dot" style="background:${p.color};color:${p.color}"></div>
      <div class="name">${escape(p.name)}</div>
      <div class="tag">${p.id === Net.myId ? (Net.isHost ? "HOST / YOU" : "YOU") : "OPERATOR"}</div>
    `;
    el.appendChild(row);
  });
  if ($("lobby-start-btn")) $("lobby-start-btn").style.display = Net.isHost ? "" : "none";
  if ($("lobby-wait")) $("lobby-wait").style.display = Net.isHost ? "none" : "";
}

function updateHud() {
  if ($("level-num"))    $("level-num").textContent = state.levelIdx + 1;
  if ($("correct-val"))  $("correct-val").textContent = `${state.correctCount} / ${state.goal}`;
  if ($("team-score"))   $("team-score").textContent = state.teamScore + state.teamChaos;
  if ($("team-pen"))     $("team-pen").textContent = "-" + state.teamPenalty;
  const totalMax = state.players.reduce((s,p) => s + p.maxCables, 0);
  const free = state.players.reduce((s,p) => s + p.cables, 0);
  if ($("cables-free"))  $("cables-free").textContent = `${free} / ${totalMax}`;
  if ($("hud-room"))     $("hud-room").textContent = Net.roomCode || "---";
  const pct = Math.max(0, state.duration > 0 ? (state.timeLeft / state.duration) : 0) * 100;
  if ($("timer-fill"))   $("timer-fill").style.width = pct + "%";
}

function renderBoard() {
  const lvl = LEVELS[state.levelIdx];
  const board = $("board");
  if (!board) return;

  // Full rebuild only if level changed
  if (renderedLevelIdx !== state.levelIdx) {
    board.innerHTML = "";
    plugEls.clear();
    const n = lvl.chars.length;
    const cols = n <= 6 ? 3 : n <= 8 ? 4 : 4;
    board.style.gridTemplateColumns = `repeat(${cols}, 92px)`;
    lvl.chars.forEach(id => {
      const c = CHARS[id];
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
    else if (liveTicket) color = state.players.find(p => p.id === liveTicket.connection.byPlayer)?.color;
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
  const ringing = state.tickets.filter(t => t.status === "ringing");
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
    const from = CHARS[t.from], to = CHARS[t.to];
    if (!div) {
      div = document.createElement("div");
      div.className = "ticket";
      div.dataset.tid = t.id;
      div.innerHTML = `
        <span class="num">#${String(t.id).padStart(3,"0")}</span>
        <div class="row"><span class="emoji">${from.emoji}</span><b>${escape(from.name)}</b></div>
        <div class="arrow">│ WANTS ▼</div>
        <div class="row"><span class="emoji">${to.emoji}</span><b>${escape(to.name)}</b></div>
        <div class="note">${escape(t.note || "")}</div>
        <div class="ring-bar"><div class="ring-bar-fill" style="width:100%"></div></div>
      `;
      // Insert before liveHead if present, else append
      if (liveHead) el.insertBefore(div, liveHead); else el.appendChild(div);
      queueEls.set(key, div);
    }
  });

  // Live tickets
  live.forEach(t => {
    const key = "l" + t.id;
    want.add(key);
    let div = queueEls.get(key);
    const from = CHARS[t.from], to = CHARS[t.connection.actualTo];
    const owner = state.players.find(p => p.id === t.connection.byPlayer);
    const color = owner?.color || "#68c6ff";
    if (!div) {
      div = document.createElement("div");
      div.className = "ticket live";
      div.dataset.tid = t.id;
      div.innerHTML = `
        <span class="num">LIVE</span>
        <div class="row"><span class="emoji">${from.emoji}</span>${escape(from.name)} ↔ <span class="emoji">${to.emoji}</span>${escape(to.name)}</div>
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

  // Reorder DOM: ringing first (in state order), liveHead, then live (in state order)
  const fragRinging = ringing.map(t => queueEls.get("r" + t.id)).filter(Boolean);
  const fragLive = live.map(t => queueEls.get("l" + t.id)).filter(Boolean);
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
    const div = queueEls.get("r" + t.id);
    if (!div) return;
    const fill = div.querySelector(".ring-bar-fill");
    if (!fill) return;
    const pct = Math.max(0, (t.timeoutAt - now) / RING_TIMEOUT_MS);
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
  const lvl = LEVELS[state.levelIdx];
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

  if ($("end-title")) $("end-title").textContent = passed
    ? (lastLevel ? "FINAL SHIFT CLEARED • PUNCH OUT" : `${lvl.title} • CLEARED`)
    : `${lvl.title} • SUPERVISOR DISAPPOINTED`;
  if ($("end-blurb")) $("end-blurb").textContent = passed
    ? (lastLevel ? "The board goes dark. The crew did it." : lvl.subtitle)
    : `Crew needed ${state.goal} correct routes. Got ${state.correctCount}.`;

  document.querySelectorAll(".host-only").forEach(el => el.style.display = Net.isHost ? "" : "none");
  if ($("end-wait")) $("end-wait").style.display = Net.isHost ? "none" : "";
  if ($("next-btn")) $("next-btn").textContent = passed ? (lastLevel ? "PLAY AGAIN ▸" : "NEXT SHIFT ▸") : "RETRY SHIFT ▸";
}

/* ============================================================
   CABLES (persistent) / FLOATERS / TOAST
   ============================================================ */
function plugRect(id) {
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
    const a = plugRect(t.from), b = plugRect(t.connection.actualTo);
    if (!a || !b) return;
    const owner = state.players.find(p => p.id === t.connection.byPlayer);
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
      cableSvg.appendChild(g);
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

function floater(text, x, y, kind = "score") {
  const el = document.createElement("div");
  el.className = `floater ${kind}`;
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top  = y + "px";
  $("floater-layer")?.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function showToast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 1500);
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
  const elapsed = state.duration - state.timeLeft;
  while (state.nextCallIdx < lvl.calls.length && lvl.calls[state.nextCallIdx].at <= elapsed) {
    hostSpawnTicket(lvl.calls[state.nextCallIdx]);
    state.nextCallIdx++;
  }

  let dirty = false;
  const nowMs = Date.now();

  // Stream dialogue lines
  state.tickets.forEach(t => {
    if (t.status !== "live") return;
    const c = t.connection;
    if (c.lineIdx < c.lines.length && nowMs >= c.nextLineAt) {
      const line = c.lines[c.lineIdx];
      const entry = state.log.find(e => e.ticketId === t.id);
      if (entry) entry.lines.push(line);
      c.lineIdx += 1;
      if (c.lineIdx >= c.lines.length) {
        c.completed = true;
        c.completedAt = nowMs;
      } else {
        c.nextLineAt = nowMs + LINE_INTERVAL_MS;
      }
      dirty = true;
      broadcastEvent({ type: "line", ticketId: t.id });
    }
  });

  // Ring timeouts
  state.tickets.forEach(t => {
    if (t.status !== "ringing") return;
    if (nowMs >= t.timeoutAt) {
      state.teamPenalty += PENALTY_TIMEOUT;
      t.status = "done";
      broadcastEvent({ type: "timeout", ticketId: t.id, fromId: t.from });
      dirty = true;
    }
  });

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
  }

  if (state.timeLeft <= 0 && state.phase === "playing") hostEndLevel();
}

/* ============================================================
   CLIENT LOOP — local time interpolation + ring-bar updates
   ============================================================ */
let clientHandle = null;
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
}

/* ============================================================
   Misc
   ============================================================ */
function escape(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}
