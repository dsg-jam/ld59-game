import type { Card, ColKey, MoveResult, ScoreEntry } from "./types.js";

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

export type GameState = {
  phase: "lobby" | "game" | "end";
  grid: ColKey[][][];
  myHand: Card[];
  selectedCardIdx: number | null;
  selected: [number, number][];
  allScores: ScoreEntry[];
  turn: number;
  locked: boolean;
  playerCount: number;
  playerNames: Record<number, string>;
  mySlot: number;
  isSolo: boolean;
  risingBlockTriggers: BlockRiseTrigger[];
  signalRingTriggers: SignalRingTrigger[];
  logEntries: LogEntry[];
  msgText: string;
  msgKind: string;
  showWait: boolean;
  roomCode: string;
  playerList: PlayerListEntry[];
  lobbyStatus: string;
  joinStatus: string;
  joinCodeInput: string;
  lobbyPanel: "menu" | "waiting" | "joining";
  lastRoundResults: MoveResult[];
  lastRoundTurn: number;
  showRoundSummary: boolean;
  invalidShake: number;
  finalResults: {
    winnerSlot: number;
    scores: ScoreEntry[];
  } | null;
};

export const gs = $state<GameState>({
  phase: "lobby",
  grid: [],
  myHand: [],
  selectedCardIdx: null,
  selected: [],
  allScores: [],
  turn: 1,
  locked: false,
  playerCount: 1,
  playerNames: {},
  mySlot: 0,
  isSolo: false,
  risingBlockTriggers: [],
  signalRingTriggers: [],
  logEntries: [],
  msgText: "",
  msgKind: "",
  showWait: false,
  roomCode: "",
  playerList: [],
  lobbyStatus: "",
  joinStatus: "",
  joinCodeInput: "",
  lobbyPanel: "menu",
  lastRoundResults: [],
  lastRoundTurn: 0,
  showRoundSummary: false,
  invalidShake: 0,
  finalResults: null,
});
