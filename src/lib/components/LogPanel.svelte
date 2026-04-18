<script lang="ts">
  let {
    entries = [],
    maxEntries = 20,
  }: {
    entries: { text: string; kind?: "ok" | "bad" | "" }[];
    maxEntries?: number;
  } = $props();
</script>

<div class="log">
  {#each entries.slice(0, maxEntries) as entry}
    <div class={entry.kind ?? ""}>{entry.text}</div>
  {/each}
</div>

<style>
  .log {
    max-height: 220px;
    overflow: auto;
    font-size: 12px;
  }
  .ok {
    color: #8dff9d;
  }
  .bad {
    color: #ffb36b;
  }
</style>
