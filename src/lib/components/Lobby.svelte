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
  <button id="lobby-host-btn" onclick={onHost}>OPEN CHANNEL</button>
  <div class="or">— or —</div>
  <label for="lobby-join-code">Room code</label>
  <input id="lobby-join-code" bind:value={joinCode} maxlength="6" placeholder="ROOM CODE" />
  <button id="lobby-join-btn" onclick={() => onJoin(joinCode)}>TUNE IN</button>
  {#if roomCode}
    <p>Share this code:</p>
    <div id="lobby-room-code" class="room">{roomCode}</div>
    {#if players.length}
      <div id="lobby-players" class="players">
        {#each players as player (player)}
          <div>{player}</div>
        {/each}
      </div>
    {/if}
    <button id="lobby-start-btn" disabled={!canStart} onclick={onStart}>START</button>
  {/if}
  <p id="lobby-status" class="status">{status}</p>
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
