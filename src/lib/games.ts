import type { Pathname } from "$app/types";

export interface GameEntry {
  id: string;
  title: string;
  tag: string;
  path: Pathname;
  description?: string;
}

export const games: GameEntry[] = [
  {
    id: "deconstruct",
    title: "Deconstruct",
    tag: "Play",
    path: "/games/deconstruct",
    description: "3D tabletop signal puzzle with solo and multiplayer modes.",
  },
  {
    id: "signal-cross",
    title: "Signal Cross",
    tag: "Series",
    path: "/games/signal-cross",
    description: "Switchboard routing chaos with character calls.",
  },
  {
    id: "signal-grid",
    title: "Signal Grid",
    tag: "Series",
    path: "/games/signal-grid",
    description: "Tile routing puzzle with programmable parts.",
  },
  {
    id: "signal-weave",
    title: "Signal Weave",
    tag: "Multiplayer",
    path: "/games/signal-weave",
    description: "Two-player waveform synchronization game.",
  },
  {
    id: "dead-air",
    title: "Dead Air",
    tag: "Multiplayer",
    path: "/games/dead-air",
    description: "Telephone puzzle — reconstruct a melody after it passes through noisy relays.",
  },
  {
    id: "signal-surge",
    title: "Signal Surge",
    tag: "Multiplayer",
    path: "/games/signal-surge",
    description: "2-6 player signal packet cup — race every track, GP scoring wins.",
  },
  {
    id: "semaphoria",
    title: "Semaphoria",
    tag: "Co-op",
    path: "/games/semaphoria",
    description: "Asymmetric lighthouse signalling co-op. Navigate the reef by light alone.",
  },
];
