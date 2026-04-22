<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import "./style.css";
  import { SCALE_LABELS, describeRelay } from "$lib/dead-air-engine";
  import type {
    DeadAirControls,
    PlayerInfo,
    Phase,
    RoundInfo,
    RevealInfo,
  } from "$lib/games/dead-air/main";
  import {
    buildRoomShareUrl,
    clearRoomCodeFromUrl,
    copyToClipboard,
    readRoomCodeFromUrl,
  } from "$lib/room-url";

  // ── UI state ────────────────────────────────────────────────────────────────
  let phase = $state<Phase>("lobby");
  let roomCode = $state("");
  let roomWrapVisible = $state(false);
  let startEnabled = $state(false);
  let lobbyStatus = $state("");
  let joinCode = $state("");
  let playerName = $state(defaultName());
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let roster = $state<PlayerInfo[]>([]);
  let round = $state<RoundInfo | null>(null);
  let guess = $state<number[]>([]);
  let locked = $state(false);
  let previewRemaining = $state(0);
  let reveal = $state<RevealInfo | null>(null);
  let busy = $state(false);
  let selectedSlot = $state(0);

  interface LogEntry {
    id: number;
    text: string;
    kind: "info" | "good" | "bad";
  }
  let logSeq = 0;
  let logs = $state<LogEntry[]>([]);

  let controls: DeadAirControls | null = null;

  function defaultName(): string {
    return `OPERATIVE-${1 + Math.floor(Math.random() * 6)}`;
  }

  function flashCopyStatus(msg: string): void {
    copyStatus = msg;
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      copyStatus = "";
    }, 1600);
  }

  async function copyRoomCode(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(roomCode);
    flashCopyStatus(ok ? `Copied code ${roomCode}` : "Copy failed");
  }

  async function copyRoomLink(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(buildRoomShareUrl(roomCode));
    flashCopyStatus(ok ? "Copied invite link" : "Copy failed");
  }

  function onNameChange(): void {
    controls?.setName(playerName);
  }

  function onSelectSlot(slot: number): void {
    if (locked) return;
    selectedSlot = slot;
  }

  function onNoteButton(noteIdx: number): void {
    if (!round) return;
    if (locked) return;
    controls?.setGuessNote(selectedSlot, noteIdx);
    // Advance to next empty slot for fast entry.
    const next = (selectedSlot + 1) % round.melodyLength;
    selectedSlot = next;
  }

  function onClearSlot(slot: number): void {
    if (locked) return;
    controls?.setGuessNote(slot, null);
    selectedSlot = slot;
  }

  function canLock(): boolean {
    if (!round) return false;
    if (locked) return false;
    return guess.length === round.melodyLength && guess.every((v) => v >= 0);
  }

  function relayChipClass(kind: string): string {
    return `chip relay-${kind}`;
  }

  onMount(async () => {
    const mod = await import("$lib/games/dead-air/main");
    controls = mod.mount({
      onPhase(p) {
        phase = p;
        if (p === "lobby") reveal = null;
        if (p === "round") {
          reveal = null;
          selectedSlot = 0;
        }
      },
      onLobbyStatus(t) {
        lobbyStatus = t;
      },
      onRoomCode(c) {
        roomCode = c;
      },
      onRoomWrapVisible(v) {
        roomWrapVisible = v;
      },
      onStartEnabled(v) {
        startEnabled = v;
      },
      onRoster(next) {
        roster = next;
      },
      onRound(info) {
        round = info;
        guess = new Array(info.melodyLength).fill(-1);
        selectedSlot = 0;
      },
      onGuess(next) {
        guess = next.slice();
      },
      onLockState(v) {
        locked = v;
      },
      onPreviewRemaining(n) {
        previewRemaining = n;
      },
      onReveal(info) {
        reveal = info;
      },
      onLog(text, kind) {
        logSeq += 1;
        logs = [{ id: logSeq, text, kind: kind ?? "info" }, ...logs].slice(0, 20);
      },
      onBusy(v) {
        busy = v;
      },
    });

    const autoJoinCode = readRoomCodeFromUrl();
    if (autoJoinCode) {
      joinCode = autoJoinCode;
      controls.joinGame(autoJoinCode);
      clearRoomCodeFromUrl();
    }
  });

  onDestroy(() => {
    controls?.destroy();
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
  });
