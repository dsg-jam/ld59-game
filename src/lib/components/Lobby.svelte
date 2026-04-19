<script lang="ts">
  let {
    title,
    subtitle = "",
    onHost,
    onJoin,
    players = [],
    roomCode = "",
    canStart = false,
    onStart,
    status = "",
  }: {
    title: string;
    subtitle?: string;
    onHost: () => void;
    onJoin: (code: string) => void;
    players?: string[];
    roomCode?: string;
    canStart?: boolean;
    onStart: () => void;
    status?: string;
  } = $props();

  let joinCode = $state("");
</script>

<div class="lobby">
  <h1>{title}</h1>
  {#if subtitle}<p>{subtitle}</p>{/if}
  <button onclick={onHost}>OPEN CHANNEL</button>
  <div class="or">— or —</div>
  <input bind:value={joinCode} maxlength="6" placeholder="ROOM CODE" />
  <button onclick={() => onJoin(joinCode)}>TUNE IN</button>
  {#if roomCode}
    <p>Share this code:</p>
    <div class="room">{roomCode}</div>
    {#if players.length}
      <div class="players">
        {#each players as player (player)}
          <div>{player}</div>
        {/each}
      </div>
    {/if}
    <button disabled={!canStart} onclick={onStart}>START</button>
  {/if}
  {#if status}<p class="status">{status}</p>{/if}
</div>

<style>
  .lobby {
    display: grid;
    gap: 8px;
  }
  .or {
    opacity: 0.7;
    text-align: center;
  }
  .room {
    letter-spacing: 0.2em;
    font-weight: 700;
  }
</style>
