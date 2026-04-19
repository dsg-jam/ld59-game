<script lang="ts">
  let {
    seconds,
    warningThreshold = 30,
    dangerThreshold = 10,
    label = "TIME",
  }: {
    seconds: number;
    warningThreshold?: number;
    dangerThreshold?: number;
    label?: string;
  } = $props();

  const pad = (n: number): string => String(Math.floor(n)).padStart(2, "0");

  const display = $derived(`${pad(seconds / 60)}:${pad(seconds % 60)}`);

  const urgency = $derived(
    seconds <= dangerThreshold ? "danger" : seconds <= warningThreshold ? "warning" : "normal"
  );
</script>

<div class="timer" class:warning={urgency === "warning"} class:danger={urgency === "danger"}>
  <span class="label">{label}</span>
  <span class="value" aria-live="polite" aria-label="{label} {Math.floor(seconds)} seconds"
    >{display}</span
  >
</div>

<style>
  .timer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-family: inherit;
  }
  .label {
    font-size: 10px;
    opacity: 0.6;
    letter-spacing: 0.15em;
  }
  .value {
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    transition: color 0.3s;
  }
  .warning .value {
    color: #ffdd00;
  }
  .danger .value {
    color: #ff4444;
    animation: pulse 0.8s infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
