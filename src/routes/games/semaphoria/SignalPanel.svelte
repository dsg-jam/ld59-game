<script lang="ts">
  import { SIGNAL_REFERENCE } from "$lib/semaphoria/signals";
  import type { SignalCommand } from "$lib/semaphoria/signals";

  let {
    onSignal,
    cooldown = 0,
    disabled = false,
  }: {
    onSignal: (command: SignalCommand) => void;
    cooldown: number;
    disabled?: boolean;
  } = $props();

  const COLOR_CSS: Record<string, string> = {
    white: "#ffffff",
    red: "#ff3333",
    green: "#44ff88",
    yellow: "#ffdd00",
  };

  const DIRECTION_ENTRIES = SIGNAL_REFERENCE.filter((e) =>
    (["go", "left", "right", "stop", "reverse"] as readonly string[]).includes(e.command)
  );
  const HAZARD_ENTRIES = SIGNAL_REFERENCE.filter((e) =>
    (["rocks-ahead", "rocks-left", "rocks-right"] as readonly string[]).includes(e.command)
  );

  const canSend = $derived(!disabled && cooldown <= 0);

  function handleKey(e: KeyboardEvent): void {
    if (!canSend) return;
    const keys: Record<string, SignalCommand> = {
      "1": "go",
      "2": "left",
      "3": "right",
      "4": "stop",
      "5": "reverse",
      "6": "rocks-ahead",
      "7": "rocks-left",
      "8": "rocks-right",
    };
    const cmd = keys[e.key];
    if (cmd) {
      e.preventDefault();
      onSignal(cmd);
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="signal-panel" aria-label="Signal panel">
  <div class="section-label">NAVIGATION</div>
  <div class="signal-grid nav-grid">
    {#each DIRECTION_ENTRIES as entry, i (entry.command)}
      <button
        class="sig-btn"
        aria-label="Send signal: {entry.label}"
        disabled={!canSend}
        onclick={() => onSignal(entry.command)}
        title="{entry.description} [key: {i + 1}]"
      >
        <span class="btn-pattern">
          {#each entry.pattern as flash, j (j)}
            <span class="pip {flash.type}" style:background={COLOR_CSS[flash.color] ?? "#fff"}
            ></span>
          {/each}
        </span>
        <span class="btn-label">{entry.label}</span>
        <span class="btn-key">{i + 1}</span>
      </button>
    {/each}
  </div>

  <div class="section-label" style="margin-top: 10px;">HAZARDS</div>
  <div class="signal-grid hazard-grid">
    {#each HAZARD_ENTRIES as entry, i (entry.command)}
      <button
        class="sig-btn hazard"
        aria-label="Send signal: {entry.label}"
        disabled={!canSend}
        onclick={() => onSignal(entry.command)}
        title="{entry.description} [key: {i + 6}]"
      >
        <span class="btn-pattern">
          {#each entry.pattern as flash, j (j)}
            <span class="pip {flash.type}" style:background={COLOR_CSS[flash.color] ?? "#fff"}
            ></span>
          {/each}
        </span>
        <span class="btn-label">{entry.label}</span>
        <span class="btn-key">{i + 6}</span>
      </button>
    {/each}
  </div>

  {#if cooldown > 0}
    <div class="cooldown-bar">
      <div class="cooldown-fill" style:width="{Math.min(100, (cooldown / 2.5) * 100)}%"></div>
      <span class="cooldown-label">COOLDOWN {cooldown.toFixed(1)}s</span>
    </div>
  {/if}
</div>

<style>
  .signal-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: inherit;
  }
  .section-label {
    font-size: 9px;
    letter-spacing: 0.15em;
    opacity: 0.5;
  }
  .signal-grid {
    display: grid;
    gap: 5px;
  }
  .nav-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .hazard-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .sig-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: inherit;
    font-family: inherit;
    font-size: 9px;
    letter-spacing: 0.08em;
    cursor: pointer;
    border-radius: 2px;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .sig-btn:hover:not(:disabled) {
    background: rgba(100, 180, 255, 0.15);
    border-color: rgba(100, 180, 255, 0.4);
  }
  .sig-btn.hazard {
    border-color: rgba(255, 80, 80, 0.2);
  }
  .sig-btn.hazard:hover:not(:disabled) {
    background: rgba(255, 80, 80, 0.12);
    border-color: rgba(255, 80, 80, 0.5);
  }
  .sig-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .btn-pattern {
    display: flex;
    gap: 2px;
    align-items: center;
    min-height: 10px;
  }
  .pip {
    display: inline-block;
    height: 8px;
    border-radius: 2px;
  }
  .pip.dot {
    width: 6px;
  }
  .pip.dash {
    width: 14px;
  }
  .btn-label {
    font-size: 8px;
    opacity: 0.8;
    text-align: center;
    line-height: 1.2;
  }
  .btn-key {
    position: absolute;
    top: 3px;
    right: 4px;
    font-size: 7px;
    opacity: 0.35;
  }
  .cooldown-bar {
    position: relative;
    height: 18px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }
  .cooldown-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(100, 180, 255, 0.25);
    transition: width 0.1s linear;
  }
  .cooldown-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    letter-spacing: 0.1em;
    opacity: 0.7;
  }
</style>
