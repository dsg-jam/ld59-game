import type { Card, ColKey, ScoreEntry } from "./types.js";

export type BlockRiseTrigger = {
  id: string;
  colorKey: ColKey;
  worldX: number;
  worldY: number;
  worldZ: number;
  vel: number;
  rotXRate: number;
  rotZRate: number;
};
export type SignalRingTrigger = {
  id: string;
  worldX: number;
  worldZ: number;
  worldY: number;
  colorKey: ColKey;
  duration: number;
};

export type LogEntry = { text: string; kind?: string };
export type PlayerListEntry = { slot: number; name: string; color: string };

export const gs = $state({
  phase: "lobby" as "lobby" | "game",
  grid: [] as ColKey[][][],
  myHand: [] as Card[],
  selectedCardIdx: null as number | null,
  selected: [] as [number, number][],
  allScores: [] as ScoreEntry[],
  turn: 1,
  locked: false,
  playerCount: 1,
  playerNames: {} as Record<number, string>,
  mySlot: 0,
  isSolo: false,
  risingBlockTriggers: [] as BlockRiseTrigger[],
  signalRingTriggers: [] as SignalRingTrigger[],
  logEntries: [] as LogEntry[],
  msgText: "",
  msgKind: "",
  showWait: false,
  roomCode: "",
  playerList: [] as PlayerListEntry[],
  lobbyStatus: "",
  joinStatus: "",
  joinCodeInput: "",
  lobbyPanel: "menu" as "menu" | "waiting" | "joining",
});
