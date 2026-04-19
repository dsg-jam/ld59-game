<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="app-shell">
  {@render children()}
</div>

<style>
  @font-face {
    font-family: "JetBrains Mono";
    src: url("/fonts/JetBrainsMono-300.ttf") format("truetype");
    font-weight: 300;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "JetBrains Mono";
    src: url("/fonts/JetBrainsMono-400.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "JetBrains Mono";
    src: url("/fonts/JetBrainsMono-600.ttf") format("truetype");
    font-weight: 600;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "Major Mono Display";
    src: url("/fonts/MajorMonoDisplay-400.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }

  .app-shell {
    min-height: 100vh;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
</style>
