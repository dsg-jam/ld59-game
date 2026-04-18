<script lang="ts">
  import { onMount } from "svelte";
  import "./style.css";

  onMount(() => {
    void import("./main");
  });
</script>

<svelte:head>
  <title>Signal Cascade — LDJAM 59</title>
</svelte:head>

<div id="waiting">
  <div class="spin"></div>
  <div>Scanning for carrier… awaiting host.</div>
  <small id="waitingInfo"></small>
</div>
<div id="app">
  <header>
    <h1>SIGNAL CASCADE</h1>
    <div class="stat">Cycle <b id="round">1</b>/10</div>
    <div id="scores" style="display:flex;gap:6px;"></div>
    <input id="pname" placeholder="Operator" value="OP-1" style="background:#0f1622;color:var(--fg);border:1px solid #1c2a3a;border-radius:4px;padding:6px 8px;width:110px;font:inherit;">
    <button id="newgame">Solo vs CPU</button>
    <button id="host">Host</button>
    <button id="startmp">Start</button>
    <button id="join">Join…</button>
    <span id="netStatus" style="opacity:.7"></span>
    <button id="topview">Top View</button>
    <span style="opacity:.6">Drag = orbit · Right-drag = pan · Scroll = zoom · Click signal to capture</span>
  </header>
  <div id="canvas-wrap"><div id="hud">Capture top signal packets matching your filter pattern + frequency.</div></div>
  <div id="sidebar">
    <div class="panel">
      <h3>Decode Filters</h3>
      <div id="hand"></div>
      <div style="margin-top:6px;">
        <button id="confirm">Transmit</button>
        <button id="pass">Hold</button>
        <button id="clear">Clear</button>
      </div>
      <div class="msg" id="msg"></div>
    </div>
    <div class="panel">
      <h3>Protocol</h3>
      <p style="margin:4px 0">The cascade broadcasts colored packets — top of each stack is live. Pick a filter (TX delay: low = first to air, high = high payload). Tag the live packets matching your filter's pattern &amp; frequency. All operators transmit at once; lowest delay airs first and can <b style="color:var(--warn)">jam</b> slower signals. Captured packets cascade — new ones surface beneath.</p>
    </div>
    <div class="panel"><h3>Comms Log</h3><div id="log"></div></div>
  </div>
</div>
