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
    id: "signal-1",
    title: "Signal 1",
    tag: "Series",
    path: "/games/signal-1",
    description: "Switchboard routing chaos with character calls.",
  },
  {
    id: "signal-2",
    title: "Signal 2",
    tag: "Series",
    path: "/games/signal-2",
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
    description: "Voice-and-signal social deduction in a haunted facility.",
  },
  {
    id: "signal-surge",
    title: "Signal Surge",
    tag: "Multiplayer",
    path: "/games/signal-surge",
    description: "3-6 player signal packet race through a 3D broadcast channel.",
  },
  {
    id: "semaphoria",
    title: "Semaphoria",
    tag: "Co-op",
    path: "/games/semaphoria",
    description: "Asymmetric lighthouse signalling co-op. Navigate the reef by light alone.",
  },
];
