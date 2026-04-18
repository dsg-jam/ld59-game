"use strict";

/* ============================================================
   SIGNAL CROSS — LDJAM59  (multiplayer via PeerJS)
   ============================================================
   - One player HOSTS (authoritative state, runs game loop).
   - Others JOIN with a room code.
   - Tickets are a shared queue.  Any operator can click a
     ringing plug to claim the call, then click the recipient.
   - Correct routes score points for that operator.  Crossed
     wires score chaos points AND dump a funny exchange into
     the shared call-log panel.
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
    duration: 80,
    chars: ["mom","butcher","mayor","quack","henderson","dog"],
    calls: [
      { from: "henderson", to: "butcher", note: "re: pot roast",          at: 0.5 },
      { from: "mayor",     to: "quack",   note: "re: the duck situation", at: 9 },
      { from: "mom",       to: "dog",     note: "good boy check",         at: 19 },
      { from: "butcher",   to: "henderson", note: "return call",          at: 30 },
      { from: "quack",     to: "mom",     note: "vet bill",               at: 42 },
    ],
    goal: 3,
  },
  {
    title: "RUSH HOUR",
    subtitle: "Everyone wants to talk. Nobody wants to wait.",
    duration: 95,
    chars: ["mom","butcher","mayor","quack","spy","elvis","henderson","dog"],
    calls: [
      { from: "henderson", to: "mayor",     note: "a complaint",       at: 0.5 },
      { from: "spy",       to: "mom",       note: "URGENT",            at: 6 },
      { from: "elvis",     to: "quack",     note: "it's for the pet",  at: 14 },
      { from: "butcher",   to: "henderson", note: "return call",       at: 24 },
      { from: "mayor",     to: "spy",       note: "off the record",    at: 36 },
      { from: "dog",       to: "mom",       note: "woof",              at: 48 },
      { from: "quack",     to: "butcher",   note: "re: scraps",        at: 62 },
    ],
    goal: 5,
  },
  {
    title: "GRAVEYARD SHIFT",
    subtitle: "After midnight, the signals get… weird.",
    duration: 110,
    chars: ["mom","butcher","mayor","quack","spy","elvis","moon","henderson","ghost","traveler","pope","dog"],
    calls: [
      { from: "ghost",     to: "henderson", note: "unfinished business", at: 0.5 },
      { from: "moon",      to: "pope",      note: "theological query",   at: 9 },
      { from: "traveler",  to: "mayor",     note: "don't eat the clams", at: 18 },
      { from: "elvis",     to: "mom",       note: "yes, THAT Elvis",     at: 28 },
      { from: "dog",       to: "butcher",   note: "woof",                at: 40 },
      { from: "spy",       to: "ghost",     note: "classified",          at: 52 },
      { from: "pope",      to: "quack",     note: "the swan is ill",     at: 66 },
      { from: "henderson", to: "mayor",     note: "another complaint",   at: 80 },
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
    { s: "dog", t: "(tail thumping audible through the receiver)" },
    { s: "mom", t: "I KNEW IT." },
  ],
  "butcher>henderson": [
    { s: "butcher",   t: "Edna. About that roast." },
    { s: "henderson", t: "Oh Marty I ALREADY BURNED IT." },
    { s: "butcher",   t: "…I'll bring another one." },
  ],
  "quack>mom": [
    { s: "quack", t: "Ma'am. About last month's bill for the bird." },
    { s: "mom",   t: "The bird is FINE now. You overcharged." },
    { s: "quack", t: "Ma'am I did surgery on a parakeet." },
  ],
  "henderson>mayor": [
    { s: "henderson", t: "Mayor, the streetlight on my corner is buzzing." },
    { s: "mayor",     t: "I'll send someone first thing." },
    { s: "henderson", t: "Also your tie was CROOKED on the news." },
    { s: "mayor",     t: "…noted." },
  ],
  "spy>mom": [
    { s: "spy", t: "Mother. The package is delivered." },
    { s: "mom", t: "Derek honey did you eat today." },
    { s: "spy", t: "Negative. I am behind enemy lines." },
    { s: "mom", t: "There's soup in the freezer." },
  ],
  "elvis>quack": [
    { s: "elvis", t: "Doc, my hound dog's been cryin' all the time." },
    { s: "quack", t: "Sir, are you — are you Elv—" },
    { s: "elvis", t: "Thank you. Thank you very much." },
  ],
  "mayor>spy": [
    { s: "mayor", t: "Agent. We need to talk. Off the record." },
    { s: "spy",   t: "This line is NOT secure, Mayor." },
    { s: "mayor", t: "It's fine, the operator doesn't list—" },
    { s: "spy",   t: "…hi, operator." },
  ],
  "dog>mom": [
    { s: "dog", t: "Woof." },
    { s: "mom", t: "My boy!" },
    { s: "dog", t: "Woof woof." },
  ],
  "quack>butcher": [
    { s: "quack",   t: "Marty. I've got a duck that didn't make it." },
    { s: "butcher", t: "Say no more." },
    { s: "quack",   t: "I was about to say something else." },
    { s: "butcher", t: "Say no more." },
  ],
  "ghost>henderson": [
    { s: "ghost",     t: "EEEEDDDNNAAAaaaa……" },
    { s: "henderson", t: "Carl?? Carl is that you??" },
    { s: "ghost",     t: "YES EDNA. FROM BEYOND." },
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
    { s: "elvis", t: "Ma'am, are you missin' a son who sings a little." },
    { s: "mom",   t: "…Derek is that YOU—" },
    { s: "elvis", t: "No ma'am. Wrong number. But bless you." },
    { s: "mom",   t: "*sobbing quietly*" },
  ],
  "dog>butcher": [
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "…how did you dial." },
    { s: "dog",     t: "Woof." },
    { s: "butcher", t: "I'll be right over with scraps." },
  ],
  "spy>ghost": [
    { s: "spy",   t: "Asset ZERO, confirm status." },
    { s: "ghost", t: "I HAVE BEEN DEAD FOR FORTY YEARS." },
    { s: "spy",   t: "Confirmed: asset stable." },
  ],
  "pope>quack": [
    { s: "pope",  t: "Doctor. The basilica swan appears unwell." },
    { s: "quack", t: "How unwell, exactly?" },
    { s: "pope",  t: "She hissed at a cardinal." },
    { s: "quack", t: "That's just swans." },
  ],
};

/* ---------- Dialogue: misconnects ---------- */
const WRONG = {
  "henderson>ghost": [
    { s: "henderson", t: "Marty?? Connection is AWFUL." },
    { s: "ghost",     t: "ooooooOOOOOoooo……" },
    { s: "henderson", t: "Oh. Oh hello Carl." },
    { s: "henderson", t: "You still owe me twelve dollars." },
  ],
  "moon>quack": [
    { s: "moon",  t: "Doctor. The tides are acting up." },
    { s: "quack", t: "Ma'am this is a veterinary line." },
    { s: "moon",  t: "I KNOW." },
  ],
  "elvis>pope": [
    { s: "elvis", t: "Doc I got a hound dog situation—" },
    { s: "pope",  t: "My son, this is the Holy See." },
    { s: "elvis", t: "Oh. Thank you, thank you very much, Your Holiness." },
    { s: "pope",  t: "…may your hound find peace." },
  ],
  "spy>mom": [
    { s: "spy", t: "Contact. This is Nimbus. Package in motion." },
    { s: "mom", t: "Derek did you call your AUNT yet." },
    { s: "spy", t: "…abort. Abort." },
  ],
  "mayor>henderson": [
    { s: "mayor",     t: "Chief, I need that report on my desk by—" },
    { s: "henderson", t: "MAYOR your tie was CROOKED on the news." },
    { s: "mayor",     t: "OPERATOR!!" },
  ],
  "traveler>butcher": [
    { s: "traveler", t: "Mayor. DO NOT eat the clams at the gala." },
    { s: "butcher",  t: "Pal, this is a meat counter." },
    { s: "traveler", t: "Then also: do not stock clams next Thursday." },
    { s: "butcher",  t: "…noted." },
  ],
  "ghost>butcher": [
    { s: "ghost",   t: "FLLLEEESSSHHH……" },
    { s: "butcher", t: "Sir we're closed." },
    { s: "ghost",   t: "FLESH?????" },
    { s: "butcher", t: "Tuesday special is chuck roast." },
  ],
  "dog>mayor": [
    { s: "dog",   t: "Woof." },
    { s: "mayor", t: "Is this about the fountain ducks." },
    { s: "dog",   t: "Woof." },
    { s: "mayor", t: "It always is." },
  ],
  "pope>butcher": [
    { s: "pope",    t: "Doctor, the swan—" },
    { s: "butcher", t: "We got swan in Tuesday." },
    { s: "pope",    t: "WE DO NOT." },
  ],
  "moon>mom": [
    { s: "moon", t: "Hello. I'm the Moon." },
    { s: "mom",  t: "Derek if this is a prank—" },
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
    { s: "elvis",     t: "Ma'am, hound dog situation—" },
    { s: "henderson", t: "MARTY! It's that singer!" },
    { s: "elvis",     t: "I just need a vet, ma'am." },
    { s: "henderson", t: "Marty's on his way." },
  ],
  "spy>elvis": [
    { s: "spy",   t: "Contact ZULU. Extract protocol." },
    { s: "elvis", t: "Partner I don't know who Zulu is but I'm in." },
    { s: "spy",   t: "…who is this." },
    { s: "elvis", t: "The King, baby." },
  ],
  "spy>butcher": [
    { s: "spy",     t: "Transmission. Package frozen. Repeat — frozen." },
    { s: "butcher", t: "Pal we got a freezer sale." },
    { s: "spy",     t: "…the asset is a pork loin?" },
    { s: "butcher", t: "It can be." },
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
  "…right. Sorry. Put me back.",
  "Nevermind. Operator!",
  "Forget I called.",
  "Hello? Wait no. Hang up.",
];

/* ---------- Colors assigned to players ---------- */
const PLAYER_COLORS = ["#68c6ff","#6fe07a","#ffd561","#ff8fc8","#c792ea","#7fe0c4","#ffae6c","#ff5a4e"];

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
  ring:    () => { beep(880,0.12); setTimeout(()=>beep(880,0.12), 180); },
  select:  () => beep(660,0.05),
  connect: () => { beep(523,0.06); setTimeout(()=>beep(784,0.10), 70); },
  chaos:   () => { beep(300,0.08); setTimeout(()=>beep(450,0.08), 70); setTimeout(()=>beep(250,0.14,"sawtooth"), 140); },
  wrong:   () => { beep(220,0.15,"sawtooth",0.07); setTimeout(()=>beep(180,0.18,"sawtooth",0.07), 120); },
  tick:    () => beep(1200,0.02,"square",0.03),
  denied:  () => beep(160,0.15,"triangle",0.05),
};
function unlockAudio() {
  try { const c = ac(); if (c.state === "suspended") c.resume(); beep(1,0.001,"sine",0.0001); } catch(e){}
}

