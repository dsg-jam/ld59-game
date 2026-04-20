<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import "./style.css";
  import { OFFSET_MIN, OFFSET_MAX } from "$lib/games/signal-weave/main";
  import type { SignalWeaveControls, PlayerInfo } from "$lib/games/signal-weave/main";
  import {
    buildRoomShareUrl,
    clearRoomCodeFromUrl,
    copyToClipboard,
    readRoomCodeFromUrl,
  } from "$lib/room-url";

  // ── UI state ────────────────────────────────────────────────────────────────
  let phase = $state<"lobby" | "game">("lobby");
  let roomCode = $state("");
  let roomWrapVisible = $state(false);
  let startEnabled = $state(false);
  let lobbyStatus = $state("");
  let slotLabel = $state("--");
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

  function flashCopyStatus(msg: string): void {
    copyStatus = msg;
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      copyStatus = "";
    }, 1600);
  }

  async function copyRoomCode(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(roomCode);
    flashCopyStatus(ok ? `Copied code ${roomCode}` : "Copy failed");
  }

  async function copyRoomLink(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(buildRoomShareUrl(roomCode));
    flashCopyStatus(ok ? "Copied invite link" : "Copy failed");
  }

  let hudTime = $state("90.0");
  let hudHarmony = $state("0.0");
  let hudCombo = $state("x0");
  let modeLabel = $state("MOV. I — DRIFT");
  let modeColor = $state("#ff7ccf");
  let roster = $state<PlayerInfo[]>([]);
  let milestone = $state("");
  let milestoneTimer: ReturnType<typeof setTimeout> | undefined;

  interface LogEntry {
    id: number;
    text: string;
    kind: string;
  }
  let logSeq = 0;
  let logs = $state<LogEntry[]>([]);
  let netStatus = $state("Idle.");
  let offsetLabel = $state("0.00 rad");
  let offsetValue = $state(0);
  let flashClass = $state("");
  let joinCode = $state("");

  // ── Canvas + engine refs ───────────────────────────────────────────────────
  let canvasEl: HTMLCanvasElement;
  let controls: SignalWeaveControls | null = null;

  onMount(async () => {
    const { mount } = await import("$lib/games/signal-weave/main");
    controls = mount(canvasEl, {
      onLobbyStatus: (t) => {
        lobbyStatus = t;
      },
      onRoomCode: (c) => {
        roomCode = c;
      },
      onRoomWrapVisible: (v) => {
        roomWrapVisible = v;
      },
      onStartEnabled: (v) => {
        startEnabled = v;
      },
      onGameStart: () => {
        phase = "game";
      },
      onSlot: (s) => {
        slotLabel = s;
      },
      onHud: (t, h, c) => {
        hudTime = t.toFixed(1);
        hudHarmony = h.toFixed(1);
        hudCombo = "x" + c;
      },
      onLog: (text, kind) => {
        logSeq += 1;
        logs = [{ id: logSeq, text, kind }, ...logs].slice(0, 20);
      },
      onNetStatus: (t) => {
        netStatus = t;
      },
      onOffset: (value, label) => {
        offsetValue = value;
        offsetLabel = label;
      },
      onFlash: (k) => {
        flashClass = k;
        setTimeout(() => {
          flashClass = "";
        }, 200);
      },
      onMode: (label, color) => {
        modeLabel = label;
        modeColor = color;
      },
      onRoster: (next) => {
        roster = next;
      },
      onMilestone: (text) => {
        milestone = text;
        if (milestoneTimer !== undefined) clearTimeout(milestoneTimer);
        milestoneTimer = setTimeout(() => {
          milestone = "";
        }, 2400);
      },
    });

    const autoJoinCode = readRoomCodeFromUrl();
    if (autoJoinCode) {
      joinCode = autoJoinCode;
      controls.joinGame(autoJoinCode);
      clearRoomCodeFromUrl();
    }
  });

  onDestroy(() => {
    controls?.destroy();
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
    if (milestoneTimer !== undefined) clearTimeout(milestoneTimer);
  });
</script>

<svelte:head>
  <title>Signal Weave – Multiplayer Waveform Game</title>
</svelte:head>

