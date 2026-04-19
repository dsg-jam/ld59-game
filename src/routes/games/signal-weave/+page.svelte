<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import "./style.css";
  import { OFFSET_MIN, OFFSET_MAX } from "$lib/games/signal-weave/main";
  import type { SignalWeaveControls } from "$lib/games/signal-weave/main";

  // ── UI state ────────────────────────────────────────────────────────────────
  let phase = $state<"lobby" | "game">("lobby");
  let roomCode = $state("");
  let roomWrapVisible = $state(false);
  let startEnabled = $state(false);
  let lobbyStatus = $state("");
  let slotLabel = $state("--");

  let hudTime = $state("90.0");
  let hudHarmony = $state("0.0");
  let hudCombo = $state("x0");

  interface LogEntry {
    text: string;
    kind: string;
  }
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
        logs = [{ text, kind }, ...logs].slice(0, 20);
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
        }, 140);
      },
    });
  });

  onDestroy(() => {
    controls?.destroy();
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
        <p>Two operators shape one impossible waveform.</p>
        <p>Match the target signal and fire synchronized pulses.</p>
        <div class="row" style="margin-top:10px">
          <button id="host-btn" onclick={() => controls?.hostGame()}>OPEN CHANNEL</button>
        </div>
        <div style="margin:10px 0;color:var(--dim)">— or —</div>
        <input
          id="join-code"
          maxlength="6"
          placeholder="ROOM CODE"
          bind:value={joinCode}
        />
        <div class="row" style="margin-top:8px">
          <button id="join-btn" onclick={() => controls?.joinGame(joinCode.trim().toUpperCase())}
            >TUNE IN</button
          >
        </div>
        {#if roomWrapVisible}
          <div id="room-wrap">
            <p style="margin-top:10px">Share this code:</p>
            <div class="room" id="room-code">{roomCode}</div>
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
      </div>
      <div id="flash" class={flashClass} style:opacity={flashClass ? "1" : "0"}></div>
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
        <h3>PROTOCOL</h3>
        <div style="color:var(--dim)">
          Keep the cyan combined wave close to the magenta target.<br />
          Synchronized pulses (&lt; 0.8s apart) amplify harmony when alignment is good.
        </div>
      </div>
      <div class="panel">
        <h3>NETWORK</h3>
        <div id="status">{netStatus}</div>
      </div>
      <div class="panel">
        <h3>LOG</h3>
        <div id="log">
          {#each logs as entry, i (i)}
            <div class={entry.kind}>{entry.text}</div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
