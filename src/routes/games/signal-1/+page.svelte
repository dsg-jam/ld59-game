<script lang="ts">
  import { onMount } from "svelte";
  import "./styles.css";

  onMount(() => {
    void import("$lib/games/signal-1/game");
  });
</script>

<svelte:head>
  <title>SIGNAL CROSS — LDJAM59</title>
</svelte:head>

<div class="scanlines"></div>

<!-- ================= TITLE ================= -->
<div id="title-screen" class="screen active">
  <div class="title-stack">
    <div class="signal-wave">
      <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <h1>SIGNAL<span class="cross">CROSS</span></h1>
    <p class="subtitle">Bell Exchange #47 &mdash; Co-op Night Shift</p>
    <p class="blurb">
      1962. A switchboard. Co-op shift.<br />
      Each operator has 3 cables. Plug ringing callers into the right recipient,<br />
      <em>read</em> their conversation, and pull your cable only when they&rsquo;ve hung up.<br />
      Pull too early &mdash; the crew takes a penalty.
    </p>

    <label class="field">
      <span class="field-label">OPERATOR NAME</span>
      <input id="name-input" type="text" maxlength="14" placeholder="MARGE" />
    </label>

    <div class="button-row">
      <button id="host-btn" class="big-btn">HOST NEW SHIFT</button>
      <div class="divider"><span>OR</span></div>
      <label class="field inline">
        <span class="field-label">ROOM CODE</span>
        <input id="room-input" type="text" maxlength="12" placeholder="SIG-XXXX" autocomplete="off" />
      </label>
      <button id="join-btn" class="big-btn secondary">JOIN</button>
    </div>

    <p id="net-status" class="net-status"></p>
    <p class="tip">click caller, then recipient · click a live plug or cable to disconnect · esc releases a held plug</p>
  </div>
</div>

<!-- ================= LOBBY ================= -->
<div id="lobby-screen" class="screen">
  <div class="title-stack lobby-stack">
    <h2 class="lobby-title">READY ROOM</h2>
    <div class="room-code-wrap">
      <span class="hud-label">SHARE THIS CODE</span>
      <div id="room-code" class="room-code">...</div>
      <button id="copy-btn" class="mini-btn">COPY</button>
    </div>

    <div class="panel-head">OPERATORS ON DUTY</div>
    <div id="lobby-players" class="lobby-players"></div>

    <div class="mode-picker">
      <span class="hud-label">SHIFT MODE</span>
      <div class="mode-buttons">
        <button class="mode-btn host-only active" data-mode="classic" id="mode-classic">CLASSIC</button>
        <button class="mode-btn host-only" data-mode="verify" id="mode-verify">VERIFY CARDS</button>
        <button class="mode-btn host-only" data-mode="supervisor" id="mode-supervisor">SUPERVISOR</button>
      </div>
      <div id="mode-desc" class="mode-desc">Classic switchboard. Ring → patch → hang up.</div>
      <div id="supervisor-pick" class="supervisor-pick" style="display:none">
        <span class="hud-label">SUPERVISOR</span>
        <select id="supervisor-select" class="sv-select host-only"></select>
      </div>
    </div>

    <button id="lobby-start-btn" class="big-btn host-only">START SHIFT ▸</button>
    <div id="lobby-wait" class="lobby-wait">Waiting for host to begin...</div>
    <button id="lobby-leave-btn" class="mini-btn">LEAVE</button>
  </div>
</div>

<!-- ================= GAME ================= -->
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
      <span id="correct-val" class="hud-val">0 / 0</span>
    </div>
    <div class="hud-item">
      <span class="hud-label">TEAM</span>
      <span id="team-score" class="hud-val">0</span>
    </div>
    <div class="hud-item">
      <span class="hud-label">PENALTY</span>
      <span id="team-pen" class="hud-val penalty">0</span>
    </div>
    <div class="hud-item">
      <span class="hud-label">CABLES</span>
      <span id="cables-free" class="hud-val">0 / 0</span>
    </div>
    <div class="hud-item">
      <span class="hud-label">ROOM</span>
      <span id="hud-room" class="hud-val small">---</span>
    </div>
    <div class="hud-item" id="hud-mode-wrap">
      <span class="hud-label">MODE</span>
      <span id="hud-mode" class="hud-val small">CLASSIC</span>
    </div>
  </header>

  <section class="switchboard">
    <div class="panel-label">EXCHANGE 47</div>
    <div id="board" class="board"></div>
    <div class="panel-screws">
      <div class="screw"></div><div class="screw"></div>
      <div class="screw"></div><div class="screw"></div>
    </div>
  </section>

  <aside class="side-panel">
    <div class="panel panel-queue">
      <div class="panel-head">INCOMING</div>
      <div id="queue" class="queue-vertical"></div>
    </div>

    <div class="panel panel-ops">
      <div class="panel-head">OPERATORS</div>
      <div id="operators" class="operators"></div>
    </div>

    <div class="panel panel-log">
      <div class="panel-head">CALL LOG</div>
      <div id="log" class="log"></div>
    </div>
  </aside>

  <div id="cable-layer"></div>
  <div id="floater-layer"></div>
  <div id="toast" class="toast hidden"></div>

  <!-- Slip modal: verify mode (player reviews own pickup) + supervisor mode (supervisor stamps) -->
  <div id="slip-modal" class="slip-modal hidden">
    <div class="slip">
      <div class="slip-head">
        <span>CALL SLIP</span>
        <span id="slip-num">#000</span>
      </div>
      <div class="slip-body">
        <div class="slip-row"><span class="slip-k">CALLER</span><b id="slip-caller">—</b></div>
        <div class="slip-row"><span class="slip-k">LINE</span><b id="slip-line">—</b></div>
        <div class="slip-row"><span class="slip-k">REQUESTS</span><b id="slip-req">—</b></div>
        <div id="slip-flag" class="slip-flag" style="display:none">⚠ FLAGGED LINE</div>
        <div id="slip-hint" class="slip-hint"></div>
      </div>
      <div class="slip-actions">
        <button id="slip-approve" class="big-btn">APPROVE ▸</button>
        <button id="slip-deny" class="big-btn secondary">DENY ✖</button>
      </div>
      <button id="slip-cancel" class="mini-btn">CANCEL</button>
    </div>
  </div>

  <!-- Agency interrogation modal -->
  <div id="agency-modal" class="agency-modal hidden">
    <div class="dossier">
      <div class="dossier-head">
        <span class="dossier-tag">🕴 THE AGENCY</span>
        <span class="dossier-sub">ENCRYPTED — ANSWER CAREFULLY</span>
      </div>
      <div id="agency-q" class="agency-q">—</div>
      <div id="agency-choices" class="agency-choices"></div>
      <div class="agency-timer"><div id="agency-timer-fill"></div></div>
    </div>
  </div>
</div>

<!-- ================= END ================= -->
<div id="end-screen" class="screen">
  <div class="title-stack">
    <h1 id="end-title">SHIFT OVER</h1>
    <p id="end-blurb" class="subtitle"></p>
    <div class="panel-head">CREW TOTALS</div>
    <div id="leaderboard" class="leaderboard"></div>
    <div class="button-row tight">
      <button id="next-btn" class="big-btn host-only">NEXT SHIFT ▸</button>
      <button id="replay-btn" class="big-btn secondary host-only">REPLAY</button>
    </div>
    <div id="end-wait" class="lobby-wait">Waiting for host...</div>
    <button id="end-leave-btn" class="mini-btn">LEAVE ROOM</button>
  </div>
</div>
