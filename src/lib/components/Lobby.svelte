<script lang="ts">
  import { buildRoomShareUrl, copyToClipboard } from "$lib/room-url";

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
    initialJoinCode = "",
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
    initialJoinCode?: string;
  } = $props();

  let joinCode = $state("");
  let copyStatus = $state("");
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let seededAutoJoin = false;
  $effect(() => {
    if (!seededAutoJoin && initialJoinCode) {
      joinCode = initialJoinCode;
      seededAutoJoin = true;
    }
  });

  function flashCopyStatus(msg: string): void {
    copyStatus = msg;
    if (copyStatusTimer !== undefined) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      copyStatus = "";
    }, 1600);
  }

  async function copyRoomCode(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(roomCode);
    flashCopyStatus(ok ? `Copied ${roomCode}` : "Copy failed");
  }

  async function copyRoomLink(): Promise<void> {
    if (!roomCode) return;
    const ok = await copyToClipboard(buildRoomShareUrl(roomCode));
    flashCopyStatus(ok ? "Copied invite link" : "Copy failed");
  }
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
    <div class="share-row">
      <button id="lobby-copy-code-btn" type="button" onclick={copyRoomCode}>Copy code</button>
      <button id="lobby-copy-link-btn" type="button" onclick={copyRoomLink}>Copy link</button>
    </div>
    {#if copyStatus}
      <p class="copy-status" role="status" aria-live="polite">{copyStatus}</p>
    {/if}
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
  .share-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .copy-status {
    margin: 0;
    font-size: 12px;
    opacity: 0.85;
  }
</style>