</script>

<svelte:head>
  <title>Dead Air – Telephone Audio Puzzle</title>
</svelte:head>

<div class="dead-air-page">
  {#if phase === "lobby" && !reveal}
    <div id="lobby">
      <div class="card">
        <h1 class="title">DEAD AIR</h1>
        <p class="sub">
          A short tune passes through a chain of broken relays. By the time it reaches you it's
          buried in noise. Your job: reconstruct the original melody, note by note.
        </p>

        <div class="how">
          <h3>HOW TO PLAY</h3>
          <ol>
            <li>Host opens a relay station (share the code to play co-op, or play solo).</li>
            <li>
              Press <b>PLAY TRANSMISSION</b> to hear the distorted signal — you can replay it as often
              as you want.
            </li>
            <li>Tap a slot, then tap a note on the keyboard to fill the melody.</li>
            <li><b>LOCK ANSWER</b> when you're sure. Everyone's reveal happens together.</li>
            <li>Each round adds another relay. How far can you trace the signal?</li>
          </ol>
        </div>

        <div class="stack">
          <label for="name">Callsign</label>
          <input id="name" maxlength="16" bind:value={playerName} onchange={onNameChange} />
        </div>

        <div class="row">
          <button id="host-btn" onclick={() => controls?.hostGame()}>OPEN STATION</button>
          <button
            id="join-btn"
            onclick={() => controls?.joinGame(joinCode.trim().toUpperCase())}
            disabled={!joinCode.trim()}
          >
            TUNE IN
          </button>
          <input id="join-code" maxlength="5" placeholder="ROOM CODE" bind:value={joinCode} />
        </div>

        {#if roomWrapVisible}
          <div class="room-wrap">
            <div class="row">
              <span class="dim">ROOM</span>
              <span id="room-code" class="room-code">{roomCode}</span>
            </div>
            <div class="row">
              <button type="button" onclick={copyRoomCode}>COPY CODE</button>
              <button type="button" onclick={copyRoomLink}>COPY LINK</button>
            </div>
            {#if copyStatus}
              <div class="copy-status" aria-live="polite">{copyStatus}</div>
            {/if}
            <div class="roster-list">
              {#each roster as p (p.id)}
                <div class="lp">
                  {p.name}{p.isYou ? " (you)" : ""}{p.isHost ? " · host" : ""}
                </div>
              {:else}
                <div class="lp dim">No operators connected.</div>
              {/each}
            </div>
            <button id="start-btn" onclick={() => controls?.startRound()} disabled={!startEnabled}>
              BEGIN TRANSMISSION
            </button>
          </div>
        {/if}
        <div id="lobby-status">{lobbyStatus}</div>
      </div>
    </div>
  {/if}

  {#if phase !== "lobby" || reveal}
    <div id="game">
      <div id="header">
        <div class="left">
          <h1>DEAD AIR</h1>
          {#if round}
            <span class="pill">ROUND {round.round + 1}</span>
            <span class="pill">LEN {round.melodyLength}</span>
            <span class="pill">RELAYS {round.relays.length}</span>
          {/if}
          {#if phase === "reveal"}
            <span class="pill" style="color:var(--accent);border-color:var(--accent)">REVEAL</span>
          {/if}
        </div>
        <div class="right">
          {#if phase === "reveal" && roster.find((p) => p.isHost && p.isYou)}
            <button onclick={() => controls?.nextRound()}>NEXT ROUND</button>
          {/if}
        </div>
      </div>

      <div id="main">
        <div id="stage">
          {#if round}
            <div class="panel relay-panel">
              <h3>TRANSMISSION CHAIN</h3>
              <div class="chain">
                <span class="chip chip-source">SOURCE</span>
                {#each round.relays as r, i (i)}
                  <span class="arrow">→</span>
                  <span class={relayChipClass(r.kind)} title={describeRelay(i, r)}>
                    {describeRelay(i, r)}
                  </span>
                {/each}
                <span class="arrow">→</span>
                <span class="chip chip-you">YOU</span>
              </div>
            </div>

            <div class="panel listen-panel">
              <h3>LISTEN</h3>
              <div class="row">
                <button
                  class="primary"
                  onclick={() => controls?.playDistorted()}
                  disabled={busy || phase === "reveal"}
                >
                  {busy ? "RENDERING..." : "▶ PLAY TRANSMISSION"}
                </button>
                <button
                  onclick={() => controls?.playCleanPreview()}
                  disabled={busy || previewRemaining <= 0 || phase === "reveal"}
                >
                  PREVIEW CLEAN · {previewRemaining}
                </button>
              </div>
              <p class="hint">
                You can replay the distorted transmission as many times as you need. A limited
                number of clean previews reveal the unprocessed signal.
              </p>
            </div>

            <div class="panel answer-panel">
              <h3>RECONSTRUCT</h3>
              <div class="slots">
                {#each guess as noteIdx, slot (slot)}
                  {@const isReveal = phase === "reveal" && reveal !== null}
                  {@const ok = isReveal && reveal && reveal.original[slot] === noteIdx}
                  <button
                    class="slot"
                    class:active={selectedSlot === slot && !locked}
                    class:filled={noteIdx >= 0}
                    class:good={isReveal && ok}
                    class:bad={isReveal && !ok}
                    disabled={locked || phase === "reveal"}
                    onclick={() => onSelectSlot(slot)}
                    ondblclick={() => onClearSlot(slot)}
                    title="Double-click to clear"
                    aria-label={`Slot ${slot + 1}`}
                  >
                    <div class="slot-idx">{slot + 1}</div>
                    <div class="slot-note">
                      {noteIdx >= 0 ? SCALE_LABELS[noteIdx] : "—"}
                    </div>
                  </button>
                {/each}
              </div>

              {#if phase === "round"}
                <div class="keys">
                  {#each SCALE_LABELS as label, idx (idx)}
                    <button
                      class="key"
                      disabled={locked}
                      onclick={() => onNoteButton(idx)}
                      aria-label={`Note ${label}`}
                    >
                      {label}
                    </button>
                  {/each}
                </div>

                <div class="row">
                  {#if !locked}
                    <button
                      class="primary"
                      onclick={() => controls?.lockAnswer()}
                      disabled={!canLock()}
                    >
                      LOCK ANSWER
                    </button>
                  {:else}
                    <button onclick={() => controls?.unlockAnswer()}>UNLOCK</button>
                    <span class="dim">Waiting for other operators...</span>
                  {/if}
                </div>
              {/if}

              {#if phase === "reveal" && reveal}
                <div class="reveal-block">
                  <h4>ORIGINAL SIGNAL</h4>
                  <div class="slots reveal-slots">
                    {#each reveal.original as note, i (i)}
                      <div class="slot filled good">
                        <div class="slot-idx">{i + 1}</div>
                        <div class="slot-note">{SCALE_LABELS[note]}</div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div id="sidebar">
          <div class="panel">
            <h3>OPERATORS</h3>
            <ul class="players">
              {#each roster as p (p.id)}
                <li class:you={p.isYou} class:locked-row={p.locked}>
                  <span>{p.name}{p.isYou ? " (you)" : ""}{p.isHost ? " · host" : ""}</span>
                  <span class="score">
                    {p.score}
                    {#if p.lastRoundAccuracy !== null}
                      <small class="dim">
                        ({Math.round(p.lastRoundAccuracy * 100)}%)
                      </small>
                    {/if}
                    {#if p.locked && phase === "round"}<span class="lock-dot">●</span>{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>

          {#if phase === "reveal" && reveal}
            <div class="panel">
              <h3>ROUND RESULTS</h3>
              {#each reveal.results as r (r.id)}
                <div class="result-row">
                  <div class="result-name">{r.name}</div>
                  <div class="result-guess">
                    {#each r.guess as n, i (i)}
                      <span
                        class="mini-note"
                        class:good={reveal.original[i] === n}
                        class:bad={reveal.original[i] !== n}
                      >
                        {n >= 0 ? SCALE_LABELS[n] : "—"}
                      </span>
                    {/each}
                  </div>
                  <div class="result-pct">{Math.round(r.accuracy * 100)}%</div>
                </div>
              {/each}
            </div>
          {/if}

          <div class="panel">
            <h3>LOG</h3>
            <div class="log">
              {#each logs as entry (entry.id)}
                <div class={entry.kind}>{entry.text}</div>
              {:else}
                <div class="dim">Idle.</div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
