export interface GameEntry {
  id: string;
  title: string;
  tag: string;
  path: string;
}

export const games: GameEntry[] = [
  { id: "DECONSTRUCT", title: "Deconstruct", tag: "Play", path: "./games/DECONSTRUCT/" },
  {
    id: "DECONSTRUCT_SIKU2",
    title: "Deconstruct Siku2",
    tag: "Variant",
    path: "./games/DECONSTRUCT_SIKU2/",
  },
  { id: "SIGNAL_1", title: "Signal 1", tag: "Series", path: "./games/SIGNAL_1/" },
  { id: "SIGNAL_2", title: "Signal 2", tag: "Series", path: "./games/SIGNAL_2/" },
  {
    id: "SIGNAL_WEAVE",
    title: "Signal Weave",
    tag: "Multiplayer",
    path: "./games/SIGNAL_WEAVE/",
  },
];
