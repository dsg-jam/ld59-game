import type { GameSnapshot, LobbyPlayer, FinishEntry, LogEntry, CupStanding } from "./types.js";
import { DEFAULT_TRACK_ID } from "./types.js";

export type Phase = "lobby" | "game" | "raceEnd" | "cupEnd";

type GameStateType = {
  phase: Phase;
  mySlot: number;
  slotLabel: string;
  operatorName: string;
  joinCode: string;
  roomCode: string;
  roomWrapVisible: boolean;
  startEnabled: boolean;
  lobbyStatus: string;
  netStatus: string;
  lobbyPlayers: LobbyPlayer[];
  snapshot: GameSnapshot | null;
  countdownLabel: string;
  winnerName: string;
  finishOrder: FinishEntry[];
  logs: LogEntry[];
  pendingLane: number;
  hudProgress: string;
  hudBursts: number;
  hudPlace: string;
  hudTotal: number;
  selectedTrackId: string;
  activeTrackId: string;
  cupStandings: CupStanding[];
  cupTrackIndex: number;
  cupTotalTracks: number;
  nextTrackName: string;
  canAdvanceTrack: boolean;
  cupComplete: boolean;
};

export const gs: GameStateType = $state({
  phase: "lobby",
  mySlot: -1,
  slotLabel: "--",
  operatorName: "",
  joinCode: "",
  roomCode: "",
  roomWrapVisible: false,
  startEnabled: false,
  lobbyStatus: "",
  netStatus: "Idle.",
  lobbyPlayers: [],
  snapshot: null,
  countdownLabel: "",
  winnerName: "",
  finishOrder: [],
  logs: [],
  pendingLane: 2,
  hudProgress: "0.0",
  hudBursts: 0,
  hudPlace: "-",
  hudTotal: 0,
  selectedTrackId: DEFAULT_TRACK_ID,
  activeTrackId: DEFAULT_TRACK_ID,
  cupStandings: [],
  cupTrackIndex: 0,
  cupTotalTracks: 0,
  nextTrackName: "",
  canAdvanceTrack: false,
  cupComplete: false,
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
  gs.activeTrackId = DEFAULT_TRACK_ID;
  gs.cupStandings = [];
  gs.cupTrackIndex = 0;
  gs.cupTotalTracks = 0;
  gs.nextTrackName = "";
  gs.canAdvanceTrack = false;
  gs.cupComplete = false;
}
