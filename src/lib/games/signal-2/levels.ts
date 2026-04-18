export interface Source { kind: "source"; x: number; y: number; dir: number; seq: number[]; period: number; offset: number; loop: boolean; }
export interface Sink { kind: "sink"; x: number; y: number; dir: number; expected: number[]; }
export interface Wall { kind: "wall"; x: number; y: number; }
export type Fixed = Source | Sink | Wall;
export interface Level { id: number; name: string; title: string; brief: string; fixed: Fixed[]; walls: { x: number; y: number }[]; bin: Partial<Record<string, number>>; tickLimit: number; win: string; }

// SIGNAL // ldjam59 -- level definitions
// Grid is GRID_W x GRID_H. Coordinates (x, y), (0,0) at top-left.
// Tile types live in game.js; we just spawn objects via shorthand here.
//
// Direction codes: N=0, E=1, S=2, W=3
// Sources emit `seq` (array of integers). They emit one value every `period` ticks,
//   starting at tick `offset`. After end of seq, they stop (or loop if `loop:true`).
// Sinks store a list of received values; a level is solved if every sink's
//   received list matches its `expected` list (in order).

export const GRID_W = 10;
export const GRID_H = 10;

// helper to build sources/sinks
const SRC = (x: number, y: number, dir: number, seq: number[], period = 3, offset = 1, loop = false): Source =>
  ({ kind: 'source', x, y, dir, seq, period, offset, loop });
const SNK = (x: number, y: number, dir: number, expected: number[]): Sink =>
  ({ kind: 'sink', x, y, dir, expected });
const WALL = (x: number, y: number): Wall => ({ kind: "wall", x, y });

