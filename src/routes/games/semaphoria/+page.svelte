<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { Canvas } from "@threlte/core";
  import Peer from "peerjs";
  import type { DataConnection } from "peerjs";

  import { makeCode, describePeerError } from "$lib/peer";
  import { createGameLoop } from "$lib/game-loop";
  import { clearRoomCodeFromUrl, readRoomCodeFromUrl } from "$lib/room-url";
  import Lobby from "$lib/components/Lobby.svelte";
  import Timer from "$lib/components/Timer.svelte";
  import SignalReference from "$lib/components/SignalReference.svelte";
  import LogPanel from "$lib/components/LogPanel.svelte";

  import {
    createInitialState,
    tick,
    startCountdown,
    sendSignal,
    getCurrentFlashColor,
    deriveStats,
    markWreckRescued,
  } from "$lib/semaphoria/engine";
  import type { GameState, PlayerRole, CaptainInput } from "$lib/semaphoria/engine";
  import { SIGNAL_REFERENCE, encodeSignal } from "$lib/semaphoria/signals";
  import type { SignalCommand, FlashPattern } from "$lib/semaphoria/signals";
  import { SEED_MAX, RESCUE_VARIANT_LABEL } from "$lib/semaphoria/constants";
  import {
    signalFlash,
    shipBell,
    collisionCrunch,
    successFanfare,
    failureStinger,
    startOceanAmbient,
  } from "$lib/audio";

  import CaptainView from "./CaptainView.svelte";
  import KeeperView from "./KeeperView.svelte";
  import SignalPanel from "./SignalPanel.svelte";
  import "./style.css";

  // ── Network message protocol ───────────────────────────────────────────────

  type NetMsg =
    | { t: "game-start"; seed: number; difficulty: 0 | 1 | 2 }
    | { t: "ship-pos"; x: number; y: number; heading: number }
    | { t: "signal"; command: SignalCommand }
    | { t: "game-over"; result: "success" | "failure" }
    | { t: "role"; role: PlayerRole }
    | { t: "wreck-rescued"; id: number };

  // ── State ─────────────────────────────────────────────────────────────────

  let lobbyPhase = $state<"lobby" | "game">("lobby");
  let myRole = $state<PlayerRole>("captain");
  let isHost = $state(false);
  let roomCode = $state("");
  let players = $state<string[]>([]);
  let canStart = $state(false);
  let lobbyStatus = $state("");
  let autoJoinCode = $state("");

  let gameState = $state<GameState | null>(null);
  let captainInput = $state<CaptainInput>({ turning: "none", moving: false });

  /**
   * Full flash pattern for the currently animating signal.
   * Needed by engine.tick() to advance through the flash sequence.
   */
  let activePattern = $state<FlashPattern | null>(null);

  let logs = $state<{ id: number; text: string; kind?: "ok" | "bad" | "" }[]>([]);
  let logSeq = 0;
  let netOk = $state(false);

  // Peer networking
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  /**
   * Tracks which of {host, join, idle} the user initiated.  Guards against
   * double-clicks of TUNE IN / OPEN CHANNEL while a connection is in flight,
   * which previously caused the first peer to be orphaned and the lobby
   * status to get wedged.
   */
  let netMode = $state<"idle" | "hosting" | "joining">("idle");
  /** Room code being dialled, for idempotency checks. Clears on teardown. */
  let joiningCode = $state("");
  let stopAmbient: (() => void) | null = null;
  let loop: ReturnType<typeof createGameLoop> | null = null;

  // Network tick rate for position updates
  let netTickAccum = 0;
  const NET_TICK_RATE = 0.1;

  // ── Key handling for Captain ───────────────────────────────────────────────

  const keysHeld = new SvelteSet<string>();

  function updateCaptainInput(): void {
    const left = keysHeld.has("ArrowLeft") || keysHeld.has("a");
    const right = keysHeld.has("ArrowRight") || keysHeld.has("d");
    captainInput = {
      turning: left ? "left" : right ? "right" : "none",
      moving: keysHeld.has("ArrowUp") || keysHeld.has("w"),
    };
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  function log(text: string, kind: "ok" | "bad" | "" = ""): void {
    logSeq += 1;
    logs = [{ id: logSeq, text, kind }, ...logs].slice(0, 30);
  }

  // ── Networking ────────────────────────────────────────────────────────────

  function send(msg: NetMsg): void {
    try {
      conn?.send(msg);
    } catch {
      // ignore transient send errors
    }
  }

  function handleMessage(raw: unknown): void {
    const msg = raw as NetMsg;
    switch (msg.t) {
      case "game-start":
        startGame(msg.seed, msg.difficulty);
        break;
      case "role":
        myRole = msg.role;
        break;
      case "signal": {
        // Captain side: receives a signal command from the keeper
        if (!gameState) return;
        const pattern = encodeSignal(msg.command);
        activePattern = [...pattern];
        const updated = sendSignal(gameState, msg.command);
        if (updated !== gameState) {
          gameState = updated;
          log(`↓ Signal: ${msg.command}`, "ok");
        }
        break;
      }
      case "ship-pos":
        // Keeper side: receives coarse ship position — state is kept from captain
        // The keeper's gameState.ship gets updated via reactive flow
        if (gameState && myRole === "keeper") {
          gameState = {
            ...gameState,
            ship: { ...gameState.ship, x: msg.x, y: msg.y, heading: msg.heading },
          };
        }
        break;
      case "game-over":
        if (gameState && gameState.phase === "playing") {
          finishGame(msg.result);
        }
        break;
      case "wreck-rescued":
        if (gameState && myRole === "keeper") {
          const updated = markWreckRescued(gameState, msg.id);
          if (updated !== gameState) {
            gameState = updated;
            const wreck = gameState.map.wrecks.find((w) => w.id === msg.id);
            if (wreck) log(`🛟 Rescued ${RESCUE_VARIANT_LABEL[wreck.variant]}`, "ok");
          }
        }
        break;
    }
  }

  function setupConn(c: DataConnection, onOpen?: () => void): void {
    conn = c;
    c.on("open", () => {
      netOk = true;
      log("Connected.", "ok");
      onOpen?.();
    });
    c.on("data", handleMessage);
    c.on("close", () => {
      netOk = false;
      log("Connection lost.", "bad");
    });
    c.on("error", () => {
      netOk = false;
    });
  }

  /**
   * Tear down any existing peer / connection so a fresh host / join attempt
   * starts from a clean slate.  Safe to call multiple times.  Does NOT touch
   * gameState / role / UI fields — callers own those.
   */
  function tearDownNet(): void {
    try {
      conn?.close();
    } catch {
      // ignore
    }
    try {
      peer?.destroy();
    } catch {
      // ignore
    }
    conn = null;
    peer = null;
    netOk = false;
    joiningCode = "";
  }

  // ── Lobby actions ─────────────────────────────────────────────────────────

  function handleHost(): void {
    // Idempotent: if we're already hosting, don't spin up a second peer.
    if (netMode === "hosting") return;
    // If the user was mid-join when they clicked OPEN CHANNEL, tear the
    // previous peer down before creating the new one.
    tearDownNet();
    netMode = "hosting";
    lobbyStatus = "";
    const code = makeCode(5);
    const localPeer = new Peer(`semaphoria-${code}`);
    peer = localPeer;
    localPeer.on("open", () => {
      roomCode = code;
      isHost = true;
      myRole = "keeper";
      log(`Room ${code} open. You are the KEEPER.`, "ok");
      players = ["Keeper (you)"];
    });
    localPeer.on("connection", (c) => {
      // Ignore connections that arrive after we've torn this peer down.
      if (peer !== localPeer || conn) {
        c.close();
        return;
      }
      // Players list and canStart update immediately so the keeper sees feedback.
      // The role message must wait until the DataConnection is open — PeerJS drops
      // sends on connections that haven't completed the WebRTC handshake yet.
      setupConn(c, () => {
        send({ t: "role", role: "captain" });
      });
      players = ["Keeper (you)", "Captain"];
      canStart = true;
      log("Captain connected!", "ok");
    });
    localPeer.on("error", (err) => {
      const e = err as { type?: string; message?: string };
      log(describePeerError(e), "bad");
      // Fatal host errors (peer-unavailable, unavailable-id, network) leave the
      // peer in an unusable state — reset so the user can re-try.
      if (e.type === "unavailable-id" || e.type === "network") {
        tearDownNet();
        netMode = "idle";
      }
    });
  }

  function handleJoin(code: string): void {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      lobbyStatus = "Enter room code.";
      return;
    }
    // Idempotent: if we're already dialling the same room, a repeat TUNE IN
    // used to spawn a parallel Peer and wedge the lobby.  Short-circuit when
    // the target matches; otherwise tear the previous peer down cleanly.
    if (netMode === "joining") {
      if (joiningCode === trimmed) return;
      tearDownNet();
    } else if (netMode === "hosting") {
      // Switching from host → join: tear the host peer down.
      tearDownNet();
      isHost = false;
      roomCode = "";
      canStart = false;
      players = [];
    }
    myRole = "captain";
    netMode = "joining";
    joiningCode = trimmed;
    const localPeer = new Peer(`semaphoria-g-${makeCode(8)}`);
    peer = localPeer;
    localPeer.on("open", () => {
      // If this peer was torn down (e.g. user clicked TUNE IN for a different
      // room before the handshake resolved) don't dial — we'd race with the
      // replacement peer and leak a zombie connection.
      if (peer !== localPeer) return;
      const c = localPeer.connect(`semaphoria-${trimmed}`, { reliable: true });
      setupConn(c, () => {
        lobbyStatus = "Waiting for keeper to start…";
      });
      lobbyStatus = "Connecting…";
      log(`Joining ${trimmed}…`);
    });
    localPeer.on("error", (err) => {
      const e = err as { type?: string; message?: string };
      lobbyStatus = describePeerError(e);
      log(lobbyStatus, "bad");
      if (e.type === "peer-unavailable" || e.type === "network") {
        tearDownNet();
        netMode = "idle";
      }
    });
  }

  function handleStart(): void {
    if (!isHost || !canStart) return;
    const seed = Math.floor(Math.random() * SEED_MAX);
    const difficulty = 0 as 0 | 1 | 2;
    send({ t: "game-start", seed, difficulty });
    startGame(seed, difficulty);
  }

  // ── Game lifecycle ─────────────────────────────────────────────────────────

  function startGame(seed: number, difficulty: 0 | 1 | 2): void {
    let state = createInitialState(seed, difficulty);
    state = startCountdown(state);
    gameState = state;
    lobbyPhase = "game";
    stopAmbient = startOceanAmbient();
    shipBell();
    log("Round started!", "ok");

    loop = createGameLoop((dt) => {
      if (!gameState) return;

      const prevPhase = gameState.phase;
      const prevFlash = getCurrentFlashColor(gameState);
      const prevLastRescue = gameState.lastRescuedWreckId;

      // Only the captain side advances ship physics.
      // Keeper side only updates the signal flash animation (no ship movement).
      const inputForThisSide: CaptainInput =
        myRole === "captain" ? captainInput : { turning: "none", moving: false };

      gameState = tick(gameState, dt, inputForThisSide, activePattern, myRole === "keeper");

      // Captain-side rescue detection → tell the keeper so their map / log updates.
      if (
        myRole === "captain" &&
        gameState.lastRescuedWreckId !== null &&
        gameState.lastRescuedWreckId !== prevLastRescue
      ) {
        const id = gameState.lastRescuedWreckId;
        const wreck = gameState.map.wrecks.find((w) => w.id === id);
        if (wreck) {
          log(`🛟 Rescued ${RESCUE_VARIANT_LABEL[wreck.variant]}`, "ok");
          shipBell();
          send({ t: "wreck-rescued", id });
        }
      }

      // Clear pattern once flash animation completes
      if (!gameState.activeFlash) {
        activePattern = null;
      }

      // Play audio when a new flash starts
      const newFlash = getCurrentFlashColor(gameState);
      if (newFlash !== prevFlash && newFlash && gameState.activeFlash?.flash) {
        const f = gameState.activeFlash.flash;
        signalFlash(f.type, f.color);
      }

      // Network: captain sends position to keeper
      if (myRole === "captain") {
        netTickAccum += dt;
        if (netTickAccum >= NET_TICK_RATE) {
          netTickAccum = 0;
          send({
            t: "ship-pos",
            x: gameState.ship.x,
            y: gameState.ship.y,
            heading: gameState.ship.heading,
          });
        }
      }

      // Phase change handling
      if (prevPhase !== gameState.phase) {
        if (gameState.phase === "success" || gameState.phase === "failure") {
          finishGame(gameState.phase);
          send({ t: "game-over", result: gameState.phase });
        }
      }
    });
    loop.start();
  }

  function finishGame(result: "success" | "failure"): void {
    loop?.stop();
    stopAmbient?.();
    if (result === "success") {
      successFanfare();
      log("⚓ HARBOR REACHED!", "ok");
    } else {
      collisionCrunch();
      failureStinger();
      log("💀 SHIP LOST.", "bad");
    }
    if (gameState && gameState.phase !== "success" && gameState.phase !== "failure") {
      gameState = { ...gameState, phase: result };
    }
  }

  function handleSignal(command: SignalCommand): void {
    if (!gameState || myRole !== "keeper") return;
    const pattern = encodeSignal(command);
    const updated = sendSignal(gameState, command);
    if (updated === gameState) return; // cooldown or already flashing
    activePattern = [...pattern];
    gameState = updated;
    send({ t: "signal", command });
    log(`↑ Signal: ${command}`, "ok");
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent): void {
    keysHeld.add(e.key);
    updateCaptainInput();
  }

  function onKeyUp(e: KeyboardEvent): void {
    keysHeld.delete(e.key);
    updateCaptainInput();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    const urlCode = readRoomCodeFromUrl();
    if (urlCode) {
      autoJoinCode = urlCode;
      handleJoin(urlCode);
      clearRoomCodeFromUrl();
    }

    // Test event bridge: allows Playwright e2e tests to trigger game-over
    // without waiting for the full timer. Dispatching these events during
    // normal gameplay has no effect and is harmless in production.
    // Only compiled in when VITE_TEST=true (set by the Playwright webServer command).
    if (!import.meta.env.VITE_TEST) return;
    const forceEnd = (e: Event) => {
      const result = (e as CustomEvent<"success" | "failure">).detail;
      if (gameState?.phase === "playing") {
        finishGame(result);
        send({ t: "game-over", result });
      }
    };
    window.addEventListener("__sema:force-end", forceEnd);
    return () => window.removeEventListener("__sema:force-end", forceEnd);
  });

  onDestroy(() => {
    loop?.stop();
    stopAmbient?.();
    tearDownNet();
  });

  // ── Derived display values ─────────────────────────────────────────────────

  const flashColorRaw = $derived(gameState ? getCurrentFlashColor(gameState) : null);
  const isFlashing = $derived(!!flashColorRaw);
  const flashColor = $derived(flashColorRaw);

  const stats = $derived(
    gameState && (gameState.phase === "success" || gameState.phase === "failure")
      ? deriveStats(gameState)
      : null
  );
