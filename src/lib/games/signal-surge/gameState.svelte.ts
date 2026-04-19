import type { GameSnapshot, LobbyPlayer, FinishEntry, LogEntry } from "./types.js";

export type Phase = "lobby" | "game" | "end";

export const gs = $state({
  phase: "lobby" as Phase,
  mySlot: -1,
  slotLabel: "--",
  operatorName: "",
  joinCode: "",
  roomCode: "",
  roomWrapVisible: false,
  startEnabled: false,
  lobbyStatus: "",
  netStatus: "Idle.",
  lobbyPlayers: [] as LobbyPlayer[],
  snapshot: null as GameSnapshot | null,
  countdownLabel: "",
  winnerName: "",
  finishOrder: [] as FinishEntry[],
  logs: [] as LogEntry[],
  pendingLane: 2,
  hudProgress: "0.0",
  hudBursts: 0,
  hudPlace: "-",
  hudTotal: 0,
});

let nextLogId = 0;

export function pushLog(text: string, kind = ""): void {
  const entry: LogEntry = { id: nextLogId++, text, kind };
  gs.logs = [entry, ...gs.logs].slice(0, 20);
  gs.netStatus = text;
}

export function resetState(): void {
  gs.phase = "lobby";
  gs.mySlot = -1;
  gs.slotLabel = "--";
  gs.roomCode = "";
  gs.roomWrapVisible = false;
  gs.startEnabled = false;
  gs.lobbyStatus = "";
  gs.netStatus = "Idle.";
  gs.lobbyPlayers = [];
  gs.snapshot = null;
  gs.countdownLabel = "";
  gs.winnerName = "";
  gs.finishOrder = [];
  gs.logs = [];
  gs.pendingLane = 2;
  gs.hudProgress = "0.0";
  gs.hudBursts = 0;
  gs.hudPlace = "-";
  gs.hudTotal = 0;
}
