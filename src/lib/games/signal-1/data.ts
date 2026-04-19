import type { CharDef, DialogLine, LevelDef } from "./types";

export const CHARS: Record<string, CharDef> = {
  mom: { name: "Mom", emoji: "👩" },
  butcher: { name: "The Butcher", emoji: "🔪" },
  mayor: { name: "Mayor Pibbley", emoji: "🎩" },
  quack: { name: "Dr. Quackers", emoji: "🦆" },
  spy: { name: "Agent Nimbus", emoji: "🕶️" },
  elvis: { name: "Elvis?", emoji: "🎸" },
  moon: { name: "The Moon", emoji: "🌙" },
  henderson: { name: "Mrs. H.", emoji: "👵" },
  ghost: { name: "Ghost Line", emoji: "👻" },
  traveler: { name: "Time Traveler", emoji: "⏳" },
  pope: { name: "The Pope", emoji: "⛪" },
  dog: { name: "Tired Dog", emoji: "🐕" },
  agency: { name: "The Agency", emoji: "🕴" },
};

export const LEVELS: LevelDef[] = [
  {
    title: "FIRST SHIFT",
    subtitle: "Tuesday. 7:02pm. The board will not wait.",
    duration: 95,
    ringTimeoutSec: 20,
    lineIntervalMs: 1500,
    chars: ["mom", "butcher", "mayor", "quack", "henderson", "dog"],
    calls: [
      { from: "henderson", to: "butcher", note: "re: pot roast", at: 1 },
      { from: "mayor", to: "quack", note: "re: the duck situation", at: 8 },
      { from: "mom", to: "dog", note: "good boy check", at: 18 },
      { from: "butcher", to: "henderson", note: "return call", at: 26 },
      { from: "quack", to: "mom", note: "vet bill", at: 38 },
      { from: "dog", to: "butcher", note: "scraps plz", at: 52 },
      { from: "henderson", to: "quack", note: "bird advice", at: 66 },
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
    chars: ["mom", "butcher", "mayor", "quack", "spy", "elvis", "henderson", "dog"],
    calls: [
      { from: "henderson", to: "mayor", note: "a complaint", at: 1 },
      { from: "spy", to: "mom", note: "URGENT", at: 8 },
      { from: "elvis", to: "quack", note: "it's for the pet", at: 16 },
      { from: "butcher", to: "henderson", note: "return call", at: 22 },
      { from: "mayor", to: "spy", note: "off the record", at: 32 },
      { from: "dog", to: "mom", note: "woof", at: 42 },
      { from: "quack", to: "butcher", note: "re: scraps", at: 54 },
      { from: "henderson", to: "butcher", note: "ANOTHER roast", at: 66 },
      { from: "elvis", to: "mom", note: "wrong ma?", at: 80 },
      { from: "spy", to: "mayor", note: "abort abort", at: 94 },
      { from: "mom", to: "dog", note: "dinner time", at: 108 },
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
    chars: [
      "mom",
      "butcher",
      "mayor",
      "quack",
      "spy",
      "elvis",
      "moon",
      "henderson",
      "ghost",
      "traveler",
      "pope",
      "dog",
    ],
    calls: [
      { from: "ghost", to: "henderson", note: "unfinished business", at: 1 },
      { from: "moon", to: "pope", note: "theological query", at: 8 },
      { from: "traveler", to: "mayor", note: "don't eat the clams", at: 16 },
      { from: "elvis", to: "mom", note: "yes, THAT Elvis", at: 24 },
      { from: "dog", to: "butcher", note: "woof", at: 34 },
      { from: "spy", to: "ghost", note: "classified", at: 44 },
      { from: "pope", to: "quack", note: "the swan is ill", at: 54 },
      { from: "henderson", to: "mayor", note: "another complaint", at: 66 },
      { from: "ghost", to: "spy", note: "message from beyond", at: 80 },
      { from: "moon", to: "mom", note: "are you eating", at: 94 },
      { from: "traveler", to: "butcher", note: "clams again", at: 108 },
      { from: "elvis", to: "henderson", note: "hound help", at: 122 },
      { from: "pope", to: "moon", note: "correction", at: 136 },
    ],
    goal: 10,
    restricted: ["ghost", "spy", "moon"],
  },
];

export const CORRECT: Record<string, DialogLine[]> = {
  "henderson>butcher": [
    { s: "henderson", t: "Marty dear, quick question about the pot roast." },
    { s: "butcher", t: "Three-twenty-five, ma'am. Three hours. Like Sunday." },
    { s: "henderson", t: "And Tuesday. And Thursday." },
    { s: "butcher", t: "…I know. Goodbye, Edna." },
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
    { s: "butcher", t: "Edna. About that roast." },
    { s: "henderson", t: "Oh Marty I ALREADY BURNED IT." },
    { s: "butcher", t: "…I'll bring another one. Goodbye." },
  ],
  "quack>mom": [
    { s: "quack", t: "Ma'am. About last month's bill for the bird." },
    { s: "mom", t: "The bird is FINE now. You overcharged." },
    { s: "quack", t: "Ma'am I did surgery on a parakeet." },
    { s: "mom", t: "Goodbye." },
  ],
  "henderson>mayor": [
    { s: "henderson", t: "Mayor, the streetlight on my corner is buzzing." },
    { s: "mayor", t: "I'll send someone first thing." },
    { s: "henderson", t: "Also your tie was CROOKED on the news." },
    { s: "mayor", t: "…noted. Good evening." },
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
    { s: "spy", t: "This line is NOT secure, Mayor." },
    { s: "mayor", t: "It's fine, the operator doesn't list—" },
    { s: "spy", t: "…hi, operator. Goodbye, Mayor." },
  ],
  "dog>mom": [
    { s: "dog", t: "Woof." },
    { s: "mom", t: "My boy!" },
    { s: "dog", t: "Woof woof." },
    { s: "mom", t: "I'll be right home." },
  ],
  "quack>butcher": [
    { s: "quack", t: "Marty. I've got a duck that didn't make it." },
    { s: "butcher", t: "Say no more." },
    { s: "quack", t: "I was about to say something else." },
    { s: "butcher", t: "Say no more. Goodbye." },
  ],
  "ghost>henderson": [
    { s: "ghost", t: "EEEEDDDNNAAAaaaa……" },
    { s: "henderson", t: "Carl?? Carl is that you??" },
    { s: "ghost", t: "YES EDNA. FROM BEYOND." },
    { s: "henderson", t: "You still owe me twelve dollars, CARL." },
    { s: "ghost", t: "I KNOWWW……" },
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
    { s: "mayor", t: "What gala?" },
    { s: "traveler", t: "The one where you eat the clams." },
    { s: "mayor", t: "Understood. Over." },
  ],
  "elvis>mom": [
    { s: "elvis", t: "Ma'am, are you missin' a son who sings a little." },
    { s: "mom", t: "…Derek is that YOU—" },
    { s: "elvis", t: "No ma'am. Wrong number. But bless you. Goodnight." },
    { s: "mom", t: "(sobbing quietly)" },
  ],
  "dog>butcher": [
    { s: "dog", t: "Woof." },
    { s: "butcher", t: "…how did you dial." },
    { s: "dog", t: "Woof." },
    { s: "butcher", t: "I'll be right over with scraps. Bye." },
  ],
  "spy>ghost": [
    { s: "spy", t: "Asset ZERO, confirm status." },
    { s: "ghost", t: "I HAVE BEEN DEAD FOR FORTY YEARS." },
    { s: "spy", t: "Confirmed: asset stable. Extract in 0300. Out." },
  ],
  "pope>quack": [
    { s: "pope", t: "Doctor. The basilica swan appears unwell." },
    { s: "quack", t: "How unwell, exactly?" },
    { s: "pope", t: "She hissed at a cardinal." },
    { s: "quack", t: "That's just swans. Bless you. Bye." },
  ],
};

export const WRONG: Record<string, DialogLine[]> = {
  "henderson>ghost": [
    { s: "henderson", t: "Marty?? Connection is AWFUL." },
    { s: "ghost", t: "ooooooOOOOOoooo……" },
    { s: "henderson", t: "Oh. Oh hello Carl." },
    { s: "henderson", t: "You still owe me twelve dollars." },
    { s: "ghost", t: "gooodbyyye edddnaaa……" },
  ],
  "moon>quack": [
    { s: "moon", t: "Doctor. The tides are acting up." },
    { s: "quack", t: "Ma'am this is a veterinary line." },
    { s: "moon", t: "I KNOW." },
    { s: "quack", t: "Goodbye." },
  ],
  "elvis>pope": [
    { s: "elvis", t: "Doc I got a hound dog situation—" },
    { s: "pope", t: "My son, this is the Holy See." },
    { s: "elvis", t: "Oh. Thank you, thank you very much, Your Holiness." },
    { s: "pope", t: "…may your hound find peace. Go with God." },
  ],
  "spy>mom": [
    { s: "spy", t: "Contact. This is Nimbus. Package in motion." },
    { s: "mom", t: "Derek did you call your AUNT yet." },
    { s: "spy", t: "…abort. Abort. Out." },
  ],
  "mayor>henderson": [
    { s: "mayor", t: "Chief, I need that report on my desk by—" },
    { s: "henderson", t: "MAYOR your tie was CROOKED on the news." },
    { s: "mayor", t: "OPERATOR!! …goodbye." },
  ],
  "traveler>butcher": [
    { s: "traveler", t: "Mayor. DO NOT eat the clams at the gala." },
    { s: "butcher", t: "Pal, this is a meat counter." },
    { s: "traveler", t: "Then also: do not stock clams next Thursday." },
    { s: "butcher", t: "…noted. Bye." },
  ],
  "ghost>butcher": [
    { s: "ghost", t: "FLLLEEESSSHHH……" },
    { s: "butcher", t: "Sir we're closed." },
    { s: "ghost", t: "FLESH?????" },
    { s: "butcher", t: "Tuesday special is chuck roast. Good night." },
  ],
  "dog>mayor": [
    { s: "dog", t: "Woof." },
    { s: "mayor", t: "Is this about the fountain ducks." },
    { s: "dog", t: "Woof." },
    { s: "mayor", t: "It always is. Goodbye." },
  ],
  "pope>butcher": [
    { s: "pope", t: "Doctor, the swan—" },
    { s: "butcher", t: "We got swan in Tuesday." },
    { s: "pope", t: "WE DO NOT. Goodbye." },
  ],
  "moon>mom": [
    { s: "moon", t: "Hello. I'm the Moon." },
    { s: "mom", t: "Derek if this is a prank—" },
    { s: "moon", t: "It is not, ma'am. It's the Moon." },
    { s: "mom", t: "Are you eating." },
    { s: "moon", t: "…goodnight." },
  ],
  "henderson>quack": [
    { s: "henderson", t: "Marty about the pot roast—" },
    { s: "quack", t: "This is Dr. Quackers, ma'am." },
    { s: "henderson", t: "…can I braise a duck." },
    { s: "quack", t: "NO. Goodbye." },
  ],
  "elvis>henderson": [
    { s: "elvis", t: "Ma'am, hound dog situation—" },
    { s: "henderson", t: "MARTY! It's that singer!" },
    { s: "elvis", t: "I just need a vet, ma'am." },
    { s: "henderson", t: "Marty's on his way. Ta-ta." },
  ],
  "spy>elvis": [
    { s: "spy", t: "Contact ZULU. Extract protocol." },
    { s: "elvis", t: "Partner I don't know who Zulu is but I'm in." },
    { s: "spy", t: "…who is this." },
    { s: "elvis", t: "The King, baby. Out." },
  ],
  "spy>butcher": [
    { s: "spy", t: "Transmission. Package frozen. Repeat — frozen." },
    { s: "butcher", t: "Pal we got a freezer sale." },
    { s: "spy", t: "…the asset is a pork loin?" },
    { s: "butcher", t: "It can be. Buh-bye." },
  ],
};

export const WRONG_FALLBACK_A = [
  "Hello? [EXPECT]?",
  "Is this [EXPECT]?",
  "[EXPECT], is that you?",
  "Put [EXPECT] on.",
  "This is about [EXPECT].",
];

export const WRONG_FALLBACK_B = [
  "No, this is [ACTUAL].",
  "Wrong line, pal. This is [ACTUAL].",
  "Negative. [ACTUAL] speaking.",
  "You've got [ACTUAL]. Who is this?",
  "[ACTUAL] here. Who are you calling for?",
];

export const WRONG_FALLBACK_C = [
  "…right. Sorry. Goodbye.",
  "Nevermind. Bye.",
  "Forget I called. Bye.",
  "Hello? Wait no. Goodbye.",
];

export const CLOSERS = [
  "*click — line goes dead*",
  "*click — receiver set down*",
  "*tone — call ended*",
  "*click — both hung up*",
];

export const PLAYER_COLORS = [
  "#68c6ff",
  "#6fe07a",
  "#ffd561",
  "#ff8fc8",
  "#c792ea",
  "#7fe0c4",
  "#ffae6c",
  "#ff5a4e",
];

export const CABLES_PER_PLAYER = 2;
export const LINE_INTERVAL_MS = 1500;
export const LINE_FIRST_DELAY = 500;
export const RING_TIMEOUT_MS = 22000;
export const SCORE_CORRECT = 10;
export const SCORE_CHAOS = 4;
export const PENALTY_EARLY = 22;
export const PENALTY_TIMEOUT = 16;
export const PENALTY_TIMEOUT_STEP = 4;
export const SCORE_DENY_RIGHT = 14;
export const PENALTY_DENY_WRONG = 14;
export const PENALTY_APPROVE_BAD = 14;
export const DIRTY_SLIP_CHANCE = 0.42;
export const FORGED_NAME_CHANCE = 0.18;

export const AGENCY_FIRST_DELAY_SEC = 45;
export const AGENCY_MIN_INTERVAL_SEC = 38;
export const AGENCY_MAX_INTERVAL_SEC = 65;
export const AGENCY_TIMEOUT_MS = 17000;
export const SCORE_AGENCY = 22;
export const PENALTY_AGENCY = 26;

const PHONE_PREFIXES = ["KL5", "MU6", "AT3", "EX1", "HE4", "PE9", "RI2", "OL7"];

export function makePhone(): string {
  const p = PHONE_PREFIXES[Math.floor(Math.random() * PHONE_PREFIXES.length)];
  return `${p}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)] as T;
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}
