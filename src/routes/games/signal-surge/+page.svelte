<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Canvas } from "@threlte/core";
  import "./style.css";
  import { gs } from "$lib/games/signal-surge/gameState.svelte.js";
  import Scene from "$lib/games/signal-surge/Scene.svelte";

  type SurgeMod = typeof import("$lib/games/signal-surge/main");
  let mod: SurgeMod | null = null;

  onMount(() => {
    void (async () => {
      mod = await import("$lib/games/signal-surge/main");
      mod.init();
    })();
  });

  onDestroy(() => {
    mod?.destroy();
  });

  function resolvedName(): string {
    return gs.operatorName.trim().slice(0, 14) || "OPERATOR";
  }

  function onHost(): void {
    mod?.hostGame(resolvedName());
  }
  function onJoin(): void {
    mod?.joinGame(gs.joinCode.trim().toUpperCase(), resolvedName());
  }
  function onStart(): void {
    mod?.startGame();
  }
</script>

<svelte:head>
  <title>Signal Surge — Multiplayer Signal Race</title>
</svelte:head>

<div class="signal-surge-page">
  <div class="canvas-wrapper">
    <Canvas shadows>
      <Scene />
    </Canvas>
  </div>

  {#if gs.phase === "lobby"}
    <div id="lobby" role="dialog" aria-modal="true" aria-labelledby="surge-lobby-title">
      <div class="card">
        <h1 id="surge-lobby-title">SIGNAL SURGE</h1>
        <p>Three to six operators race packets down a broadcast channel.</p>
        <p>Ride amplifiers, dodge noise, fire bursts. First carrier through wins.</p>

        <label class="field" for="surge-name">
          <span>Operator callsign</span>
          <input
            id="surge-name"
            type="text"
            maxlength="14"
            placeholder="OPERATOR"
            spellcheck="false"
            autocomplete="off"
            bind:value={gs.operatorName}
          />
        </label>

        <div class="row" style="margin-top:10px">
          <button type="button" onclick={onHost}>OPEN CHANNEL</button>
        </div>
        <div class="divider">— or —</div>
        <label class="field" for="surge-join-code">
          <span>Room code</span>
          <input
            id="surge-join-code"
            type="text"
            maxlength="6"
            placeholder="ROOM CODE"
            spellcheck="false"
            autocomplete="off"
            bind:value={gs.joinCode}
          />
        </label>
        <div class="row" style="margin-top:8px">
          <button type="button" onclick={onJoin}>TUNE IN</button>
        </div>

        {#if gs.roomWrapVisible}
          <div id="room-wrap">
            <p style="margin-top:10px">Share this code:</p>
            <div class="room">{gs.roomCode}</div>
            <div class="players">
              {#each gs.lobbyPlayers as player (player.slot)}
                <div class="player-tag" style:border-color={player.color}>
                  <span class="tag-dot" style:background={player.color}></span>
                  {player.name}{player.isYou ? " (you)" : ""}
                </div>
              {:else}
                <div class="player-tag muted">No operators connected.</div>
              {/each}
            </div>
            <button type="button" disabled={!gs.startEnabled} onclick={onStart}>
              LAUNCH RACE
            </button>
            {#if !gs.startEnabled}
              <div class="hint">Need at least 3 operators to launch.</div>
            {/if}
          </div>
        {/if}

        <p class="status" role="status" aria-live="polite">{gs.lobbyStatus}</p>
      </div>
    </div>
  {/if}

  {#if gs.phase === "end"}
    <div id="endscreen" role="dialog" aria-modal="true" aria-labelledby="surge-end-title">
      <div class="card">
        <h1 id="surge-end-title">CHANNEL CLEARED</h1>
        <p>Winner: <strong>{gs.winnerName}</strong></p>
        <ol class="order">
          {#each gs.finishOrder as entry, idx (entry.slot)}
            <li style:color={entry.color}>
              <span class="place">{String(idx + 1).padStart(2, "0")}</span>
              {entry.name}
            </li>
          {/each}
        </ol>
        <p class="hint">Refresh to start a new race.</p>
      </div>
    </div>
  {/if}

  {#if gs.phase === "game"}
    <div class="hud">
      <div class="chip">YOU <b>{gs.slotLabel}</b></div>
      <div class="chip">PLACE <b>{gs.hudPlace}/{gs.hudTotal}</b></div>
      <div class="chip">PROGRESS <b>{gs.hudProgress}%</b></div>
      <div class="chip">BURSTS <b>{gs.hudBursts}</b></div>
      {#if gs.countdownLabel}
        <div class="chip countdown">T-{gs.countdownLabel}</div>
      {/if}
    </div>

    <div class="controls-hint" aria-hidden="true">
      <span><kbd>←</kbd>/<kbd>A</kbd></span>
      <span><kbd>→</kbd>/<kbd>D</kbd></span>
      <span><kbd>SPACE</kbd> burst</span>
    </div>

    <div class="log-panel" role="log" aria-live="polite">
      {#each gs.logs as entry (entry.id)}
        <div class={entry.kind}>{entry.text}</div>
      {/each}
    </div>

    <div class="net-line" role="status" aria-live="polite">{gs.netStatus}</div>

    {#if gs.countdownLabel}
      <div class="countdown-overlay" aria-hidden="true">{gs.countdownLabel}</div>
    {/if}
  {/if}
</div>
