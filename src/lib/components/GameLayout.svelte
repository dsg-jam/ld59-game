<script lang="ts">
  export let title = "";
</script>

<div id="app-layout">
  <header>
    <h1>{title}</h1>
    <slot name="hud" />
  </header>
  <main>
    <slot />
  </main>
  <aside>
    <slot name="sidebar" />
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
