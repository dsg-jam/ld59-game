<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import "./style.css";

  type SignalGridMod = typeof import("$lib/games/signal-grid/main");
  let mod: SignalGridMod | null = null;

  onMount(async () => {
    mod = await import("$lib/games/signal-grid/main");
  });

  onDestroy(() => {
    mod?.destroy();
  });
</script>

<svelte:head>
  <title>SIGNAL // ldjam59</title>
</svelte:head>

<div class="signal-grid-page">
  <div id="crt">
    <div id="scanlines"></div>

    <header id="topbar">
      <div class="logo">
        <span class="glitch" data-text="SIGNAL">SIGNAL</span>
        <span class="sub">// ldjam59 // theme: SIGNAL</span>
      </div>
      <div class="hud">
        <div class="hud-item"><span class="k">LEVEL</span><span id="hud-level">01</span></div>
        <div class="hud-item"><span class="k">TICK</span><span id="hud-tick">000</span></div>
        <div class="hud-item"><span class="k">STATUS</span><span id="hud-status">IDLE</span></div>
      </div>
    </header>

    <main id="main">
      <aside id="left">
        <div class="panel">
          <h3>BRIEFING</h3>
          <div id="brief-title">—</div>
          <div id="brief-text">—</div>
        </div>

        <div class="panel">
          <h3>GOALS</h3>
          <ul id="goal-list"></ul>
        </div>

        <div class="panel">
          <h3>LEVELS</h3>
          <div id="level-list"></div>
        </div>
      </aside>

      <section id="center">
        <div id="board-wrap">
          <canvas id="board" width="640" height="640"></canvas>
          <div id="overlay"></div>
        </div>
        <div id="controls">
          <button id="btn-run" class="btn primary">▶ RUN</button>
          <button id="btn-step" class="btn">▷ STEP</button>
          <button id="btn-stop" class="btn">■ STOP</button>
          <button id="btn-reset" class="btn">↺ RESET</button>
          <button id="btn-clear" class="btn warn">⌫ CLEAR</button>
          <div class="spacer"></div>
          <div class="speed">
            <label for="speed">SPEED</label>
            <input id="speed" type="range" min="1" max="20" value="6" />
          </div>
        </div>
      </section>

      <aside id="right">
        <div class="panel">
          <h3>PARTS BIN</h3>
          <div id="palette"></div>
          <div class="hint">
            Click a part, then click the grid.<br />
            Right-click a pipe to cycle shape. Right-click a gate to delete.<br />
            Click a placed tile to configure.<br />
            <b>Hotkeys:</b> Space=run, S=step, R=reset, [/]=cycle shape, 1-6=pick part
          </div>
        </div>

        <div class="panel" id="inspector-panel">
          <h3>INSPECTOR</h3>
          <div id="inspector">
            <div class="hint">Click a placed gate to program it.</div>
          </div>
        </div>

        <div class="panel">
          <h3>SIGNAL LOG</h3>
          <div id="log"></div>
        </div>
      </aside>
    </main>

    <div id="dialog" class="hidden">
      <div class="dialog-inner">
        <div id="dialog-title">—</div>
        <div id="dialog-body">—</div>
        <button id="dialog-close" class="btn primary">CONTINUE</button>
      </div>
    </div>

    <div id="boot" class="boot">
      <pre id="boot-text"></pre>
    </div>
  </div>
</div>
