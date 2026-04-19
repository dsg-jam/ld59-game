<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Canvas } from "@threlte/core";
  import "./style.css";
  import { gs } from "$lib/games/deconstruct/gameState.svelte.js";
  import Scene from "$lib/games/deconstruct/Scene.svelte";
  import { COLORS_CSS, PLAYER_CSS } from "$lib/games/deconstruct/types.js";

  type DeconMod = typeof import("$lib/games/deconstruct/main");
  let mod: DeconMod | null = null;

  onMount(async () => {
    mod = await import("$lib/games/deconstruct/main");
  });

  onDestroy(() => {
    mod?.destroy();
  });

  const soloGame = () => mod?.soloGame();
  const hostGame = () => mod?.hostGame();
  const joinGame = () => mod?.joinGame();
  const hostStartNow = () => mod?.hostStartNow();
  const onPickCard = () => mod?.onPickCard();
  const onClear = () => mod?.onClear();
  const onPass = () => mod?.onPass();
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
              <label for="decon-join-code" style="opacity:0.6;font-size:12px;">Frequency ID (room code)</label>
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
            <div class="player-list">
              {#each gs.playerList as entry (entry.slot)}
                <div style="color: {entry.color};">
                  {entry.slot === 0 ? "★ " : ""}{entry.name}{entry.slot === 0
                    ? ""
                    : " — connected"}
                </div>
              {/each}
            </div>
            <button
              style="margin-top:14px;"
              onclick={hostStartNow}
              disabled={gs.playerList.length < 2}
            >BEGIN TRANSMISSION</button>
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
          >{entry.text}</div>
        {/each}
      </div>

      <div id="msg-bar" class="msg-bar{gs.msgKind ? ' ' + gs.msgKind : ''}" role="status" aria-live="polite">{gs.msgText}</div>

      <div id="wait-banner" class={gs.showWait ? "" : "hidden"} role="status" aria-live="polite">
        // Awaiting other operators&hellip;
      </div>

      <div id="side-panel">
        <div id="player-hand" class="hand">
          {#each gs.myHand as card, idx (idx)}
            {@const mx = Math.max(...card.shape.cells.map((p) => p[0] ?? 0)) + 1}
            {@const my = Math.max(...card.shape.cells.map((p) => p[1] ?? 0)) + 1}
            <div
              class="card{gs.selectedCardIdx === idx ? ' selected' : ''}"
              style="border-color: {COLORS_CSS[card.color]};"
              onclick={() => selectCard(idx)}
              role="button"
              tabindex="0"
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
            </div>
          {/each}
        </div>
        <div class="btn-group">
          <button
            id="resolve-btn"
            disabled={gs.locked || gs.selectedCardIdx == null || gs.selected.length === 0}
            onclick={onPickCard}
          >TRANSMIT</button>
          <button class="btn-secondary" onclick={onClear}>CLEAR</button>
          <button class="btn-secondary" onclick={onPass}>HOLD</button>
        </div>
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
