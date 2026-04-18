export interface GameEntry {
  id: string;
  title: string;
  tag: string;
  path: string;
  description?: string;
}

export const games: GameEntry[] = [
  {
    id: "DECONSTRUCT",
    title: "Deconstruct",
    tag: "Play",
    path: "/games/DECONSTRUCT/",
    description: "3D signal puzzle with solo and multiplayer modes.",
  },
  {
    id: "DECONSTRUCT_SIKU2",
    title: "Deconstruct Siku2",
    tag: "Variant",
    path: "/games/DECONSTRUCT_SIKU2/",
    description: "Signal-themed multiplayer tabletop variant.",
  },
  {
    id: "SIGNAL_1",
    title: "Signal 1",
    tag: "Series",
    path: "/games/SIGNAL_1/",
    description: "Switchboard routing chaos with character calls.",
  },
  {
    id: "SIGNAL_2",
    title: "Signal 2",
    tag: "Series",
    path: "/games/SIGNAL_2/",
    description: "Tile routing puzzle with programmable parts.",
  },
  {
    id: "SIGNAL_WEAVE",
    title: "Signal Weave",
    tag: "Multiplayer",
    path: "/games/SIGNAL_WEAVE/",
    description: "Two-player waveform synchronization game.",
  },
  {
    id: "DEAD_AIR",
    title: "Dead Air",
    tag: "Multiplayer",
    path: "/games/DEAD_AIR/",
    description: "Voice-and-signal social deduction in a haunted facility.",
  },
];