</script>

<svelte:head>
  <title>Semaphoria — Lighthouse Co-op</title>
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<div class="semaphoria-page">
  {#if lobbyPhase === "lobby"}
    <div class="lobby-wrap">
      <div class="lobby-card">
        <div class="role-selector">
          <button
            class="role-btn"
            class:active={myRole === "keeper"}
            onclick={() => (myRole = "keeper")}
          >
            🏠 KEEPER
          </button>
          <button
            class="role-btn"
            class:active={myRole === "captain"}
            onclick={() => (myRole = "captain")}
          >
            🚢 CAPTAIN
          </button>
        </div>

        <Lobby
          title="SEMAPHORIA"
          subtitle="Open a channel or enter a room code to join."
          onHost={handleHost}
          onJoin={handleJoin}
          {players}
          {roomCode}
          {canStart}
          onStart={handleStart}
          status={lobbyStatus}
          initialJoinCode={autoJoinCode}
        />

        <div style="margin-top: 8px;">
          <SignalReference entries={SIGNAL_REFERENCE} compact />
        </div>
      </div>
    </div>
  {:else if gameState}
    <div class="game-wrap">
      <!-- Header -->
      <div class="game-header">
        <h2>SEMAPHORIA</h2>
        <div class="header-pills">
          <span class="pill role">{myRole.toUpperCase()}</span>
          {#if gameState.phase === "countdown"}
            <span class="pill">COUNTDOWN</span>
          {:else if gameState.phase === "playing"}
            <span class="pill">PLAYING</span>
          {/if}
          <Timer seconds={gameState.timeRemaining} />
        </div>
        <div class="net-dot" class:ok={netOk} class:err={!netOk} title="Network"></div>
      </div>

      <!-- Main game area -->
      <div class="game-body">
        <div class="canvas-area">
          <Canvas>
            {#if myRole === "captain"}
              <CaptainView
                ship={gameState.ship}
                map={gameState.map}
                revealedTileKeys={gameState.revealedTileKeys}
                rescuedWreckIds={gameState.rescuedWreckIds}
                {flashColor}
                {isFlashing}
              />
            {:else}
              <KeeperView
                ship={gameState.ship}
                map={gameState.map}
                rescuedWreckIds={gameState.rescuedWreckIds}
                {flashColor}
                {isFlashing}
              />
            {/if}
          </Canvas>

          <!-- Countdown overlay -->
          {#if gameState.phase === "countdown"}
            <div class="countdown-overlay">
              <div class="countdown-number">
                {Math.ceil(gameState.countdownRemaining)}
              </div>
            </div>
          {/if}

          <!-- Captain HUD -->
          {#if myRole === "captain"}
            {@const allRescued =
              gameState.rescuedWreckIds.size >= gameState.map.wrecks.length &&
              gameState.map.wrecks.length > 0}
            <div class="hud-captain">
              <div class="hud-chip">
                HEADING {((gameState.ship.heading * 180) / Math.PI).toFixed(0)}°
              </div>
              <div class="hud-chip" class:hud-chip-ok={allRescued}>
                {#if allRescued}
                  ALL ABOARD — MAKE FOR HARBOUR
                {:else}
                  SURVIVORS {gameState.rescuedWreckIds.size} / {gameState.map.wrecks.length}
                {/if}
              </div>
              <div class="hud-chip steer-hint">WASD / ↑←→ to steer</div>
            </div>
          {/if}
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
          {#if myRole === "keeper"}
            <div class="panel">
              <div class="panel-title">SEND SIGNAL</div>
              <SignalPanel
                onSignal={handleSignal}
                cooldown={gameState.signalCooldown}
                disabled={gameState.phase !== "playing"}
              />
            </div>
          {/if}

          <div class="panel">
            <div class="panel-title">
              RESCUES {gameState.rescuedWreckIds.size} / {gameState.map.wrecks.length}
            </div>
            <ul class="wreck-list">
              {#each gameState.map.wrecks as wreck (wreck.id)}
                {@const done = gameState.rescuedWreckIds.has(wreck.id)}
                <li class:done>
                  <span class="wreck-mark" aria-hidden="true">{done ? "✓" : "•"}</span>
                  <span class="wreck-label">{RESCUE_VARIANT_LABEL[wreck.variant]}</span>
                  {#if myRole === "keeper"}
                    <span class="wreck-coord">({wreck.x},{wreck.y})</span>
                  {/if}
                </li>
              {/each}
              {#if gameState.map.wrecks.length === 0}
                <li class="empty">No survivors on this route.</li>
              {/if}
            </ul>
          </div>

          <div class="panel">
            <div class="panel-title">SIGNAL REFERENCE</div>
            <SignalReference entries={SIGNAL_REFERENCE} compact />
          </div>

          <div class="panel">
            <div class="panel-title">LOG</div>
            <LogPanel entries={logs} />
          </div>
        </div>
      </div>
    </div>

    <!-- Result screen -->
    {#if stats}
      <div class="result-overlay">
        <div class="result-card">
          <p class="result-title {stats.result}">
            {stats.result === "success" ? "HARBOR REACHED" : "SHIP LOST"}
          </p>
          <p style="opacity: 0.7; margin: 0; font-size: 13px;">
            {stats.result === "success"
              ? "The crew cheers as land comes into view."
              : "The reef claims another vessel."}
          </p>
          <ul class="result-stats">
            <li>
              <span>Time taken</span>
              <span>{stats.timeTaken.toFixed(1)}s</span>
            </li>
            <li>
              <span>Signals sent</span>
              <span>{stats.signalsSent}</span>
            </li>
            <li>
              <span>Near misses</span>
              <span>{stats.nearMisses}</span>
            </li>
            <li>
              <span>Survivors rescued</span>
              <span>{stats.wrecksRescued} / {stats.wrecksTotal}</span>
            </li>
          </ul>
          <button onclick={() => location.reload()}>PLAY AGAIN</button>
        </div>
      </div>
    {/if}
  {/if}
</div>
