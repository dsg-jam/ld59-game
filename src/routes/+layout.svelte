<script lang="ts">
  import "normalize.css";
  import "@fontsource/jetbrains-mono/300.css";
  import "@fontsource/jetbrains-mono/400.css";
  import "@fontsource/jetbrains-mono/600.css";
  import "@fontsource/major-mono-display/400.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="app-shell">
  {@render children()}
</div>

<style>
  .app-shell {
    min-height: 100vh;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
</style>
