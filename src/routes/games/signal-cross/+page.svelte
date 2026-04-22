<script lang="ts">
  import { onMount } from "svelte";
  import {
    CHARS,
    LEVELS,
    PENALTY_APPROVE_BAD,
    PENALTY_DENY_WRONG,
    PENALTY_EARLY,
    SCORE_CHAOS,
    SCORE_CORRECT,
    SCORE_DENY_RIGHT,
  } from "$lib/games/signal-cross/data";
  import { sfx } from "$lib/games/signal-cross/audio";
  import type {
    GameEvent,
    GameMode,
    GameSnapshot,
    LobbyState,
    LogEntry,
    Signal1Controls,
    Ticket,
  } from "$lib/games/signal-cross/types";
  import {
    buildRoomShareUrl,
    clearRoomCodeFromUrl,
    copyToClipboard,
    readRoomCodeFromUrl,
  } from "$lib/room-url";
  import "./styles.css";

  type Floater = {
    id: number;
    text: string;
    x: number;
    y: number;
    kind: "score" | "chaos" | "miss";
  };

  const INITIAL_SNAPSHOT: GameSnapshot = {
    phase: "lobby",
    levelIdx: 0,
    timeLeft: 0,
    duration: 0,
    goal: 0,
    teamScore: 0,
    teamChaos: 0,
    teamPenalty: 0,
    correctCount: 0,
    tickets: [],
    players: [],
    log: [],
    levelTitle: "",
    levelSubtitle: "",
    gameMode: "classic",
    supervisorId: null,
  };

  const MODE_DESCS: Record<GameMode, string> = {
    classic: "Classic switchboard. Ring → patch → hang up.",
    verify:
      "Every call comes with a call slip. Before patching, review caller, line, and request. Deny forged or flagged slips.",
    supervisor:
      "One operator becomes Supervisor: no cables, stamps APPROVE/DENY. Patchers only see calls after they're approved.",
  };

  let snapshot = $state<GameSnapshot>(INITIAL_SNAPSHOT);
  let snapshotAt = $state(Date.now());
  let lobby = $state<LobbyState>({ mode: "classic", supervisorId: null });
  let roomCode = $state("");
  let netStatus = $state<{ msg: string; kind: "" | "ok" | "err" }>({ msg: "", kind: "" });
  let myId = $state("");
  let isHost = $state(false);
  let nameInput = $state("");
  let roomInput = $state("");
  let toast = $state<string | null>(null);
  let floaters = $state<Floater[]>([]);
  let frameTick = $state(Date.now());

  let slipModalTicketId = $state<number | null>(null);
  let slipModalRole = $state<"verify" | "supervisor">("verify");
  let agencyModalTicketId = $state<number | null>(null);
  let tutorialOpen = $state(false);
  let tutorialStep = $state(0);
  const TUTORIAL_FLAG_KEY = "signal-cross:tutorial-seen-v1";

  const TUTORIAL_STEPS: { title: string; body: string }[] = [
    {
      title: "THE BOARD",
      body:
        "Bell Exchange #47. Callers come in on the left plug, recipients on the right. " +
        "A red, flashing plug is RINGING. Connect them before it times out.",
    },
    {
      title: "PATCHING A CALL",
      body:
        "Click the ringing caller plug, THEN click the plug they want to reach. " +
        "A cable drops — their conversation plays out in the CALL LOG.",
    },
    {
      title: "DISCONNECT",
      body:
        "When you see the *click* line, the call is DONE. Click the live plug (or cable) to pull out. " +
        "Pull too EARLY and the crew takes a penalty. Leave them too long and new callers stack up.",
    },
    {
      title: "THE AGENCY",
      body:
        "A red encrypted ticket will appear in INCOMING. ANY operator can click it to answer. " +
        "The question is about what JUST happened on the board — watch the Call Log. " +
        "Wrong answer = big penalty.",
    },
    {
      title: "VERIFY MODE",
      body:
        "Every call comes with a paper SLIP. Before patching, OPEN the slip and compare it " +
        "against the INCOMING ticket (caller + intended recipient). Mismatched names, " +
        "forged signatures, or ⚠ FLAGGED lines → DENY. Correct slip → APPROVE, then patch.",
    },
    {
      title: "SUPERVISOR MODE",
      body:
        "One operator plays SUPERVISOR — no cables, only a stamp. " +
        "Incoming calls sit in limbo until the supervisor opens the slip, compares it " +
        "to the OPERATOR'S BOARD panel, and STAMPS approve or deny. " +
        "Patchers can only route calls the supervisor approved.",
    },
    {
      title: "GOOD SHIFT",
      body:
        "Keep correct routes above the goal. Crossed wires give small CHAOS points but no progress. " +
        "Pulling early, timing out, or answering The Agency wrong hurts the penalty column. " +
        "Press [?] at any time to see this again.",
    },
  ];

  let floaterSeq = 0;
  let toastHandle: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let controls: Signal1Controls | null = null;
  // Non-reactive DOM ref map — element lookups for cable/floater anchoring only.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const plugEls = new Map<string, HTMLElement>();

  function registerPlug(node: HTMLElement, id: string): { destroy(): void } {
    plugEls.set(id, node);
    return {
      destroy() {
        plugEls.delete(id);
      },
    };
  }

  function plugCenter(id: string): { x: number; y: number } | null {
    const el = plugEls.get(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const screen = $derived.by<"title" | "lobby" | "game" | "end">(() => {
    if (!myId) return "title";
    if (snapshot.phase === "playing") return "game";
    if (snapshot.phase === "ended") return "end";
    return "lobby";
  });

  const me = $derived(snapshot.players.find((p) => p.id === myId));
  const lvl = $derived(LEVELS[snapshot.levelIdx]);
  const ringingTickets = $derived(
    snapshot.tickets.filter((t) => t.status === "ringing" && t.kind === "call")
  );
  const liveTickets = $derived(snapshot.tickets.filter((t) => t.status === "live"));
  const agencyTickets = $derived(
    snapshot.tickets.filter((t) => t.status === "ringing" && t.kind === "agency")
  );
  const slipTicket = $derived(
    slipModalTicketId == null
      ? null
      : (snapshot.tickets.find((t) => t.id === slipModalTicketId) ?? null)
  );
  const agencyTicket = $derived(
    agencyModalTicketId == null
      ? null
      : (snapshot.tickets.find((t) => t.id === agencyModalTicketId) ?? null)
  );

  const displayTimeLeft = $derived(
    snapshot.phase === "playing"
      ? Math.max(0, snapshot.timeLeft - (frameTick - snapshotAt) / 1000)
      : snapshot.timeLeft
  );
  const timerPct = $derived(
    snapshot.duration > 0 ? (displayTimeLeft / snapshot.duration) * 100 : 0
  );
  const teamTotal = $derived(snapshot.teamScore + snapshot.teamChaos);
  const totalMaxCables = $derived(snapshot.players.reduce((s, p) => s + p.maxCables, 0));
  const freeCables = $derived(snapshot.players.reduce((s, p) => s + p.cables, 0));
  const hudModeLabel = $derived.by(() => {
    const m = snapshot.gameMode;
    if (m === "classic") return "CLASSIC";
    if (m === "verify") return "VERIFY";
    return myId === snapshot.supervisorId ? "SUPERVISOR (YOU)" : "SUPERVISOR";
  });

  const modeDesc = $derived.by(() => {
    if (lobby.mode === "supervisor" && snapshot.players.length < 2) {
      return "Supervisor mode requires 2+ operators.";
    }
    return MODE_DESCS[lobby.mode];
  });

  const startDisabled = $derived(
    !isHost || (lobby.mode === "supervisor" && snapshot.players.length < 2)
  );

  const endPassed = $derived(snapshot.correctCount >= snapshot.goal);
  const endIsLast = $derived(snapshot.levelIdx + 1 >= LEVELS.length);

  type CablePath = {
    id: number;
    d: string;
    color: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
  };
  const cablePaths = $derived.by<CablePath[]>(() => {
    void frameTick;
    const paths: CablePath[] = [];
    for (const t of liveTickets) {
      const conn = t.connection;
      if (!conn) continue;
      const a = plugCenter(t.from);
      const b = plugCenter(conn.actualTo);
      if (!a || !b) continue;
      const owner = snapshot.players.find((p) => p.id === conn.byPlayer);
      const color = owner?.color ?? "#68c6ff";
      const d = `M ${a.x} ${a.y + 8} Q ${(a.x + b.x) / 2} ${Math.max(a.y, b.y) + 100}, ${b.x} ${b.y + 8}`;
      paths.push({ id: t.id, d, color, ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    return paths;
  });

  function handleEvent(ev: GameEvent): void {
    switch (ev.type) {
      case "ring":
        sfx.ring();
        break;
      case "connect":
        if (ev.correct) sfx.connect();
        else sfx.chaos();
        break;
      case "disconnected": {
        const p = plugCenter(ev.toId);
        if (ev.result === "cut") {
          sfx.penalty();
          if (p) pushFloater(`−${PENALTY_EARLY} EARLY CUT`, p.x, p.y - 20, "chaos");
        } else if (ev.result === "routed") {
          sfx.hangup();
          if (p) pushFloater(`+${SCORE_CORRECT} ROUTED`, p.x, p.y - 20, "score");
        } else if (ev.result === "chaos") {
          sfx.hangup();
          if (p) pushFloater(`+${SCORE_CHAOS} CHAOS`, p.x, p.y - 20, "miss");
        }
        break;
      }
      case "line":
        sfx.line();
        break;
      case "timeout": {
        sfx.penalty();
        const p = plugCenter(ev.fromId);
        if (p) pushFloater(`−${ev.penalty} TIMEOUT`, p.x, p.y - 20, "chaos");
        break;
      }
      case "tick":
        sfx.tick();
        break;
      case "stamp":
        sfx.stamp();
        break;
      case "denied": {
        sfx.stamp();
        const p = plugCenter(ev.fromId);
        if (p) {
          if (ev.correct) pushFloater(`+${SCORE_DENY_RIGHT} DENIED`, p.x, p.y - 20, "score");
          else pushFloater(`−${PENALTY_DENY_WRONG} WRONG DENY`, p.x, p.y - 20, "chaos");
        }
        break;
      }
      case "badApprove": {
        sfx.penalty();
        const p = plugCenter(ev.fromId);
        if (p) pushFloater(`−${PENALTY_APPROVE_BAD} BAD APPROVE`, p.x, p.y - 20, "chaos");
        break;
      }
      case "agencyRing":
        sfx.agency();
        showToast("☎ THE AGENCY IS ON THE LINE");
        break;
      case "agencyCorrect":
        sfx.connect();
        showToast(`+${ev.score} AGENCY • ${ev.operatorName} HELD COVER`);
        break;
      case "agencyWrong":
        sfx.penalty();
        showToast(`−${ev.penalty} AGENCY • ${ev.operatorName} FUMBLED`);
        break;
      case "agencyMiss":
        sfx.penalty();
        showToast(`−${ev.penalty} AGENCY • NO ANSWER`);
        break;
    }
  }

  function pushFloater(text: string, x: number, y: number, kind: Floater["kind"]): void {
    const id = ++floaterSeq;
    floaters = [...floaters, { id, text, x, y, kind }];
    setTimeout(() => {
      floaters = floaters.filter((f) => f.id !== id);
    }, 1200);
  }

  function showToast(message: string): void {
    toast = message;
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => {
      toast = null;
    }, 1500);
  }

  onMount(() => {
    let disposed = false;
    void import("$lib/games/signal-cross/main").then(({ mount }) => {
      if (disposed) return;
      controls = mount({
        onSnapshot: (s) => {
          snapshot = s;
          snapshotAt = Date.now();
        },
        onLobby: (l) => {
          lobby = l;
        },
        onNetStatus: (msg, kind) => {
          netStatus = { msg, kind };
        },
        onRoomCode: (c) => {
          roomCode = c;
        },
        onIdentity: (id, host) => {
          myId = id;
          isHost = host;
        },
        onEvent: handleEvent,
        onToast: showToast,
      });

      const urlCode = readRoomCodeFromUrl();
      if (urlCode) {
        roomInput = urlCode;
        controls.joinGame(urlCode, readName());
        clearRoomCodeFromUrl();
      }
    });

    const step = (): void => {
      frameTick = Date.now();
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    try {
      if (!localStorage.getItem(TUTORIAL_FLAG_KEY)) {
        tutorialOpen = true;
        tutorialStep = 0;
      }
    } catch {
      /* ignore storage errors */
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onContextMenu);
      if (toastHandle) clearTimeout(toastHandle);
      controls?.destroy();
      controls = null;
    };
  });

  $effect(() => {
    if (
      snapshot.phase === "playing" &&
      snapshot.gameMode === "verify" &&
      slipModalTicketId == null
    ) {
      const mine = snapshot.tickets.find(
        (t) => t.status === "ringing" && t.approval === "pending" && t.reviewer === myId
      );
      if (mine) {
        slipModalTicketId = mine.id;
        slipModalRole = "verify";
      }
    }
    if (slipModalTicketId != null) {
      const t = slipTicket;
      if (!t || t.status !== "ringing") {
        slipModalTicketId = null;
      } else if (
        snapshot.gameMode === "verify" &&
        (t.approval !== "pending" || t.reviewer !== myId)
      ) {
        slipModalTicketId = null;
      } else if (
        snapshot.gameMode === "supervisor" &&
        (t.approval !== "awaiting-stamp" || myId !== snapshot.supervisorId)
      ) {
        slipModalTicketId = null;
      }
    }
  });

  $effect(() => {
    if (agencyModalTicketId == null) return;
    const t = agencyTicket;
    if (!t || t.status !== "ringing" || t.agencyPickedBy) {
      agencyModalTicketId = null;
    }
  });

  // Broadcast attendance on the agency call whenever the modal opens/closes.
  let lastAttendedTicketId: number | null = null;
  $effect(() => {
    const id = agencyModalTicketId;
    if (id !== lastAttendedTicketId) {
      if (lastAttendedTicketId != null) {
        controls?.sendAction({
          type: "agencyAttend",
          ticketId: lastAttendedTicketId,
          attending: false,
        });
      }
      if (id != null) {
        controls?.sendAction({ type: "agencyAttend", ticketId: id, attending: true });
      }
      lastAttendedTicketId = id;
    }
  });

  function readName(): string {
    let n = nameInput.trim();
    if (!n) {
      n = "OP-" + Math.floor(100 + Math.random() * 900);
      nameInput = n;
    }
    return n;
  }

  function onHost(): void {
    netStatus = { msg: "opening host channel...", kind: "" };
    controls?.hostGame(readName());
  }

  function onJoin(): void {
    const code = roomInput.trim().toUpperCase();
    if (!code) {
      netStatus = { msg: "enter a room code first", kind: "err" };
      return;
    }
    controls?.joinGame(code, readName());
  }

  function onCopy(): void {
    if (!roomCode) return;
    void copyToClipboard(roomCode).then((ok) => {
      showToast(ok ? "copied " + roomCode : "copy failed");
    });
  }

  function onCopyLink(): void {
    if (!roomCode) return;
    void copyToClipboard(buildRoomShareUrl(roomCode)).then((ok) => {
      showToast(ok ? "copied invite link" : "copy failed");
    });
  }

  function ringBarPct(t: Ticket): number {
    const pct = (t.timeoutAt - frameTick) / t.ringDurationMs;
    return Math.max(0, Math.min(1, pct)) * 100;
  }

  function ticketClaimColor(t: Ticket): string | null {
    const conn = t.connection;
    if (!conn) return null;
    return snapshot.players.find((p) => p.id === conn.byPlayer)?.color ?? null;
  }

  function plugStatus(id: string): {
    ringing: boolean;
    live: boolean;
    claimedSelf: boolean;
    claimedOther: boolean;
    claimColor: string | null;
    claimerName: string | null;
  } {
    const ringingTicket = snapshot.tickets.find(
      (t) => t.from === id && t.status === "ringing" && t.kind === "call"
    );
    const liveTicket = snapshot.tickets.find(
      (t) => t.status === "live" && (t.from === id || (t.connection?.actualTo ?? "") === id)
    );
    const claimer = snapshot.players.find((p) => p.selected === id) ?? null;
    let claimColor: string | null = null;
    if (claimer) claimColor = claimer.color;
    else if (liveTicket) {
      claimColor =
        snapshot.players.find((p) => p.id === liveTicket.connection?.byPlayer)?.color ?? null;
    }
    return {
      ringing: !!ringingTicket && !liveTicket,
      live: !!liveTicket,
      claimedSelf: claimer?.id === myId,
      claimedOther: !!claimer && claimer.id !== myId,
      claimColor,
      claimerName: claimer?.name ?? null,
    };
  }

  function ticketRequest(t: Ticket): { name: string; emoji: string } {
    const to = t.to ? CHARS[t.to] : null;
    // Incoming tickets always show the TRUE intended recipient (from the call record).
    // The slip modal shows what paperwork says, so slip mismatches are visible in the modal
    // compare panel. Patchers can always trust what's shown on the board.
    return { name: to?.name ?? "?", emoji: to?.emoji ?? "?" };
  }

  function logBadge(entry: LogEntry): { cls: string; text: string } {
    if (entry.status === "streaming") return { cls: "streaming", text: "LIVE" };
    if (entry.result === "cut") return { cls: "cut", text: "EARLY CUT" };
    if (entry.result === "routed") return { cls: "ok", text: "ROUTED" };
    if (entry.result === "chaos") return { cls: "chaos", text: "CROSSED" };
    return { cls: "streaming", text: "LIVE" };
  }

  function onPlugClick(plugId: string): void {
    if (snapshot.phase !== "playing" || !me) return;
    const liveT = snapshot.tickets.find(
      (t) => t.status === "live" && (t.from === plugId || (t.connection?.actualTo ?? "") === plugId)
    );
    if (liveT) {
      controls?.sendAction({ type: "disconnect", ticketId: liveT.id });
      return;
    }
    if (me.selected && me.selected !== plugId) {
      if (me.cables <= 0) {
        sfx.denied();
        showToast("no cables free");
        return;
      }
      controls?.sendAction({ type: "connect", toId: plugId });
      return;
    }
    if (me.selected === plugId) {
      controls?.sendAction({ type: "deselect" });
      return;
    }
    const ticket = snapshot.tickets.find(
      (t) => t.from === plugId && t.status === "ringing" && t.kind === "call"
    );
    if (!ticket) {
      sfx.denied();
      return;
    }

    if (snapshot.gameMode === "supervisor") {
      if (ticket.approval === "awaiting-stamp") {
        if (myId === snapshot.supervisorId) {
          slipModalTicketId = ticket.id;
          slipModalRole = "supervisor";
          sfx.select();
        } else {
          sfx.denied();
          showToast("awaiting supervisor stamp");
        }
        return;
      }
      if (myId === snapshot.supervisorId) {
        sfx.denied();
        showToast("supervisors do not patch");
        return;
      }
    }

    if (snapshot.gameMode === "verify" && ticket.approval === "pending") {
      if (ticket.reviewer && ticket.reviewer !== myId) {
        sfx.denied();
        showToast("another op reviewing");
        return;
      }
      if (me.cables <= 0) {
        sfx.denied();
        showToast("no cables free");
        return;
      }
      controls?.sendAction({ type: "select", plugId });
      sfx.select();
      return;
    }

    if (me.cables <= 0) {
      sfx.denied();
      showToast("no cables free");
      return;
    }
    controls?.sendAction({ type: "select", plugId });
    sfx.select();
  }

  function onQueueTicketClick(t: Ticket): void {
    if (snapshot.phase !== "playing") return;
    if (
      snapshot.gameMode === "supervisor" &&
      myId === snapshot.supervisorId &&
      t.approval === "awaiting-stamp"
    ) {
      slipModalTicketId = t.id;
      slipModalRole = "supervisor";
      sfx.select();
    }
  }

  function onSlipApprove(): void {
    const id = slipModalTicketId;
    if (id == null) return;
    if (snapshot.gameMode === "verify")
      controls?.sendAction({ type: "verifyDecision", ticketId: id, decision: "approve" });
    else if (snapshot.gameMode === "supervisor")
      controls?.sendAction({ type: "stamp", ticketId: id, decision: "approve" });
    sfx.stamp();
    slipModalTicketId = null;
  }

  function onSlipDeny(): void {
    const id = slipModalTicketId;
    if (id == null) return;
    if (snapshot.gameMode === "verify")
      controls?.sendAction({ type: "verifyDecision", ticketId: id, decision: "deny" });
    else if (snapshot.gameMode === "supervisor")
      controls?.sendAction({ type: "stamp", ticketId: id, decision: "deny" });
    sfx.stamp();
    slipModalTicketId = null;
  }

  function onSlipCancel(): void {
    const id = slipModalTicketId;
    if (id != null && snapshot.gameMode === "verify") {
      controls?.sendAction({ type: "verifyDecision", ticketId: id, decision: "cancel" });
    }
    slipModalTicketId = null;
  }

  function onAgencyAnswer(choiceIdx: number): void {
    if (agencyModalTicketId == null) return;
    controls?.sendAction({
      type: "agencyAnswer",
      ticketId: agencyModalTicketId,
      choiceIdx,
    });
    agencyModalTicketId = null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        openTutorial();
        return;
      }
    }
    if (e.key !== "Escape") return;
    if (tutorialOpen) {
      closeTutorial();
      return;
    }
    if (slipModalTicketId != null) {
      onSlipCancel();
      return;
    }
    if (agencyModalTicketId != null) {
      agencyModalTicketId = null;
      return;
    }
    if (snapshot.phase === "playing" && me?.selected) {
      controls?.sendAction({ type: "deselect" });
    }
  }

  function openTutorial(): void {
    tutorialOpen = true;
    tutorialStep = 0;
  }

  function closeTutorial(): void {
    tutorialOpen = false;
    try {
      localStorage.setItem(TUTORIAL_FLAG_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function nextTutorial(): void {
    if (tutorialStep < TUTORIAL_STEPS.length - 1) {
      tutorialStep++;
    } else {
      closeTutorial();
    }
  }

  function prevTutorial(): void {
    if (tutorialStep > 0) tutorialStep--;
  }

  function autoFocus(node: HTMLElement): void {
    const target = node.querySelector<HTMLElement>("button, [tabindex]");
    target?.focus();
  }

  function onContextMenu(e: MouseEvent): void {
    if (screen !== "game" || snapshot.phase !== "playing") return;
    if (me?.selected) {
      e.preventDefault();
      controls?.sendAction({ type: "deselect" });
    }
  }

  function agencyTimerPct(t: Ticket): number {
    const pct = (t.timeoutAt - frameTick) / (t.ringDurationMs || 1);
    return Math.max(0, Math.min(1, pct)) * 100;
  }
</script>

<svelte:head>
  <title>SIGNAL CROSS — LDJAM59</title>
</svelte:head>

<div class="signal-cross-page">
  <div class="scanlines"></div>

  <button
    class="help-fab"
    type="button"
    aria-label="Show how to play"
    title="How to play (?)"
    onclick={openTutorial}
  >
    ?
  </button>

  {#if screen === "title"}
    <div id="title-screen" class="screen active">
      <div class="title-stack">
        <div class="signal-wave">
          <span></span><span></span><span></span><span></span><span></span><span></span><span
          ></span>
        </div>
        <h1>SIGNAL<span class="cross">CROSS</span></h1>
        <p class="subtitle">Bell Exchange #47 &mdash; Co-op Night Shift</p>
        <p class="blurb">
          1962. A switchboard. Co-op shift.<br />
          Each operator has 3 cables. Plug ringing callers into the right recipient,<br />
          <em>read</em> their conversation, and pull your cable only when they&rsquo;ve hung up.<br
          />
          Pull too early &mdash; the crew takes a penalty.
        </p>

        <label class="field">
          <span class="field-label">OPERATOR NAME</span>
          <input type="text" maxlength="14" placeholder="MARGE" bind:value={nameInput} />
        </label>

        <div class="button-row">
          <button class="big-btn" onclick={onHost}>HOST NEW SHIFT</button>
          <div class="divider"><span>OR</span></div>
          <label class="field inline">
            <span class="field-label">ROOM CODE</span>
            <input
              type="text"
              maxlength="12"
              placeholder="SIG-XXXX"
              autocomplete="off"
              value={roomInput}
              oninput={(e) => {
                roomInput = (e.target as HTMLInputElement).value.toUpperCase();
              }}
            />
          </label>
          <button class="big-btn secondary" onclick={onJoin}>JOIN</button>
        </div>

        <p class="net-status {netStatus.kind}" role="status" aria-live="polite">
          {netStatus.msg}
        </p>
        <p class="tip">
          click caller, then recipient · click a live plug or cable to disconnect · esc releases a
          held plug
        </p>
      </div>
    </div>
  {/if}

  {#if screen === "lobby"}
    <div id="lobby-screen" class="screen active">
      <div class="title-stack lobby-stack">
        <h2 class="lobby-title">READY ROOM</h2>
        <div class="room-code-wrap">
          <span class="hud-label">SHARE THIS CODE</span>
          <div class="room-code">{roomCode || "..."}</div>
          <div class="button-row tight">
            <button class="mini-btn" onclick={onCopy}>COPY CODE</button>
            <button class="mini-btn" onclick={onCopyLink}>COPY LINK</button>
          </div>
        </div>

        <div class="panel-head">OPERATORS ON DUTY</div>
        <div class="lobby-players">
          {#each snapshot.players as p (p.id)}
            {@const isSv = lobby.mode === "supervisor" && lobby.supervisorId === p.id}
            <div class="lobby-player">
              <div class="dot" style:background={p.color} style:color={p.color}></div>
              <div class="name">
                {p.name}{#if isSv}<span class="sv-badge">SV</span>{/if}
              </div>
              <div class="tag">
                {p.id === myId ? (isHost ? "HOST / YOU" : "YOU") : "OPERATOR"}
              </div>
            </div>
          {/each}
        </div>

        <div class="mode-picker">
          <span class="hud-label">SHIFT MODE</span>
          <div class="mode-buttons">
            {#each ["classic", "verify", "supervisor"] as const as mode (mode)}
              <button
                class="mode-btn host-only"
                class:active={lobby.mode === mode}
                disabled={!isHost || (mode === "supervisor" && snapshot.players.length < 2)}
                onclick={() => controls?.setLobbyMode(mode)}
              >
                {mode === "classic" ? "CLASSIC" : mode === "verify" ? "VERIFY CARDS" : "SUPERVISOR"}
              </button>
            {/each}
          </div>
          <div class="mode-desc">{modeDesc}</div>
          {#if lobby.mode === "supervisor"}
            <div class="supervisor-pick">
              <span class="hud-label">SUPERVISOR</span>
              <label class="sr-only" for="supervisor-select">Supervisor</label>
              <select
                id="supervisor-select"
                class="sv-select host-only"
                disabled={!isHost}
                value={lobby.supervisorId ?? ""}
                onchange={(e) =>
                  controls?.setSupervisor((e.target as HTMLSelectElement).value || null)}
              >
                {#each snapshot.players as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
            </div>
          {/if}
        </div>

        {#if isHost}
          <button
            class="big-btn host-only"
            disabled={startDisabled}
            onclick={() => controls?.startLevel(0)}
          >
            START SHIFT ▸
          </button>
        {:else}
          <div class="lobby-wait">Waiting for host to begin...</div>
        {/if}
        <button class="mini-btn" onclick={() => controls?.leaveRoom()}>LEAVE</button>
      </div>
    </div>
  {/if}

  {#if screen === "game"}
    <div id="game-screen" class="screen active">
      <header class="hud">
        <div class="hud-item">
          <span class="hud-label">SHIFT</span>
          <span class="hud-val">{snapshot.levelIdx + 1}</span>
        </div>
        <div class="hud-item wide">
          <span class="hud-label">TIME</span>
          <div class="timer-bar"><div style:width="{timerPct}%" id="timer-fill"></div></div>
        </div>
        <div class="hud-item">
          <span class="hud-label">ROUTED</span>
          <span class="hud-val">{snapshot.correctCount} / {snapshot.goal}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">TEAM</span>
          <span class="hud-val">{teamTotal}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">PENALTY</span>
          <span class="hud-val penalty">-{snapshot.teamPenalty}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">CABLES</span>
          <span class="hud-val">{freeCables} / {totalMaxCables}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">ROOM</span>
          <span class="hud-val small">{roomCode || "---"}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">MODE</span>
          <span class="hud-val small">{hudModeLabel}</span>
        </div>
      </header>

      <section class="switchboard">
        <div class="panel-label">EXCHANGE 47 — {snapshot.levelTitle}</div>
        <div class="shift-briefing">
          <div class="shift-briefing-sub">{snapshot.levelSubtitle}</div>
          <div class="shift-briefing-tips">
            <span>◆ CLICK ringing plug, then recipient</span>
            <span>◆ CLICK live plug/cable to hang up AFTER *click*</span>
            <span>◆ PRESS ? for tutorial</span>
          </div>
        </div>
        {#if lvl}
          {@const n = lvl.chars.length}
          {@const cols = n <= 6 ? 3 : n <= 9 ? 3 : 4}
          {@const plugSize = n <= 6 ? 140 : n <= 9 ? 118 : 96}
          <div
            class="board"
            style:grid-template-columns="repeat({cols}, {plugSize}px)"
            style:--plug-size="{plugSize}px"
          >
            {#each lvl.chars as id (id)}
              {@const status = plugStatus(id)}
              {@const c = CHARS[id]}
              <div
                use:registerPlug={id}
                class="plug"
                class:ringing={status.ringing}
                class:live={status.live}
                class:claimed-self={status.claimedSelf}
                class:claimed-other={status.claimedOther}
                style:--claimColor={status.claimColor ?? ""}
                onclick={() => onPlugClick(id)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPlugClick(id);
                  }
                }}
                role="button"
                tabindex="0"
                aria-label={c?.name ?? id}
              >
                <div class="bulb"></div>
                <div class="jack"></div>
                <div class="emoji">{c?.emoji ?? ""}</div>
                <div class="name">{c?.name ?? id}</div>
                {#if status.claimerName}
                  <div class="claim-tag" style:--claimColor={status.claimColor ?? ""}>
                    {status.claimerName}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="panel-screws">
          <div class="screw"></div>
          <div class="screw"></div>
          <div class="screw"></div>
          <div class="screw"></div>
        </div>
      </section>

      <aside class="side-panel">
        <div class="panel panel-queue">
          <div class="panel-head">INCOMING</div>
          <div class="queue-vertical">
            {#each agencyTickets as t (t.id)}
              <div
                class="ticket agency"
                onclick={() => {
                  agencyModalTicketId = t.id;
                  sfx.select();
                }}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    agencyModalTicketId = t.id;
                    sfx.select();
                  }
                }}
                role="button"
                tabindex="0"
              >
                <span class="num">🕴 AGENCY</span>
                <div class="agency-row">CHECK-IN CALL</div>
                <div class="row"><span class="emoji">☎</span><b>ENCRYPTED LINE</b></div>
                <div class="agency-row mono">CLICK TO ANSWER</div>
                <div class="attend-row">
                  {#each snapshot.players as p (p.id)}
                    {@const onLine = t.agencyAttending.includes(p.id)}
                    <span
                      class="attend-dot"
                      class:on={onLine}
                      style:--dotColor={p.color}
                      title="{p.name}: {onLine ? 'ON THE LINE' : 'not answering'}"
                    ></span>
                  {/each}
                </div>
                <div class="ring-bar">
                  <div class="ring-bar-fill" style:width="{ringBarPct(t)}%"></div>
                </div>
              </div>
            {/each}

            {#each ringingTickets as t (t.id)}
              {@const from = CHARS[t.from]}
              {@const req = ticketRequest(t)}
              {@const awaiting =
                snapshot.gameMode === "supervisor" && t.approval === "awaiting-stamp"}
              {@const approvedStamp =
                snapshot.gameMode === "supervisor" && t.approval === "approved"}
              {@const review =
                snapshot.gameMode === "verify" && t.approval === "pending" && t.reviewer === myId}
              <div
                class="ticket"
                class:awaiting-stamp={awaiting}
                class:approved-stamp={approvedStamp}
                class:pending-review={review}
                style:cursor={awaiting && myId === snapshot.supervisorId ? "pointer" : ""}
                onclick={() => onQueueTicketClick(t)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onQueueTicketClick(t);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <span class="num">#{String(t.id).padStart(3, "0")}</span>
                <div class="row">
                  <span class="emoji">{from?.emoji ?? ""}</span>
                  <b>{from?.name ?? t.from}</b>
                </div>
                <div class="arrow">│ WANTS ▼</div>
                <div class="row">
                  <span class="emoji">{req.emoji}</span><b class="req-name">{req.name}</b>
                </div>
                <div class="note">{t.note || ""}</div>
                {#if t.slip}
                  <div class="slip-mini">
                    <span class="slip-k">LINE</span>
                    <b>{t.slip.line}</b>
                    {#if t.slip.flagged}<span class="slip-flag-mini">⚠ FLAGGED</span>{/if}
                  </div>
                {/if}
                <div class="ring-bar">
                  <div class="ring-bar-fill" style:width="{ringBarPct(t)}%"></div>
                </div>
              </div>
            {/each}

            {#if liveTickets.length > 0}
              <div class="live-head">{liveTickets.length} LIVE</div>
            {/if}

            {#each liveTickets as t (t.id)}
              {@const conn = t.connection}
              {#if conn}
                {@const from = CHARS[t.from]}
                {@const to = CHARS[conn.actualTo]}
                {@const owner = snapshot.players.find((p) => p.id === conn.byPlayer)}
                <div
                  class="ticket live"
                  style:--claimColor={ticketClaimColor(t) ?? ""}
                  onclick={() => controls?.sendAction({ type: "disconnect", ticketId: t.id })}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      controls?.sendAction({ type: "disconnect", ticketId: t.id });
                    }
                  }}
                  role="button"
                  tabindex="0"
                >
                  <span class="num">LIVE</span>
                  <div class="row">
                    <span class="emoji">{from?.emoji ?? ""}</span>
                    {from?.name ?? t.from} ↔
                    <span class="emoji">{to?.emoji ?? ""}</span>
                    {to?.name ?? conn.actualTo}
                  </div>
                  <div class="note">cable by {owner?.name || "—"}</div>
                </div>
              {/if}
            {/each}
          </div>
        </div>

        <div class="panel panel-ops">
          <div class="panel-head">OPERATORS</div>
          <div class="operators">
            {#each snapshot.players as p (p.id)}
              <div class="op-row" class:self={p.id === myId}>
                <div class="dot" style:background={p.color} style:color={p.color}></div>
                <div class="name">{p.name}</div>
                <div class="cables" style:color={p.color}>
                  {#each Array.from({ length: p.maxCables }, (_, i) => i) as i (i)}
                    <span class="cable-dot" class:used={i >= p.cables}></span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="panel panel-log">
          <div class="panel-head">CALL LOG</div>
          <div class="log" role="log" aria-live="polite">
            {#each snapshot.log as entry (entry.ticketId)}
              {@const badge = logBadge(entry)}
              {@const fromName = CHARS[entry.from]?.name ?? ""}
              {@const actualName = CHARS[entry.actual]?.name ?? ""}
              {@const routedBy = snapshot.players.find((p) => p.id === entry.byPlayer)}
              <div class="entry" class:streaming={badge.cls === "streaming"}>
                <div class="header {badge.cls}">
                  <span class="badge">{badge.text}</span>
                  <span class="who">{fromName} → {actualName}</span>
                  <span class="by" style:color={routedBy?.color ?? ""}>
                    by {routedBy?.name ?? "—"}
                  </span>
                </div>
                <div class="lines">
                  {#each entry.lines as line, i (i)}
                    <span class="line" class:system={line.s === "sys"}>
                      <span class="speaker">
                        {CHARS[line.s]?.name ?? ""}{line.s === "sys" ? "" : ":"}
                      </span>
                      {line.t}
                    </span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </aside>

      <div id="cable-layer" aria-hidden="true">
        <svg width="100%" height="100%">
          {#each cablePaths as cp (cp.id)}
            <g class="cable">
              <path
                d={cp.d}
                stroke={cp.color}
                stroke-opacity="0.3"
                stroke-width="12"
                fill="none"
                stroke-linecap="round"
                pointer-events="none"
              />
              <path
                d={cp.d}
                stroke={cp.color}
                stroke-width="5"
                fill="none"
                stroke-linecap="round"
                pointer-events="none"
              />
              <path
                d={cp.d}
                stroke="#fff8"
                stroke-width="1"
                fill="none"
                stroke-linecap="round"
                pointer-events="none"
              />
              <circle cx={cp.ax} cy={cp.ay} r="7" fill={cp.color} pointer-events="none" />
              <circle cx={cp.bx} cy={cp.by} r="7" fill={cp.color} pointer-events="none" />
            </g>
          {/each}
        </svg>
      </div>

      <div id="floater-layer" aria-hidden="true">
        {#each floaters as f (f.id)}
          <div class="floater {f.kind}" style:left="{f.x}px" style:top="{f.y}px">{f.text}</div>
        {/each}
      </div>

      {#if toast}
        <div class="toast" role="status" aria-live="polite">{toast}</div>
      {/if}

      {#if slipTicket && slipTicket.slip}
        {@const slip = slipTicket.slip}
        {@const trueCallerName = CHARS[slipTicket.from]?.name ?? slipTicket.from}
        {@const trueRequestName = slipTicket.to
          ? (CHARS[slipTicket.to]?.name ?? slipTicket.to)
          : "?"}
        {@const callerMismatch = slip.callerName !== trueCallerName}
        {@const requestMismatch = slip.requestId !== slipTicket.to}
        <div
          class="slip-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slip-heading"
          use:autoFocus
        >
          <div class="slip">
            <div class="slip-head">
              <span id="slip-heading">CALL SLIP</span>
              <span>#{slip.slipNum}</span>
            </div>
            <div class="slip-body">
              <div class="slip-row" class:slip-row-mismatch={callerMismatch}>
                <span class="slip-k">CALLER</span><b>{slip.callerName}</b>
              </div>
              <div class="slip-row">
                <span class="slip-k">LINE</span><b>{slip.line}</b>
              </div>
              <div class="slip-row" class:slip-row-mismatch={requestMismatch}>
                <span class="slip-k">REQUESTS</span><b>{slip.requestName}</b>
              </div>
              {#if slip.flagged}
                <div class="slip-flag">⚠ FLAGGED LINE — RESTRICTED PARTY</div>
              {/if}
              <div class="slip-compare">
                <div class="slip-compare-head">
                  {slipModalRole === "supervisor"
                    ? "OPERATOR'S BOARD SAYS"
                    : "RINGING IN RIGHT NOW"}
                </div>
                <div class="slip-row" class:slip-row-mismatch={callerMismatch}>
                  <span class="slip-k">CALLER</span>
                  <b>
                    {CHARS[slipTicket.from]?.emoji ?? ""}
                    {trueCallerName}
                  </b>
                </div>
                <div class="slip-row" class:slip-row-mismatch={requestMismatch}>
                  <span class="slip-k">DIALED FOR</span>
                  <b>
                    {slipTicket.to ? (CHARS[slipTicket.to]?.emoji ?? "") : ""}
                    {trueRequestName}
                  </b>
                </div>
                <div class="slip-row">
                  <span class="slip-k">NOTE</span><b>{slipTicket.note || "—"}</b>
                </div>
              </div>
              <div class="slip-hint">
                Slip mismatch OR ⚠ flagged line → DENY. Clean slip → APPROVE.
              </div>
            </div>
            <div class="slip-actions">
              <button class="big-btn" onclick={onSlipApprove}>APPROVE ▸</button>
              <button class="big-btn secondary" onclick={onSlipDeny}>DENY ✖</button>
            </div>
            <button class="mini-btn" onclick={onSlipCancel}>CANCEL</button>
          </div>
        </div>
      {/if}

      {#if agencyTicket && agencyTicket.agencyQ}
        <div
          class="agency-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agency-heading"
          use:autoFocus
        >
          <div class="dossier">
            <div class="dossier-head">
              <span class="dossier-tag" id="agency-heading">🕴 THE AGENCY</span>
              <span class="dossier-sub">ENCRYPTED — ANSWER CAREFULLY</span>
            </div>
            <div class="agency-q">{agencyTicket.agencyQ.text}</div>
            <div class="agency-choices">
              {#each agencyTicket.agencyQ.choices as choice, i (i)}
                <button class="agency-choice" onclick={() => onAgencyAnswer(i)}>
                  {choice.label}
                </button>
              {/each}
            </div>
            <div class="agency-attend">
              <span class="agency-attend-label">ON THE LINE</span>
              <div class="agency-attend-list">
                {#each snapshot.players as p (p.id)}
                  {@const onLine = agencyTicket.agencyAttending.includes(p.id)}
                  <div class="agency-attend-op" class:on={onLine}>
                    <span class="dot" style:background={p.color} style:color={p.color}></span>
                    <span class="name">{p.name}</span>
                    <span class="state">{onLine ? "ANSWERED" : "ringing..."}</span>
                  </div>
                {/each}
              </div>
            </div>
            <div class="agency-timer">
              <div id="agency-timer-fill" style:width="{agencyTimerPct(agencyTicket)}%"></div>
            </div>
            <button class="mini-btn agency-leave" onclick={() => (agencyModalTicketId = null)}>
              HANG UP (ESC)
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if tutorialOpen}
    {@const step = TUTORIAL_STEPS[tutorialStep]}
    <div
      class="tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-heading"
      use:autoFocus
    >
      <div class="tutorial-card">
        <div class="tutorial-head">
          <span class="tutorial-tag">HOW TO RUN THE BOARD</span>
          <span class="tutorial-progress">
            {tutorialStep + 1} / {TUTORIAL_STEPS.length}
          </span>
        </div>
        <h3 id="tutorial-heading" class="tutorial-title">{step?.title ?? ""}</h3>
        <p class="tutorial-body">{step?.body ?? ""}</p>
        <div class="tutorial-dots">
          {#each TUTORIAL_STEPS as step, i (i)}
            <span class="tutorial-dot" class:active={i === tutorialStep} aria-label={step.title}
            ></span>
          {/each}
        </div>
        <div class="tutorial-actions">
          <button class="mini-btn" disabled={tutorialStep === 0} onclick={prevTutorial}>
            BACK
          </button>
          <button class="mini-btn" onclick={closeTutorial}>SKIP</button>
          <button class="big-btn" onclick={nextTutorial}>
            {tutorialStep === TUTORIAL_STEPS.length - 1 ? "GOT IT ▸" : "NEXT ▸"}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if screen === "end"}
    {@const total = teamTotal - snapshot.teamPenalty}
    {@const endLvl = LEVELS[snapshot.levelIdx]}
    {@const endTitle = endPassed
      ? endIsLast
        ? "FINAL SHIFT CLEARED • PUNCH OUT"
        : `${endLvl?.title ?? ""} • CLEARED`
      : `${endLvl?.title ?? ""} • SUPERVISOR DISAPPOINTED`}
    {@const endBlurb = endPassed
      ? endIsLast
        ? "The board goes dark. The crew did it."
        : (endLvl?.subtitle ?? "")
      : `Crew needed ${snapshot.goal} correct routes. Got ${snapshot.correctCount}.`}
    <div id="end-screen" class="screen active">
      <div class="title-stack">
        <h1>{endTitle}</h1>
        <p class="subtitle">{endBlurb}</p>
        <div class="panel-head">CREW TOTALS</div>
        <div class="leaderboard">
          <div class="team-summary">
            <div class="ts-row">
              <span class="hud-label">CORRECT ROUTES</span>
              <span class="score">{snapshot.correctCount} / {snapshot.goal}</span>
            </div>
            <div class="ts-row">
              <span class="hud-label">ROUTED POINTS</span>
              <span class="score">+{snapshot.teamScore}</span>
            </div>
            <div class="ts-row">
              <span class="hud-label">CHAOS BONUS</span>
              <span class="chaos">+{snapshot.teamChaos}</span>
            </div>
            <div class="ts-row">
              <span class="hud-label">PENALTIES</span>
              <span class="pen">-{snapshot.teamPenalty}</span>
            </div>
            <div class="ts-row final">
              <span class="hud-label">TEAM TOTAL</span>
              <span class="total">{total}</span>
            </div>
          </div>
          <div class="ops-footer">
            <div class="hud-label">CREW</div>
            {#each snapshot.players as p (p.id)}
              <div class="lb-row">
                <div class="dot" style:background={p.color} style:color={p.color}></div>
                <div class="name">
                  {p.name}{#if p.id === myId}
                    ★{/if}
                </div>
                <div class="cables" style:color={p.color}>
                  {"●".repeat(p.cables)}{"○".repeat(p.maxCables - p.cables)}
                </div>
              </div>
            {/each}
          </div>
        </div>
        <div class="button-row tight">
          {#if isHost}
            <button class="big-btn host-only" onclick={() => controls?.nextLevel()}>
              {endPassed ? (endIsLast ? "PLAY AGAIN ▸" : "NEXT SHIFT ▸") : "RETRY SHIFT ▸"}
            </button>
            <button class="big-btn secondary host-only" onclick={() => controls?.replayLevel()}>
              REPLAY
            </button>
          {:else}
            <div class="lobby-wait">Waiting for host...</div>
          {/if}
        </div>
        <button class="mini-btn" onclick={() => controls?.leaveRoom()}>LEAVE ROOM</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
