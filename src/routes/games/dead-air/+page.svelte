<script lang="ts">
  import { onMount } from "svelte";
  import "./style.css";

  onMount(() => {
    void import("./main.js");
  });
</script>

<svelte:head>
  <title>Dead Air</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Major+Mono+Display&family=JetBrains+Mono:wght@300;400;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div id="lobby">
  <div class="card">
    <div>
      <h1 class="title">DEAD AIR</h1>
      <p class="sub">Arctic relay station. One voice among you is no longer human.</p>
    </div>
    <div class="stack">
      <label for="name">Callsign</label>
      <input id="name" maxlength="16" />
    </div>

    <div class="stack">
      <div class="row">
        <button id="host-btn">HOST</button>
        <button id="join-btn">JOIN</button>
      </div>
      <div class="row">
        <input id="join-code" maxlength="5" placeholder="ROOM CODE" />
      </div>
      <div class="row" id="room-wrap" style="display:none">
        <span>ROOM:</span><span id="room-code">-----</span>
      </div>
      <div id="lobby-status"></div>
    </div>

    <div class="stack">
      <div class="panel">
        <h3>PLAYERS</h3>
        <div id="lobby-players"></div>
        <div class="row" style="margin-top:8px">
          <button id="start-btn" disabled>BEGIN TRANSMISSION</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="game">
  <div id="header">
    <div class="left">
      <h1>DEAD AIR</h1>
      <span class="pill" id="status-pill">LOBBY</span>
      <span class="pill" id="role-pill">ROLE: ???</span>
      <span class="pill" id="cooldown-pill">ELIM: READY</span>
    </div>
    <div class="right">
      <button id="call-vote">CALL VOTE</button>
      <div id="net-dot" title="network"></div>
    </div>
  </div>
  <div id="main">
    <div id="map-wrap">
      <canvas id="map"></canvas>
      <div id="hud">WASD / Arrow keys to move. Stay in the light.</div>
    </div>
    <div id="sidebar">
      <div class="panel">
        <h3>PLAYERS</h3>
        <ul id="players" class="players"></ul>
      </div>

      <div class="panel">
        <h3>TOWERS</h3>
        <div id="towers"></div>
      </div>

      <div class="panel" id="vote-box">
        <h3>EMERGENCY VOTE</h3>
        <div id="vote-timer"></div>
        <div id="vote-list"></div>
      </div>

      <div class="panel" id="mimic-panel">
        <h3>CAPTURED SIGNALS</h3>
        <div id="capture-list"></div>
        <div id="snippet-list"></div>
        <button class="danger" id="elim-btn" style="width:100%;margin-top:6px">[ELIMINATE]</button>
      </div>

      <div id="warn"></div>
    </div>
  </div>
</div>

<div id="end">
  <div class="inner">
    <h2 id="end-title" aria-live="polite"></h2>
    <p id="end-sub"></p>
    <ul id="reveal"></ul>
    <button id="play-again">PLAY AGAIN</button>
  </div>
</div>
