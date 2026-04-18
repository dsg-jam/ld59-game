<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title = "",
    hud,
    children,
    sidebar,
  }: {
    title?: string;
    hud?: Snippet;
    children?: Snippet;
    sidebar?: Snippet;
  } = $props();
</script>

<div id="app-layout">
  <header>
    <h1>{title}</h1>
    {@render hud?.()}
  </header>
  <main>
    {@render children?.()}
  </main>
  <aside>
    {@render sidebar?.()}
  </aside>
</div>

<style>
  #app-layout {
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }
  header {
    grid-column: 1 / 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }
  main {
    min-height: 0;
  }
  aside {
    border-left: 1px solid rgba(255, 255, 255, 0.15);
    padding: 10px;
    overflow: auto;
  }
</style>
