<script lang="ts">
  import { onDestroy } from "svelte";
  import { resolve } from "$app/paths";
  import { games } from "$lib/games";
  import "./index.css";

  const clockPad = (n: number): string => String(n).padStart(2, "0");

  let clock = "--:--:--";
  const timer = setInterval(() => {
    const d = new Date();
    clock = `${clockPad(d.getHours())}:${clockPad(d.getMinutes())}:${clockPad(d.getSeconds())}`;
  }, 1000);

  (() => {
    const d = new Date();
    clock = `${clockPad(d.getHours())}:${clockPad(d.getMinutes())}:${clockPad(d.getSeconds())}`;
  })();

  onDestroy(() => {
    clearInterval(timer);
  });
</script>

<svelte:head>
  <title>ARCADE // INDEX</title>
</svelte:head>

<div class="index-page">
  <div class="frame">
    <header>
      <h1 class="brand">arc<span class="accent">a</span>de<br />index</h1>
      <div class="status">
        <span><span class="dot"></span>ONLINE</span>
        <span>{clock}</span>
      </div>
    </header>

    <section class="intro">
      <span class="label">// readme</span>
      A local collection of browser games. Pick a cartridge, press start.
    </section>

    <div class="section-head">
      <span>Library</span>
      <span class="line"></span>
      <span class="count">{String(games.length).padStart(2, "0")}</span>
    </div>

    <div class="games">
      {#each games as game, index (game.id)}
        <a class="game" href={resolve(game.path)} aria-label={game.title}>
          <div class="game-top">
            <span class="game-num">{String(index + 1).padStart(2, "0")}</span>
            <span class="arrow">↗</span>
          </div>
          <div class="game-body">
            <div class="title">{game.title}</div>
            {#if game.description}
              <div class="desc">{game.description}</div>
            {/if}
            <span class="tag">{game.tag}</span>
          </div>
        </a>
      {/each}
    </div>

    <footer>
      <span>Powered by DSG Jam</span>
      <span>READY<span class="cursor"></span></span>
    </footer>
  </div>
</div>
