export type CharDef = { name: string; emoji: string };

export type DialogLine = { s: string; t: string };

export type Slip = {
  slipNum: string;
  callerName: string;
  line: string;
  requestId: string;
  requestName: string;
  dirty: boolean;
  flagged: boolean;
};

export type AgencyChoice = { label: string; tag: string | number };

export type AgencyQuestion = {
  text: string;
  choices: AgencyChoice[];
  correctIdx: number;
};

export type Connection = {
  byPlayer: string;
  actualTo: string;
  correct: boolean;
  lines: DialogLine[];
  lineIdx: number;
  nextLineAt: number;
  completed: boolean;
  completedAt: number | null;
};

export type TicketKind = "call" | "agency";
export type TicketStatus = "ringing" | "live" | "done";
export type Approval = "none" | "pending" | "approved" | "denied" | "awaiting-stamp";

export type Ticket = {
  id: number;
  kind: TicketKind;
  from: string;
  to: string | null;
  note: string;
  status: TicketStatus;
  ringingSince: number;
  ringDurationMs: number;
  timeoutAt: number;
  connection: Connection | null;
  slip: Slip | null;
  approval: Approval;
  reviewer: string | null;
  agencyQ: AgencyQuestion | null;
  agencyPickedBy: string | null;
};

export type Player = {
  id: string;
  name: string;
  color: string;
  cables: number;
  maxCables: number;
  selected: string | null;
};

export type LogResult = "routed" | "chaos" | "cut" | null;

export type LogEntry = {
  ticketId: number;
  from: string;
  actual: string;
  intended: string;
  byPlayer: string;
  correct: boolean;
  lines: DialogLine[];
  status: "streaming" | "ended";
  result: LogResult;
};

export type CallDef = { from: string; to: string; note: string; at: number };

export type LevelDef = {
  title: string;
  subtitle: string;
  duration: number;
  ringTimeoutSec: number;
  lineIntervalMs: number;
  chars: string[];
  calls: CallDef[];
  goal: number;
  restricted: string[];
};

export type GameMode = "classic" | "verify" | "supervisor";

export type Phase = "lobby" | "playing" | "ended";

export type GameSnapshot = {
  phase: Phase;
  levelIdx: number;
  timeLeft: number;
  duration: number;
  goal: number;
  teamScore: number;
  teamChaos: number;
  teamPenalty: number;
  correctCount: number;
  tickets: Ticket[];
  players: Player[];
  log: LogEntry[];
  levelTitle: string;
  levelSubtitle: string;
  gameMode: GameMode;
  supervisorId: string | null;
};

export type GameEvent =
  | { type: "ring" }
  | { type: "agencyRing" }
  | { type: "connect"; byPlayer: string; fromId: string; toId: string; correct: boolean }
  | { type: "disconnected"; ticketId: number; fromId: string; toId: string; result: LogResult }
  | { type: "line"; ticketId: number }
  | { type: "timeout"; ticketId: number; fromId: string; penalty: number }
  | { type: "tick" }
  | { type: "stamp"; approved: boolean }
  | { type: "denied"; ticketId: number; fromId: string; correct: boolean }
  | { type: "badApprove"; fromId: string }
  | { type: "agencyCorrect"; score: number; operatorName: string }
  | { type: "agencyWrong"; penalty: number; operatorName: string }
  | { type: "agencyMiss"; penalty: number };

export type LobbyState = { mode: GameMode; supervisorId: string | null };

export type ActionMsg =
  | { type: "select"; plugId: string }
  | { type: "deselect" }
  | { type: "connect"; toId: string }
  | { type: "disconnect"; ticketId: number }
  | { type: "verifyDecision"; ticketId: number; decision: "approve" | "deny" | "cancel" }
  | { type: "stamp"; ticketId: number; decision: "approve" | "deny" }
  | { type: "agencyAnswer"; ticketId: number; choiceIdx: number };

export interface Signal1Callbacks {
  onSnapshot(snapshot: GameSnapshot): void;
  onLobby(state: LobbyState): void;
  onNetStatus(message: string, kind: "" | "ok" | "err"): void;
  onRoomCode(code: string): void;
  onIdentity(myId: string, isHost: boolean): void;
  onEvent(event: GameEvent): void;
  onToast(message: string): void;
}

export interface Signal1Controls {
  hostGame(name: string): void;
  joinGame(code: string, name: string): void;
  startLevel(idx: number): void;
  replayLevel(): void;
  nextLevel(): void;
  leaveRoom(): void;
  setLobbyMode(mode: GameMode): void;
  setSupervisor(playerId: string | null): void;
  sendAction(action: ActionMsg): void;
  destroy(): void;
}
