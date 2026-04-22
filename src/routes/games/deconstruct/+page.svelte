<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Canvas } from "@threlte/core";
  import "./style.css";
  import { gs } from "$lib/games/deconstruct/gameState.svelte.js";
  import Scene from "$lib/games/deconstruct/Scene.svelte";
  import { COLORS_CSS, PLAYER_CSS } from "$lib/games/deconstruct/types.js";
  import type { Card } from "$lib/games/deconstruct/types.js";
  import {
    buildRoomShareUrl,
    clearRoomCodeFromUrl,
    copyToClipboard,
    readRoomCodeFromUrl,
  } from "$lib/room-url";

  type DeconMod = typeof import("$lib/games/deconstruct/main");
  let mod: DeconMod | null = null;

  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    mod = await import("$lib/games/deconstruct/main");

    const autoJoinCode = readRoomCodeFromUrl();
    if (autoJoinCode) {
      gs.joinCodeInput = autoJoinCode;
      mod.joinGame();
      clearRoomCodeFromUrl();
    }
  });

  onDestroy(() => {
    mod?.destroy();
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
  });

  const soloGame = () => mod?.soloGame();
  const hostGame = () => mod?.hostGame();
  const joinGame = () => mod?.joinGame();
  const hostStartNow = () => mod?.hostStartNow();
  const onPickCard = () => mod?.onPickCard();
  const onClear = () => mod?.onClear();
  const onPass = () => mod?.onPass();
  const returnToLobby = () => mod?.returnToLobby();
  const dismissResults = () => mod?.dismissResults();

  function cardHasPlacement(card: Card): boolean {
    return mod?.cardHasPlacement(card) ?? true;
  }

  function flashCopyStatus(msg: string): void {
    copyStatus = msg;
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      copyStatus = "";
    }, 1600);
  }

  async function copyRoomCode(): Promise<void> {
    if (!gs.roomCode) return;
    const ok = await copyToClipboard(gs.roomCode);
    flashCopyStatus(ok ? `Copied ${gs.roomCode}` : "Copy failed");
  }

  async function copyRoomLink(): Promise<void> {
    if (!gs.roomCode) return;
    const ok = await copyToClipboard(buildRoomShareUrl(gs.roomCode));
    flashCopyStatus(ok ? "Copied invite link" : "Copy failed");
  }
  const selectCard = (idx: number) => {
    if (!gs.locked) {
      gs.selectedCardIdx = idx;
      gs.selected = [];
    }
  };

  function handleCardKeydown(e: KeyboardEvent, idx: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectCard(idx);
    }
  }

  function slotName(slot: number): string {
    if (slot === gs.mySlot) return "You";
    return gs.playerNames[slot] || (gs.isSolo ? "CPU" : "P" + (slot + 1));
  }

  function colorName(key: string): string {
    const names: Record<string, string> = {
      R: "ALPHA",
      G: "BETA",
      B: "GAMMA",
      Y: "DELTA",
      P: "EPSILON",
    };
    return names[key] ?? key;
  }
</script>

<svelte:head>
  <title>Deconstruct — LDJAM 59</title>
</svelte:head>

