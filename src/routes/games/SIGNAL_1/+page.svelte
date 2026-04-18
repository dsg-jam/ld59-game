<script lang="ts">
  import { onMount } from "svelte";
  import "./styles.css";

  onMount(() => {
    void import("./main");
  });
</script>

<svelte:head>
  <title>SIGNAL CROSS — LDJAM59</title>
</svelte:head>

<div class="scanlines"></div>

  <div id="title-screen" class="screen active">
    <div class="title-stack">
      <div class="signal-wave">
        <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <h1>SIGNAL<span class="cross">CROSS</span></h1>
      <p class="subtitle">Bell Exchange #47 &mdash; Night Shift</p>
      <p class="blurb">
        It&rsquo;s 1962. You&rsquo;re the switchboard operator.<br>
        Calls come in. You decide who talks to whom.<br>
        Try not to connect the Pope to a ghost.
      </p>
      <button id="start-btn" class="big-btn">PUNCH IN &#9654;</button>
      <p class="tip">click a caller, then click the recipient &middot; esc to skip dialogue</p>
    </div>
  </div>

  <div id="game-screen" class="screen">
    <header class="hud">
      <div class="hud-item">
        <span class="hud-label">SHIFT</span>
        <span id="level-num" class="hud-val">1</span>
      </div>
      <div class="hud-item wide">
        <span class="hud-label">TIME</span>
        <div class="timer-bar"><div id="timer-fill"></div></div>
      </div>
      <div class="hud-item">
        <span class="hud-label">ROUTED</span>
        <span id="score-val" class="hud-val">0</span>
      </div>
      <div class="hud-item">
        <span class="hud-label">CHAOS</span>
        <span id="chaos-val" class="hud-val">0</span>
      </div>
      <div class="hud-item">
        <span class="hud-label">SHIFT GOAL</span>
        <span id="goal-val" class="hud-val">0 / 0</span>
      </div>
    </header>

    <section class="call-queue">
      <div class="queue-label">INCOMING</div>
      <div id="queue" class="queue"></div>
    </section>

    <section class="switchboard">
      <div class="panel-label">EXCHANGE 47</div>
      <div id="board" class="board"></div>
      <div class="panel-screws">
        <div class="screw"></div><div class="screw"></div>
        <div class="screw"></div><div class="screw"></div>
      </div>
    </section>

    <div id="cable-layer"></div>

    <div id="dialogue" class="dialogue hidden">
      <div class="bubble">
        <div class="portraits">
          <div id="dlg-a" class="portrait"></div>
          <div class="bolt">&#9889;</div>
          <div id="dlg-b" class="portrait"></div>
        </div>
        <div id="dlg-lines" class="lines"></div>
        <button id="dlg-next" class="dlg-btn">NEXT &#9654;</button>
      </div>
    </div>

    <div id="floater-layer"></div>
  </div>

  <div id="end-screen" class="screen">
    <div class="title-stack">
      <h1 id="end-title">SHIFT OVER</h1>
      <p id="end-blurb" class="subtitle"></p>
      <div class="tally">
        <div><span class="hud-label">ROUTED CORRECTLY</span><span id="end-score">0</span></div>
        <div><span class="hud-label">CHAOS BONUS</span><span id="end-chaos">0</span></div>
        <div class="final"><span class="hud-label">TOTAL</span><span id="end-total">0</span></div>
      </div>
      <button id="next-btn" class="big-btn">NEXT SHIFT &#9654;</button>
      <button id="replay-btn" class="big-btn secondary">REPLAY SHIFT</button>
    </div>
  </div>

  <audio id="sfx-connect" preload="auto"></audio>
  <audio id="sfx-wrong" preload="auto"></audio>
  <audio id="sfx-ring" preload="auto"></audio>
