<script lang="ts">
  export let title: string;
  export let subtitle = "";
  export let onHost: () => void;
  export let onJoin: (code: string) => void;
  export let players: string[] = [];
  export let roomCode = "";
  export let canStart = false;
  export let onStart: () => void;
  export let status = "";

  let joinCode = "";
</script>

<div class="lobby">
  <h1>{title}</h1>
  {#if subtitle}<p>{subtitle}</p>{/if}
  <button on:click={onHost}>OPEN CHANNEL</button>
  <div class="or">— or —</div>
  <input bind:value={joinCode} maxlength="6" placeholder="ROOM CODE" />
  <button on:click={() => onJoin(joinCode)}>TUNE IN</button>
  {#if roomCode}
    <p>Share this code:</p>
    <div class="room">{roomCode}</div>
    {#if players.length}
      <div class="players">
        {#each players as player}
          <div>{player}</div>
        {/each}
      </div>
    {/if}
    <button disabled={!canStart} on:click={onStart}>START</button>
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
