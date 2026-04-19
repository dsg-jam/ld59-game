<script lang="ts">
  import "$lib/styles/base.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Major+Mono+Display&family=JetBrains+Mono:wght@300;400;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
