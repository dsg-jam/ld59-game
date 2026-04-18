<script lang="ts">
  export let entries: { text: string; kind?: "ok" | "bad" | "" }[] = [];
  export let maxEntries = 20;
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
