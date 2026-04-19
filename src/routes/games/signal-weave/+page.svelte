<script lang="ts">
  import { onMount } from "svelte";
  import "./style.css";

  onMount(() => {
    void import("$lib/games/signal-weave/main");
  });
</script>

<svelte:head>
  <title>Signal Weave – Multiplayer Waveform Game</title>
</svelte:head>

<div id="lobby">
  <div class="card">
    <h1>SIGNAL WEAVE</h1>
    <p>Two operators shape one impossible waveform.</p>
    <p>Match the target signal and fire synchronized pulses.</p>
    <div class="row" style="margin-top:10px">
      <button id="host-btn">OPEN CHANNEL</button>
    </div>
    <div style="margin:10px 0;color:var(--dim)">— or —</div>
    <input id="join-code" maxlength="6" placeholder="ROOM CODE" />
    <div class="row" style="margin-top:8px">
      <button id="join-btn">TUNE IN</button>
    </div>
    <div id="room-wrap" style="display:none">
      <p style="margin-top:10px">Share this code:</p>
      <div class="room" id="room-code">-----</div>
      <button id="start-btn" disabled>BEGIN WEAVE</button>
    </div>
    <p id="lobby-status"></p>
  </div>
</div>

<div id="app">
  <div id="stage">
    <canvas id="canvas" width="1200" height="800"></canvas>
    <div class="hud">
      <div class="chip">TIME <b id="time">90.0</b></div>
      <div class="chip">HARMONY <b id="harmony">0.0</b></div>
      <div class="chip">COMBO <b id="combo">x0</b></div>
      <div class="chip">YOU <b id="slot">--</b></div>
    </div>
    <div id="flash"></div>
  </div>
  <div id="sidebar">
    <div class="panel">
      <h3>CONTROL</h3>
      <div>PHASE OFFSET</div>
      <input id="offset" type="range" value="0" />
      <div id="offset-label">0.00 rad</div>
      <div class="row" style="margin-top:8px">
        <button id="pulse-btn">TRANSMIT PULSE [SPACE]</button>
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
      <div id="status">Idle.</div>
    </div>
    <div class="panel">
      <h3>LOG</h3>
      <div id="log"></div>
    </div>
  </div>
</div>
