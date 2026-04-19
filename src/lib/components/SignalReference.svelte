<script lang="ts">
  import type { SignalRefEntry } from "$lib/semaphoria/signals";

  let {
    entries,
    compact = false,
  }: {
    entries: readonly SignalRefEntry[];
    compact?: boolean;
  } = $props();

  const COLOR_CSS: Record<string, string> = {
    white: "#ffffff",
    red: "#ff3333",
    green: "#44ff88",
    yellow: "#ffdd00",
  };
</script>

<div class="signal-ref" class:compact>
  <div class="ref-title">SIGNAL REFERENCE</div>
  <div class="ref-list">
    {#each entries as entry (entry.command)}
      <div class="ref-row">
        <div class="pattern" aria-label="{entry.label} pattern">
          {#each entry.pattern as flash, i (i)}
            <span
              class="flash {flash.type}"
              style:background={COLOR_CSS[flash.color] ?? "#fff"}
              title="{flash.type} – {flash.color}"
            ></span>
          {/each}
        </div>
        <div class="info">
          <span class="cmd-label">{entry.label}</span>
          {#if !compact}
            <span class="cmd-desc">{entry.description}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .signal-ref {
    font-family: inherit;
    font-size: 12px;
  }
  .ref-title {
    font-size: 10px;
    letter-spacing: 0.15em;
    opacity: 0.6;
    margin-bottom: 8px;
  }
  .ref-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ref-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pattern {
    display: flex;
    gap: 3px;
    align-items: center;
    min-width: 60px;
  }
  .flash {
    display: inline-block;
    height: 10px;
    border-radius: 3px;
  }
  .flash.dot {
    width: 8px;
  }
  .flash.dash {
    width: 20px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cmd-label {
    font-weight: 600;
    letter-spacing: 0.08em;
  }
  .cmd-desc {
    opacity: 0.65;
    font-size: 10px;
  }
  .compact .ref-row {
    gap: 6px;
  }
  .compact .cmd-label {
    font-size: 11px;
  }
</style>