<div class="signal-weave-page">
  {#if phase === "lobby"}
    <div id="lobby">
      <div class="card">
        <h1>SIGNAL WEAVE</h1>
        <p>Two to six operators shape one impossible waveform.</p>
        <p>
          Each slot owns its own sine component. Slide your phase to match the magenta target, then
          fire synchronized pulses for combo bursts.
        </p>
        <div class="row" style="margin-top:10px">
          <button id="host-btn" onclick={() => controls?.hostGame()}>OPEN CHANNEL</button>
        </div>
        <div style="margin:10px 0;color:var(--dim)">— or —</div>
        <input id="join-code" maxlength="6" placeholder="ROOM CODE" bind:value={joinCode} />
        <div class="row" style="margin-top:8px">
          <button id="join-btn" onclick={() => controls?.joinGame(joinCode.trim().toUpperCase())}
            >TUNE IN</button
          >
        </div>
        {#if roomWrapVisible}
          <div id="room-wrap">
            <p style="margin-top:10px">Share this code:</p>
            <div class="room" id="room-code">{roomCode}</div>
            <div class="row" style="margin-top:8px">
              <button type="button" onclick={copyRoomCode}>COPY CODE</button>
              <button type="button" onclick={copyRoomLink}>COPY LINK</button>
            </div>
            {#if copyStatus}
              <p
                style="margin-top:4px;color:var(--good);font-size:12px"
                role="status"
                aria-live="polite"
              >
                {copyStatus}
              </p>
            {/if}
            {#if roster.length}
              <div id="lobby-roster" class="lobby-roster">
                {#each roster as p (p.slot)}
                  <span class="op-chip" style:border-color={p.color} style:color={p.color}>
                    P{p.slot + 1} · {p.label}{p.isYou ? " (you)" : ""}
                  </span>
                {/each}
              </div>
            {/if}
            <button id="start-btn" disabled={!startEnabled} onclick={() => controls?.startGame()}
              >BEGIN WEAVE</button
            >
          </div>
        {/if}
        <p id="lobby-status">{lobbyStatus}</p>
      </div>
    </div>
  {/if}

  <div id="app">
    <div id="stage">
      <canvas bind:this={canvasEl} width="1200" height="800"></canvas>
      <div class="hud">
        <div class="chip">TIME <b>{hudTime}</b></div>
        <div class="chip">HARMONY <b>{hudHarmony}</b></div>
        <div class="chip">COMBO <b>{hudCombo}</b></div>
        <div class="chip">YOU <b id="slot">{slotLabel}</b></div>
        <div class="chip" id="mode-chip" style:color={modeColor} style:border-color={modeColor}>
          {modeLabel}
        </div>
      </div>
      <div id="flash" class={flashClass} style:opacity={flashClass ? "1" : "0"}></div>
      {#if milestone}
        <div id="milestone" role="status" aria-live="polite">{milestone}</div>
      {/if}
    </div>
    <div id="sidebar">
      <div class="panel">
        <h3>CONTROL</h3>
        <div>PHASE OFFSET</div>
        <input
          id="offset"
          type="range"
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          bind:value={offsetValue}
          oninput={() => controls?.setOffset(offsetValue)}
        />
        <div id="offset-label">{offsetLabel}</div>
        <div class="row" style="margin-top:8px">
          <button id="pulse-btn" onclick={() => controls?.pulse()}>TRANSMIT PULSE [SPACE]</button>
        </div>
      </div>
      <div class="panel">
        <h3>OPERATORS</h3>
        <div id="game-roster" class="game-roster">
          {#each roster as p (p.slot)}
            <div class="op-row">
              <span class="op-dot" style:background={p.color}></span>
              <span style:color={p.color}>P{p.slot + 1} · {p.label}</span>
              {#if p.isYou}<span class="you-tag">you</span>{/if}
            </div>
          {:else}
            <div style="color:var(--dim)">solo</div>
          {/each}
        </div>
      </div>
      <div class="panel">
        <h3>PROTOCOL</h3>
        <div style="color:var(--dim);font-size:12px">
          Each operator owns one sine component. Slide your phase to match the magenta target.<br />
          <b>Pair pulse</b> = 2 ops within 0.85 s · <b>Team burst</b> = 3+ · <b>Constellation</b> =
          all of you in sync. Bigger sync, bigger harmony.<br />
          Movements rotate every 25 s — drift, double, tempest.
        </div>
      </div>
      <div class="panel">
        <h3>NETWORK</h3>
        <div id="status">{netStatus}</div>
      </div>
      <div class="panel">
        <h3>LOG</h3>
        <div id="log">
          {#each logs as entry (entry.id)}
            <div class={entry.kind}>{entry.text}</div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