export const LEVELS: Level[] = [
  {
    id: 1,
    name: "HELLO, WORLD",
    title: "DAY 1: HELLO, WORLD",
    brief: "Your first day at SIGNAL. Just route the pulse from the transmitter (▲) to the receiver (▼). Place pipes by selecting WIRE in the parts bin.",
    fixed: [
      SRC(2, 2, 2 /*S*/, [7], 4, 1),
      SNK(2, 7, 0 /*N*/, [7]),
    ],
    walls: [],
    bin: { pipe: 8 },
    tickLimit: 40,
    win: "Welcome aboard. Coffee is in the break room. Be advised: it's not coffee.",
  },

  {
    id: 2,
    name: "AROUND THE CUBICLE",
    title: "DAY 2: AROUND THE CUBICLE",
    brief: "HR put a 'wellness obstacle' in your wire path. Use corner pipes (click WIRE again to rotate, or right-click a placed pipe to cycle shape).",
    fixed: [
      SRC(1, 1, 1 /*E*/, [3, 3, 3], 3, 1),
      SNK(8, 8, 3 /*W*/, [3, 3, 3]),
    ],
    walls: [
      { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 },
      { x: 4, y: 3 }, { x: 5, y: 3 },
      { x: 4, y: 6 }, { x: 5, y: 6 },
    ],
    bin: { pipe: 16 },
    tickLimit: 60,
    win: "Productivity ▲ 0.4%. The wellness cube remains. Nobody knows who put it there.",
  },

  {
    id: 3,
    name: "AMPLITUDE ANXIETY",
    title: "DAY 3: AMPLITUDE ANXIETY",
    brief: "Source emits weak signal (value 1). Receiver expects a robust 5. Place an AMP gate, click it, configure it to add +4. (Click placed gates to program them.)",
    fixed: [
      SRC(1, 5, 1, [1, 1, 1], 4, 1),
      SNK(8, 5, 3, [5, 5, 5]),
    ],
    walls: [],
    bin: { pipe: 10, amp: 1 },
    tickLimit: 50,
    win: "Marketing thanks you. The signal now sounds 'confident'.",
  },

  {
    id: 4,
    name: "DOUBLE OR NOTHING",
    title: "DAY 4: DOUBLE OR NOTHING",
    brief: "Source: 1, 2, 3. Receiver wants 2, 4, 6. Use a multiplier (MUL).",
    fixed: [
      SRC(1, 1, 2, [1, 2, 3], 3, 1),
      SNK(8, 8, 0, [2, 4, 6]),
    ],
    walls: [
      { x: 4, y: 4 }, { x: 5, y: 5 },
    ],
    bin: { pipe: 14, mul: 1 },
    tickLimit: 80,
    win: "Accounting will not be happy with these numbers, but the pulse is correct.",
  },

  {
    id: 5,
    name: "EVENS ONLY, PLEASE",
    title: "DAY 5: EVENS ONLY, PLEASE",
    brief: "The receiver is a snob. It only wants even values. The source is firing 1..6. Use a FILTER to drop odd ones.",
    fixed: [
      SRC(1, 5, 1, [1, 2, 3, 4, 5, 6], 3, 1),
      SNK(8, 5, 3, [2, 4, 6]),
    ],
    walls: [],
    bin: { pipe: 10, filt: 1 },
    tickLimit: 80,
    win: "Three odd numbers were rejected. They are now in therapy.",
  },

  {
    id: 6,
    name: "SPLIT DECISION",
    title: "DAY 6: SPLIT DECISION",
    brief: "Two receivers, both need the same signal. Use a T-SPLIT pipe to fork the wire. (Right-click a wire to cycle through pipe shapes.)",
    fixed: [
      SRC(0, 5, 1, [4, 4, 4], 3, 1),
      SNK(9, 1, 3, [4, 4, 4]),
      SNK(9, 8, 3, [4, 4, 4]),
    ],
    walls: [],
    bin: { pipe: 18 },
    tickLimit: 80,
    win: "Both interns received their morning briefing. Neither read it.",
  },

  {
    id: 7,
    name: "TIMING IS EVERYTHING",
    title: "DAY 7: TIMING IS EVERYTHING",
    brief: "Two sources, one receiver. The receiver expects 3, 7. But signals arrive at the wrong times. Use a DELAY gate so signals arrive in the right order.",
    fixed: [
      SRC(1, 2, 1, [3], 1, 1),         // arrives early
      SRC(1, 7, 1, [7], 1, 1),         // arrives at same time
      SNK(8, 5, 3, [3, 7]),
    ],
    walls: [],
    bin: { pipe: 16, delay: 1 },
    tickLimit: 80,
    win: "The receiver thanks you for the politeness of well-spaced packets.",
  },

  {
    id: 8,
    name: "CHOOSE YOUR FIGHTER",
    title: "DAY 8: CHOOSE YOUR FIGHTER",
    brief: "Source emits 1..6. Even values must reach the BOTTOM receiver. Odd values must reach the TOP receiver. Use a ROUTER (configure: split on '%2').",
    fixed: [
      SRC(0, 4, 1, [1, 2, 3, 4, 5, 6], 3, 1),
      SNK(9, 1, 3, [1, 3, 5]),  // odd
      SNK(9, 8, 3, [2, 4, 6]),  // even
    ],
    walls: [],
    bin: { pipe: 18, router: 1 },
    tickLimit: 100,
    win: "The router has correctly applied prejudice based on parity. Beautiful.",
  },

  {
    id: 9,
    name: "MIDDLE MANAGEMENT",
    title: "DAY 9: MIDDLE MANAGEMENT",
    brief: "Source emits 1, 2, 3. Two receivers need different versions. TOP wants DOUBLED (2,4,6). BOTTOM wants MINUS ONE (0,1,2). Fork the signal through a T-junction and transform each branch independently.",
    fixed: [
      SRC(0, 4, 1, [1, 2, 3], 3, 1),
      SNK(9, 1, 3, [2, 4, 6]),
      SNK(9, 7, 3, [0, 1, 2]),
    ],
    walls: [],
    bin: { pipe: 22, amp: 1, mul: 1 },
    tickLimit: 150,
    win: "Two teams received conflicting versions of the memo. This is now standard practice.",
  },

  {
    id: 10,
    name: "THE FINAL SHIFT",
    title: "DAY 10: THE FINAL SHIFT",
    brief: "Source emits 1..6. Router splits by parity. ODDS (1,3,5) go to TOP as-is. EVENS (2,4,6) get DOUBLED (4,8,12) and go to BOTTOM. It's your last day. Make us cry.",
    fixed: [
      SRC(0, 4, 1, [1, 2, 3, 4, 5, 6], 3, 1),
      SNK(9, 1, 3, [1, 3, 5]),
      SNK(9, 7, 3, [4, 8, 12]),
    ],
    walls: [
      { x: 4, y: 0 }, { x: 4, y: 9 },
    ],
    bin: { pipe: 26, amp: 1, mul: 1, router: 1, delay: 1 },
    tickLimit: 200,
    win: "You have decoded the SIGNAL. Severance package mailed. The coffee machine will miss you.",
  },
];