/* ---------- DOM refs ---------- */
const $ = id => document.getElementById(id);
const screens = {
  title: $("title-screen"),
  lobby: $("lobby-screen"),
  game:  $("game-screen"),
  end:   $("end-screen"),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
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
  hostConn: null,             // client → host connection
  clientConns: new Map(),     // host: peerId → DataConnection
  onReady: null,
  onMessage: null,
  onClientConnect: null,
  onClientDisconnect: null,
  status(msg, kind="") { const el = $("net-status"); el.textContent = msg; el.className = "net-status " + kind; },

  host(name, onReady) {
    this.isHost = true;
    this.myName = name;
    this.onReady = onReady;
    this._tryHost();
  },
  _tryHost(attempt = 0) {
    const code = makeRoomCode();
    this.roomCode = code;
    this.peer = new Peer(code);
    this.peer.on("open", (id) => {
      this.myId = id;
      this.status("HOST READY — code: " + code, "ok");
      if (this.onReady) this.onReady();
    });
    this.peer.on("connection", (conn) => {
      this.clientConns.set(conn.peer, conn);
      conn.on("open", () => {
        if (this.onClientConnect) this.onClientConnect(conn);
      });
      conn.on("data", (data) => {
        if (this.onMessage) this.onMessage(conn.peer, data);
      });
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
        this._tryHost(attempt + 1);
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
    this.peer.on("open", (id) => {
      this.myId = id;
      const conn = this.peer.connect(code, { reliable: true, metadata: { name } });
      this.hostConn = conn;
      conn.on("open", () => {
        this.status("CONNECTED TO " + code, "ok");
        conn.send({ type: "hello", name });
        if (onReady) onReady();
      });
      conn.on("data", (data) => {
        if (this.onMessage) this.onMessage(code, data);
      });
      conn.on("close", () => {
        this.status("DISCONNECTED", "err");
        if (this.onClientDisconnect) this.onClientDisconnect(code);
      });
      conn.on("error", (err) => {
        this.status("JOIN ERROR: " + (err?.type || "unknown"), "err");
      });
    });
    this.peer.on("error", (err) => {
      this.status("JOIN ERROR: " + err.type, "err");
    });
  },

  broadcast(msg) {
    // host → all clients
    for (const conn of this.clientConns.values()) {
      if (conn.open) {
        try { conn.send(msg); } catch(e){}
      }
    }
  },
  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) {
      try { this.hostConn.send(msg); } catch(e){}
    }
  },
  sendToPeer(peerId, msg) {
    const conn = this.clientConns.get(peerId);
    if (conn && conn.open) { try { conn.send(msg); } catch(e){} }
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
   SHARED STATE (host is authoritative)
   ============================================================ */
const state = {
  phase: "lobby",          // "lobby" | "playing" | "ended"
  levelIdx: 0,
  timeLeft: 0,
  duration: 0,
  goal: 0,
  tickets: [],             // { id, from, to, note, done, claimedBy }
  nextCallIdx: 0,
  players: [],             // { id, name, color, score, chaos, completed, selected }
  log: [],                 // { id, ts, correct, routedBy, lines:[{s,t}] }
  levelTitle: "",
  levelSubtitle: "",
};

let _nextTicketId = 1;
let _nextLogId = 1;
let lastTick = 0;
let timerHandle = null;

/* ---------- Utilities ---------- */
function myPlayer() { return state.players.find(p => p.id === Net.myId); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/* ---------- Host-only: create/advance state ---------- */
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
  state.levelTitle = lvl.title;
  state.levelSubtitle = lvl.subtitle;
  _nextTicketId = 1;
  _nextLogId = 1;
  state.players.forEach(p => { p.score = 0; p.chaos = 0; p.completed = 0; p.selected = null; });

  broadcastState();
  if (!timerHandle) { lastTick = performance.now(); loop(); }
}

function hostSpawnTicket(call) {
  const t = {
    id: _nextTicketId++,
    from: call.from,
    to: call.to,
    note: call.note,
    done: false,
    claimedBy: null,
  };
  state.tickets.push(t);
  broadcastState();
}

function hostEndLevel() {
  state.phase = "ended";
  broadcastState();
}

/* ---------- Host: handle client action ---------- */
function hostHandleAction(playerId, msg) {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (msg.type === "select") {
    if (state.phase !== "playing") return;
    // plug must have ringing (unclaimed by anyone, ticket !done)
    const other = state.players.find(x => x.selected === msg.plugId);
    if (other) return; // someone else has it
    // must correspond to a ringing ticket
    const ticket = state.tickets.find(t => t.from === msg.plugId && !t.done && !t.claimedBy);
    if (!ticket) return;
    // release any previous selection
    p.selected = msg.plugId;
    ticket.claimedBy = p.id;
    broadcastState();
  } else if (msg.type === "deselect") {
    if (!p.selected) return;
    const ticket = state.tickets.find(t => t.from === p.selected && !t.done && t.claimedBy === p.id);
    if (ticket) ticket.claimedBy = null;
    p.selected = null;
    broadcastState();
  } else if (msg.type === "connect") {
    if (state.phase !== "playing") return;
    if (!p.selected) return;
    if (p.selected === msg.toId) return;
    const ticket = state.tickets.find(t => t.from === p.selected && !t.done && t.claimedBy === p.id);
    if (!ticket) return;
    const correct = ticket.to === msg.toId;
    ticket.done = true;
    ticket.claimedBy = null;
    p.selected = null;
    if (correct) {
      p.score += 10;
      p.completed += 1;
    } else {
      p.chaos += 15;
    }
    // log
    const lines = getExchangeLines(ticket.from, msg.toId, ticket.to);
    state.log.unshift({
      id: _nextLogId++,
      ts: Date.now(),
      correct,
      routedBy: p.id,
      from: ticket.from,
      actual: msg.toId,
      intended: ticket.to,
      lines,
    });
    if (state.log.length > 24) state.log.length = 24;
    broadcastState();
    // Push a transient event for floaters/sfx (clients render their own)
    broadcastEvent({ type: "resolved", correct, routedBy: p.id, toId: msg.toId, fromId: ticket.from });
    // Check end
    const lvl = LEVELS[state.levelIdx];
    const allSpawned = state.nextCallIdx >= lvl.calls.length;
    const allDone = state.tickets.every(t => t.done);
    if (allSpawned && allDone) {
      const bonus = Math.max(0, Math.floor(state.timeLeft) * 2);
      if (bonus > 0) p.score += bonus; // awarded to the last operator
      setTimeout(hostEndLevel, 700);
    }
  }
}

/* ---------- Dialogue selection ---------- */
function getExchangeLines(fromId, actualId, expectedId) {
  const correct = actualId === expectedId;
  const key = `${fromId}>${actualId}`;
  if (correct) {
    if (CORRECT[key]) return CORRECT[key];
    return [
      { s: fromId, t: `Hello, ${CHARS[actualId].name}?` },
      { s: actualId, t: `Speaking.` },
      { s: fromId, t: `I'll keep this brief.` },
    ];
  }
  if (WRONG[key]) return WRONG[key];
  const expectName = CHARS[expectedId].name;
  const actualName = CHARS[actualId].name;
  return [
    { s: fromId,   t: pick(WRONG_FALLBACK_A).replace("[EXPECT]", expectName) },
    { s: actualId, t: pick(WRONG_FALLBACK_B).replace("[ACTUAL]", actualName) },
    { s: fromId,   t: pick(WRONG_FALLBACK_C) },
  ];
}

/* ---------- Host: state sync ---------- */
function buildSnapshot() {
  return {
    type: "state",
    phase: state.phase,
    levelIdx: state.levelIdx,
    timeLeft: state.timeLeft,
    duration: state.duration,
    goal: state.goal,
    tickets: state.tickets,
    players: state.players,
    log: state.log,
    levelTitle: state.levelTitle,
    levelSubtitle: state.levelSubtitle,
  };
}
function broadcastState() {
  const snap = buildSnapshot();
  Net.broadcast(snap);
  applyStateLocally(snap); // host also uses
}
function broadcastEvent(ev) {
  Net.broadcast({ type: "event", event: ev });
  applyEventLocally(ev);
}

function applyStateLocally(snap) {
  state.phase = snap.phase;
  state.levelIdx = snap.levelIdx;
  state.timeLeft = snap.timeLeft;
  state.duration = snap.duration;
  state.goal = snap.goal;
  state.tickets = snap.tickets;
  state.players = snap.players;
  state.log = snap.log;
  state.levelTitle = snap.levelTitle;
  state.levelSubtitle = snap.levelSubtitle;
  render();
}
function applyEventLocally(ev) {
  if (ev.type === "resolved") {
    if (ev.correct) sfx.connect(); else sfx.chaos();
    const rect = plugRect(ev.toId);
    if (rect) {
      const kind = ev.correct ? "score" : "chaos";
      const text = ev.correct ? "+10 ROUTED" : "+15 CHAOS!";
      floater(text, rect.x, rect.y - 20, kind);
    }
    // Briefly draw cable
    const player = state.players.find(p => p.id === ev.routedBy);
    drawCableFlash(ev.fromId, ev.toId, ev.correct ? "#6fe07a" : "#ff5a4e");
  } else if (ev.type === "ring") {
    sfx.ring();
  } else if (ev.type === "tick") {
    sfx.tick();
  }
}

/* ============================================================
   CLIENT / HOST MESSAGE HANDLERS
   ============================================================ */
Net.onClientConnect = (conn) => {
  // Wait for hello to bind a player
};
Net.onClientDisconnect = (peerId) => {
  if (Net.isHost) {
    const idx = state.players.findIndex(p => p.id === peerId);
    if (idx >= 0) {
      // release their claim
      const pl = state.players[idx];
      if (pl.selected) {
        const ticket = state.tickets.find(t => t.from === pl.selected && t.claimedBy === pl.id);
        if (ticket) ticket.claimedBy = null;
      }
      state.players.splice(idx, 1);
      broadcastState();
    }
  } else {
    // host disconnected
    showToast("Host disconnected. Returning to title.");
    setTimeout(() => { Net.leave(); resetLocal(); showScreen("title"); }, 1500);
  }
};
Net.onMessage = (peerId, msg) => {
  if (Net.isHost) {
    if (msg.type === "hello") {
      // add player
      if (!state.players.find(p => p.id === peerId)) {
        const color = PLAYER_COLORS[state.players.length % PLAYER_COLORS.length];
        state.players.push({ id: peerId, name: (msg.name || "OP").toUpperCase().slice(0,14), color, score: 0, chaos: 0, completed: 0, selected: null });
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
   UI HOOKS
   ============================================================ */

/* Title */
$("host-btn").addEventListener("click", () => {
  unlockAudio();
  const name = readName();
  Net.status("opening host channel...", "");
  Net.host(name, () => {
    // add self as first player
    state.players = [{ id: Net.myId, name: name.toUpperCase().slice(0,14), color: PLAYER_COLORS[0], score: 0, chaos: 0, completed: 0, selected: null }];
    Net.myColor = PLAYER_COLORS[0];
    $("room-code").textContent = Net.roomCode;
    $("hud-room").textContent = Net.roomCode;
    showScreen("lobby");
    renderLobby();
  });
});

$("join-btn").addEventListener("click", () => {
  unlockAudio();
  const name = readName();
  const code = $("room-input").value.trim().toUpperCase();
  if (!code) { Net.status("enter a room code first", "err"); return; }
  Net.status("connecting...", "");
  Net.join(code, name, () => {
    $("room-code").textContent = code;
    $("hud-room").textContent = code;
    showScreen("lobby");
    renderLobby();
  });
});

function readName() {
  let n = ($("name-input").value || "").trim();
  if (!n) { n = "OP-" + Math.floor(100 + Math.random()*900); $("name-input").value = n; }
  return n;
}

/* Lobby */
$("lobby-start-btn").addEventListener("click", () => {
  if (!Net.isHost) return;
  hostStartLevel(0);
  showScreen("game");
});
$("copy-btn").addEventListener("click", () => {
  const code = $("room-code").textContent;
  if (!code) return;
  navigator.clipboard?.writeText(code).catch(()=>{});
  showToast("copied " + code);
});
$("lobby-leave-btn").addEventListener("click", leaveRoom);
$("end-leave-btn").addEventListener("click", leaveRoom);

/* End-of-shift */
$("next-btn").addEventListener("click", () => {
  if (!Net.isHost) return;
  if (state.levelIdx + 1 >= LEVELS.length) {
    // loop back to first shift
    hostStartLevel(0);
  } else {
    hostStartLevel(state.levelIdx + 1);
  }
  showScreen("game");
});
$("replay-btn").addEventListener("click", () => {
  if (!Net.isHost) return;
  hostStartLevel(state.levelIdx);
  showScreen("game");
});

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
  if (timerHandle) { cancelAnimationFrame(timerHandle); timerHandle = null; }
  $("board").innerHTML = "";
  $("queue").innerHTML = "";
  $("operators").innerHTML = "";
  $("log").innerHTML = "";
  clearCables();
}

/* ============================================================
   PLAYER INPUT (local → sends action up to host)
   ============================================================ */
function onPlugClick(plugId) {
  if (state.phase !== "playing") return;
  const me = myPlayer();
  if (!me) return;
  if (me.selected && me.selected !== plugId) {
    sendAction({ type: "connect", toId: plugId });
    return;
  }
  if (me.selected === plugId) {
    sendAction({ type: "deselect" });
    return;
  }
  // not selected; try to claim ringing plug
  const ticket = state.tickets.find(t => t.from === plugId && !t.done && !t.claimedBy);
  if (!ticket) { sfx.denied(); return; }
  sendAction({ type: "select", plugId });
  sfx.select();
}
function onPlugRightClick(e, plugId) {
  e.preventDefault();
  const me = myPlayer();
  if (me && me.selected) sendAction({ type: "deselect" });
}
function sendAction(msg) {
  if (Net.isHost) {
    hostHandleAction(Net.myId, msg);
  } else {
    Net.sendToHost(msg);
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  if (state.phase === "lobby")  renderLobby();
  if (state.phase === "playing") { ensureGameScreen(); renderBoard(); renderQueue(); renderOperators(); renderLog(); updateHud(); }
  if (state.phase === "ended")  { ensureEndScreen();  renderLeaderboard(); }
}

function ensureGameScreen() { if (!screens.game.classList.contains("active")) showScreen("game"); }
function ensureEndScreen()  { if (!screens.end.classList.contains("active"))  showScreen("end");  }

function renderLobby() {
  const el = $("lobby-players");
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
  $("lobby-start-btn").style.display = Net.isHost ? "" : "none";
  $("lobby-wait").style.display = Net.isHost ? "none" : "";
}

function updateHud() {
  $("level-num").textContent = state.levelIdx + 1;
  $("goal-val").textContent  = `${(myPlayer()?.completed || 0)} / ${state.goal}`;
  $("hud-room").textContent  = Net.roomCode || "---";
  const pct = Math.max(0, state.duration > 0 ? (state.timeLeft / state.duration) : 0) * 100;
  $("timer-fill").style.width = pct + "%";
}

function renderBoard() {
  const lvl = LEVELS[state.levelIdx];
  const board = $("board");
  board.innerHTML = "";
  const n = lvl.chars.length;
  const cols = n <= 6 ? 3 : n <= 8 ? 4 : 4;
  board.style.gridTemplateColumns = `repeat(${cols}, 92px)`;

  lvl.chars.forEach(id => {
    const c = CHARS[id];
    const el = document.createElement("div");
    el.className = "plug";
    el.dataset.id = id;
    const ticket = state.tickets.find(t => t.from === id && !t.done);
    const ringing = ticket && !ticket.claimedBy;
    const claimer = state.players.find(p => p.selected === id);
    if (ringing) el.classList.add("ringing");
    if (claimer) {
      if (claimer.id === Net.myId) el.classList.add("claimed-self");
      else el.classList.add("claimed-other");
      el.style.setProperty("--claimColor", claimer.color);
    }
    el.innerHTML = `
      <div class="bulb"></div>
      <div class="jack"></div>
      <div class="emoji">${c.emoji}</div>
      <div class="name">${c.name}</div>
      ${claimer ? `<div class="claim-tag" style="--claimColor:${claimer.color}">${escape(claimer.name)}</div>` : ""}
    `;
    el.addEventListener("click", () => onPlugClick(id));
    el.addEventListener("contextmenu", (e) => onPlugRightClick(e, id));
    board.appendChild(el);
  });

  // Redraw claim cables (static while claimed)
  redrawClaimCables();
}

function renderQueue() {
  const el = $("queue");
  el.innerHTML = "";
  state.tickets.filter(t => !t.done).forEach(t => {
    const from = CHARS[t.from], to = CHARS[t.to];
    const div = document.createElement("div");
    div.className = "ticket";
    div.innerHTML = `
      <span class="num">#${String(t.id).padStart(3,"0")}</span>
      <div class="row"><span class="emoji">${from.emoji}</span><b>${escape(from.name)}</b></div>
      <div class="arrow">│ WANTS ▼</div>
      <div class="row"><span class="emoji">${to.emoji}</span><b>${escape(to.name)}</b></div>
      <div class="note">${escape(t.note || "")}</div>
    `;
    el.appendChild(div);
  });
}

function renderOperators() {
  const el = $("operators");
  el.innerHTML = "";
  state.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "op-row" + (p.id === Net.myId ? " self" : "");
    row.innerHTML = `
      <div class="dot" style="background:${p.color};color:${p.color}"></div>
      <div class="name">${escape(p.name)}</div>
      <div class="score">${p.score}</div>
      <div class="chaos">${p.chaos}</div>
    `;
    el.appendChild(row);
  });
}

function renderLog() {
  const el = $("log");
  el.innerHTML = "";
  state.log.forEach(entry => {
    const routedBy = state.players.find(p => p.id === entry.routedBy);
    const div = document.createElement("div");
    div.className = "entry";
    const headerCls = entry.correct ? "ok" : "chaos";
    const label = entry.correct ? "ROUTED" : "CROSSED WIRES";
    const fromName = CHARS[entry.from]?.name || "";
    const actualName = CHARS[entry.actual]?.name || "";
    div.innerHTML = `
      <div class="header ${headerCls}">
        ${label} · ${escape(fromName)} → ${escape(actualName)}
        <span style="color:${routedBy?.color || '#999'}; margin-left:6px;">by ${escape(routedBy?.name || "—")}</span>
      </div>
      ${entry.lines.map(l => `<span class="line ${l.s === "sys" ? "system" : ""}"><span class="speaker">${escape(CHARS[l.s]?.name || "")}${l.s === "sys" ? "" : ":"}</span> ${escape(l.t)}</span>`).join("")}
    `;
    el.appendChild(div);
  });
}

function renderLeaderboard() {
  const lb = $("leaderboard");
  lb.innerHTML = "";
  const head = document.createElement("div");
  head.className = "lb-head";
  head.innerHTML = `<div>#</div><div></div><div>OPERATOR</div><div style="text-align:right">ROUTED</div><div style="text-align:right">CHAOS</div><div style="text-align:right">TOTAL</div>`;
  lb.appendChild(head);
  const sorted = [...state.players].sort((a,b) => (b.score + b.chaos) - (a.score + a.chaos));
  sorted.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "lb-row" + (i === 0 ? " first" : "");
    row.innerHTML = `
      <div class="rank">${i+1}</div>
      <div class="dot" style="background:${p.color};color:${p.color}"></div>
      <div class="name">${escape(p.name)}${p.id === Net.myId ? " ★" : ""}</div>
      <div class="score">${p.score}</div>
      <div class="chaos">${p.chaos}</div>
      <div class="total">${p.score + p.chaos}</div>
    `;
    lb.appendChild(row);
  });

  const me = myPlayer();
  const passed = (me?.completed || 0) >= state.goal || state.players.some(p => p.completed >= state.goal);
  const lvl = LEVELS[state.levelIdx];
  const lastLevel = state.levelIdx + 1 >= LEVELS.length;

  $("end-title").textContent = passed
    ? (lastLevel ? "FINAL SHIFT CLEARED • PUNCH OUT" : `${lvl.title} • CLEARED`)
    : `${lvl.title} • SUPERVISOR DISAPPOINTED`;
  $("end-blurb").textContent = passed
    ? (lastLevel ? "The board goes dark. You earned every cent." : lvl.subtitle)
    : `Crew needed ${state.goal} correct routes. Best was ${Math.max(0, ...state.players.map(p=>p.completed))}.`;

  // host-only buttons
  const hostOnly = document.querySelectorAll(".host-only");
  hostOnly.forEach(el => el.style.display = Net.isHost ? "" : "none");
  $("end-wait").style.display = Net.isHost ? "none" : "";
  if (passed) { $("next-btn").textContent = lastLevel ? "PLAY AGAIN ▸" : "NEXT SHIFT ▸"; }
  else { $("next-btn").textContent = "RETRY SHIFT ▸"; }
}

/* ============================================================
   CABLES / FLOATERS
   ============================================================ */
function plugRect(id) {
  const el = $("board").querySelector(`[data-id="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}
function clearCables() { $("cable-layer").innerHTML = ""; }

function redrawClaimCables() {
  // Only draw the "selected-plug glow" (cable follows the mouse? — nope, just dot on plug).
  // Actually we don't draw dangling cables; just keep layer for flashes.
  // Kept for extension.
}

function drawCableFlash(fromId, toId, color) {
  const a = plugRect(fromId), b = plugRect(toId);
  if (!a || !b) return;
  const layer = $("cable-layer");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("style", "opacity:1;transition:opacity 0.9s;");
  svg.innerHTML = `
    <path d="M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${Math.max(a.y,b.y)+80}, ${b.x} ${b.y}"
          stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85" />
    <circle cx="${a.x}" cy="${a.y}" r="6" fill="${color}" />
    <circle cx="${b.x}" cy="${b.y}" r="6" fill="${color}" />
  `;
  layer.appendChild(svg);
  requestAnimationFrame(() => { svg.style.opacity = "0"; });
  setTimeout(() => svg.remove(), 900);
}

function floater(text, x, y, kind = "score") {
  const el = document.createElement("div");
  el.className = `floater ${kind}`;
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top  = y + "px";
  $("floater-layer").appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 1500);
}

/* ============================================================
   LOOP (host only)
   ============================================================ */
function loop() {
  timerHandle = requestAnimationFrame(loop);
  if (!Net.isHost) return;
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (state.phase !== "playing") return;

  const prevTime = state.timeLeft;
  state.timeLeft = Math.max(0, state.timeLeft - dt);

  // Spawn calls
  const lvl = LEVELS[state.levelIdx];
  const elapsed = state.duration - state.timeLeft;
  while (state.nextCallIdx < lvl.calls.length && lvl.calls[state.nextCallIdx].at <= elapsed) {
    hostSpawnTicket(lvl.calls[state.nextCallIdx]);
    broadcastEvent({ type: "ring" });
    state.nextCallIdx++;
  }

  // tick sfx in last 10s
  if (Math.floor(prevTime) !== Math.floor(state.timeLeft) && state.timeLeft < 10 && state.timeLeft > 0) {
    broadcastEvent({ type: "tick" });
  }

  // Broadcast periodic state for timer/HUD (every ~250ms)
  state._broadcastAccum = (state._broadcastAccum || 0) + dt;
  if (state._broadcastAccum > 0.25) {
    state._broadcastAccum = 0;
    broadcastState();
  } else {
    updateHud();
  }

  if (state.timeLeft <= 0 && state.phase === "playing") {
    hostEndLevel();
  }
}

/* ============================================================
   Misc
   ============================================================ */
function escape(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

// Uppercase room-input as user types
$("room-input").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });

// Global right-click on board deselects
document.addEventListener("contextmenu", (e) => {
  if (state.phase === "playing" && screens.game.classList.contains("active")) {
    const me = myPlayer();
    if (me && me.selected) { e.preventDefault(); sendAction({ type: "deselect" }); }
  }
});

// Keyboard: Esc deselects
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.phase === "playing") {
    const me = myPlayer();
    if (me && me.selected) sendAction({ type: "deselect" });
  }
});

showScreen("title");
