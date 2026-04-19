<script lang="ts">
  import { onMount } from "svelte";
  import "./style.css";
  import { deconstructApi } from "$lib/games/deconstruct/api";

  const soloGame = (): void => deconstructApi.soloGame?.();
  const hostGame = (): void => deconstructApi.hostGame?.();
  const joinGame = (): void => deconstructApi.joinGame?.();
  const hostStartNow = (): void => deconstructApi.hostStartNow?.();
  const onPickCard = (): void => deconstructApi.onPickCard?.();
  const onClear = (): void => deconstructApi.onClear?.();
  const onPass = (): void => deconstructApi.onPass?.();

  onMount(() => {
    void import("$lib/games/deconstruct/main");
  });
</script>

<svelte:head>
  <title>Deconstruct — LDJAM 59</title>
</svelte:head>

<canvas id="three-canvas" aria-label="Deconstruct 3D block-stacking game view"></canvas>

<div id="lobby">
  <div class="lobby-box">
    <h1>DECONSTRUCT</h1>
    <div class="subtitle">Tune. Decode. Intercept. &mdash; 1-6 operators</div>
    <div id="lobby-menu">
      <div class="lobby-btns">
        <button onclick={soloGame}>SOLO vs CPU</button>
        <div class="or-divider">&mdash; multiplayer &mdash;</div>
        <button onclick={hostGame}>OPEN CHANNEL</button>
        <div class="or-divider" style="opacity:0.3;font-size:12px;">&mdash; or &mdash;</div>
        <label for="join-code">Frequency ID (room code)</label>
        <input
          id="join-code"
          maxlength="6"
          placeholder="FREQ ID"
          spellcheck="false"
          autocomplete="off"
        />
        <button onclick={joinGame}>TUNE IN</button>
      </div>
    </div>
    <div id="lobby-waiting" style="display:none;">
      <div style="opacity:0.6;">Share this frequency ID:</div>
      <div class="room-code-display" id="room-code-show"></div>
      <div class="player-list" id="player-list"></div>
      <button id="start-btn" style="margin-top:14px;" onclick={hostStartNow}
        >BEGIN TRANSMISSION</button
      >
      <div class="lobby-status" id="lobby-status">Awaiting operators&hellip;</div>
    </div>
    <div id="lobby-joining" style="display:none;">
      <div class="lobby-status" id="join-status">Acquiring signal&hellip;</div>
    </div>
  </div>
</div>

<div id="ui-overlay" class="hidden">
  <div class="score-bar">
    <div class="title">// DECONSTRUCT</div>
    <div id="score-chips"></div>
  </div>
  <div id="hint">
    Drag to rotate &bull; Scroll to zoom &bull; Click top blocks to select &bull; Cycle <span
      id="round-num">1</span
    >/10
  </div>
  <div id="log-panel" aria-live="polite"></div>
  <div id="msg-bar" class="msg-bar" aria-live="assertive"></div>
  <div id="wait-banner" class="hidden">// Awaiting other operators&hellip;</div>
  <div id="side-panel">
    <div id="player-hand" class="hand"></div>
    <div class="btn-group">
      <button id="resolve-btn" disabled onclick={onPickCard}>TRANSMIT</button>
      <button class="btn-secondary" onclick={onClear}>CLEAR</button>
      <button class="btn-secondary" onclick={onPass}>HOLD</button>
    </div>
  </div>
</div>