<div class="deconstruct-page">
  <!-- Threlte Canvas -->
  <div class="canvas-wrapper">
    <Canvas shadows>
      <Scene />
    </Canvas>
  </div>

  {#if gs.phase === "lobby"}
    <div id="lobby">
      <div class="lobby-box">
        <h1>DECONSTRUCT</h1>
        <div class="subtitle">Tune. Decode. Intercept. &mdash; 1-6 operators</div>

        {#if gs.lobbyPanel === "menu"}
          <div id="lobby-menu">
            <div class="lobby-btns">
              <button onclick={soloGame}>SOLO vs CPU</button>
              <div class="or-divider">&mdash; multiplayer &mdash;</div>
              <button onclick={hostGame}>OPEN CHANNEL</button>
              <div class="or-divider" style="opacity:0.3;font-size:12px;">&mdash; or &mdash;</div>
              <label for="decon-join-code" style="opacity:0.6;font-size:12px;"
                >Frequency ID (room code)</label
              >
              <input
                id="decon-join-code"
                maxlength="6"
                placeholder="FREQ ID"
                spellcheck="false"
                autocomplete="off"
                bind:value={gs.joinCodeInput}
              />
              <button onclick={joinGame}>TUNE IN</button>
            </div>
          </div>
        {:else if gs.lobbyPanel === "waiting"}
          <div id="lobby-waiting">
            <div style="opacity:0.6;">Share this frequency ID:</div>
            <div class="room-code-display">{gs.roomCode}</div>
            <div class="lobby-btns" style="margin-top:6px;">
              <div class="row" style="gap:8px;justify-content:center;">
                <button class="btn-secondary" type="button" onclick={copyRoomCode}>COPY CODE</button
                >
                <button class="btn-secondary" type="button" onclick={copyRoomLink}>COPY LINK</button
                >
              </div>
              {#if copyStatus}
                <div style="font-size:12px;opacity:0.85;" role="status" aria-live="polite">
                  {copyStatus}
                </div>
              {/if}
            </div>
            <div class="player-list">
              {#each gs.playerList as entry (entry.slot)}
                <div style="color: {entry.color};">
                  {entry.slot === 0 ? "★ " : ""}{entry.name}{entry.slot === 0 ? "" : " — connected"}
                </div>
              {/each}
            </div>
            <button
              style="margin-top:14px;"
              onclick={hostStartNow}
              disabled={gs.playerList.length < 2}>BEGIN TRANSMISSION</button
            >
            <div class="lobby-status">{gs.lobbyStatus}</div>
          </div>
        {:else if gs.lobbyPanel === "joining"}
          <div id="lobby-joining">
            <div class="lobby-status">{gs.joinStatus}</div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div id="ui-overlay">
      <div class="score-bar">
        <div class="title">// DECONSTRUCT</div>
        {#each gs.allScores as s (s.slot)}
          <span
            class="score-chip{s.slot === gs.mySlot ? ' me' : ''}"
            style="border-color: {PLAYER_CSS[s.slot] ?? ''}; color: {PLAYER_CSS[s.slot] ?? ''};"
            >{slotName(s.slot)}: {s.score}</span
          >
        {/each}
      </div>

      <div id="hint">
        Drag to rotate &bull; Scroll to zoom &bull; Click top blocks to select &bull; Cycle <span
          id="round-num">{gs.turn}</span
        >/10
      </div>

      <div id="log-panel" role="log" aria-live="polite" aria-label="Game log">
        {#each gs.logEntries as entry, i (i)}
          <div
            style={entry.kind === "ok"
              ? "color:#8dff9d"
              : entry.kind === "bad"
                ? "color:#ff6b6b"
                : ""}
          >
            {entry.text}
          </div>
        {/each}
      </div>

      <div
        id="msg-bar"
        class="msg-bar{gs.msgKind ? ' ' + gs.msgKind : ''}"
        role="status"
        aria-live="polite"
      >
        {gs.msgText}
      </div>

      <div id="wait-banner" class={gs.showWait ? "" : "hidden"} role="status" aria-live="polite">
        // Awaiting other operators&hellip;
      </div>

      {#key gs.invalidShake}
        <div id="side-panel" class={gs.invalidShake > 0 ? "shake" : ""}>
          <div id="player-hand" class="hand">
            {#each gs.myHand as card, idx (card.init)}
              {@const mx = Math.max(...card.shape.cells.map((p) => p[0] ?? 0)) + 1}
              {@const my = Math.max(...card.shape.cells.map((p) => p[1] ?? 0)) + 1}
              {@const playable = cardHasPlacement(card)}
              <div
                class="card{gs.selectedCardIdx === idx ? ' selected' : ''}{playable
                  ? ''
                  : ' unplayable'}"
                style="border-color: {COLORS_CSS[card.color]};"
                onclick={() => selectCard(idx)}
                role="button"
                tabindex="0"
                title={playable
                  ? `${card.shape.name} on ${colorName(card.color)}`
                  : `No valid target for ${colorName(card.color)} on the grid`}
                aria-disabled={!playable}
                onkeydown={(e) => handleCardKeydown(e, idx)}
              >
                <div class="card-num">Δ{card.init}</div>
                <div class="card-label">{card.shape.name}</div>
                <div class="mini-grid" style="grid-template-columns: repeat({mx}, 12px);">
                  {#each Array.from({ length: my }, (_, i) => i) as dy (dy)}
                    {#each Array.from({ length: mx }, (_, i) => i) as dx (dx)}
                      <div
                        class="mini-dot{card.shape.cells.some((p) => p[0] === dx && p[1] === dy)
                          ? ' active'
                          : ''}"
                        style={card.shape.cells.some((p) => p[0] === dx && p[1] === dy)
                          ? `background-color: ${COLORS_CSS[card.color]}`
                          : ""}
                      ></div>
                    {/each}
                  {/each}
                </div>
                {#if !playable}
                  <div class="card-badge">NO MATCH</div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="btn-group">
            <button
              id="resolve-btn"
              disabled={gs.locked || gs.selectedCardIdx == null || gs.selected.length === 0}
              onclick={onPickCard}>TRANSMIT</button
            >
            <button class="btn-secondary" onclick={onClear}>CLEAR</button>
            <button class="btn-secondary" onclick={onPass}>HOLD</button>
          </div>
        </div>
      {/key}

      {#if gs.showRoundSummary && gs.lastRoundResults.length > 0}
        <div class="round-summary" role="dialog" aria-label="Round results">
          <div class="round-summary-head">
            // CYCLE {gs.lastRoundTurn} RESULTS
          </div>
          <div class="round-summary-body">
            {#each gs.lastRoundResults as r (r.slot)}
              <div class="round-row" style="border-left-color: {PLAYER_CSS[r.slot] ?? '#888'};">
                <span class="round-player" style="color: {PLAYER_CSS[r.slot] ?? '#ccc'};"
                  >{slotName(r.slot)}</span
                >
                <span class="round-play">
                  {#if r.card}
                    Δ{r.card.init} · {r.card.shape.name} · {colorName(r.card.color)}
                  {:else}
                    held carrier
                  {/if}
                </span>
                <span
                  class="round-points {r.points > 0
                    ? 'pts-ok'
                    : r.card
                      ? 'pts-bad'
                      : 'pts-neutral'}"
                >
                  {r.points > 0 ? "+" + r.points : r.card ? "0 (lost)" : "—"}
                </span>
              </div>
            {/each}
          </div>
          <button class="btn-secondary round-dismiss" onclick={dismissResults}>DISMISS</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if gs.phase === "end" && gs.finalResults}
    {@const finalScores = [...gs.finalResults.scores].sort((a, b) => b.score - a.score)}
    <div id="end-screen" role="dialog" aria-label="Final transmission results">
      <div class="end-box">
        <h1>// TRANSMISSION CLOSED</h1>
        <div class="end-winner">
          {#if gs.finalResults.winnerSlot === -2}
            Signal split — tied transmission.
          {:else if gs.finalResults.winnerSlot === gs.mySlot}
            You intercepted the transmission.
          {:else}
            {slotName(gs.finalResults.winnerSlot)} intercepted the transmission.
          {/if}
        </div>
        <div class="end-scores">
          {#each finalScores as s, i (s.slot)}
            <div
              class="end-score-row {i === 0 ? 'top' : ''}"
              style="border-color: {PLAYER_CSS[s.slot] ?? '#3a3a4a'};"
            >
              <span class="end-rank">{i + 1}</span>
              <span class="end-name" style="color: {PLAYER_CSS[s.slot] ?? '#fff'};"
                >{slotName(s.slot)}</span
              >
              <span class="end-points">{s.score}</span>
            </div>
          {/each}
        </div>
        <button onclick={returnToLobby}>RETURN TO LOBBY</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .canvas-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
  }
  .canvas-wrapper :global(canvas) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
