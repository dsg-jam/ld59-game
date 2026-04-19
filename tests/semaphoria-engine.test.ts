/**
 * Semaphoria – engine unit tests.
 *
 * These tests exercise the pure game state machine in isolation.
 * No browser / DOM / Three.js dependency required.
 */
import { test, expect } from "@playwright/test";
import {
  createInitialState,
  startCountdown,
  tick,
  sendSignal,
  getCurrentFlashColor,
  deriveStats,
} from "../src/lib/semaphoria/engine";
import type { CaptainInput, GameState } from "../src/lib/semaphoria/engine";
import { DIFFICULTY_CONFIG } from "../src/lib/semaphoria/constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_INPUT: CaptainInput = { turning: "none", moving: false };

function makeState(difficulty: 0 | 1 | 2 = 0): GameState {
  return createInitialState(42, difficulty);
}

function makePlayingState(difficulty: 0 | 1 | 2 = 0): GameState {
  let s = makeState(difficulty);
  s = startCountdown(s);
  // Skip the countdown
  s = tick(s, 10, NO_INPUT, null);
  expect(s.phase).toBe("playing");
  return s;
}

// ── Phase transitions ─────────────────────────────────────────────────────────

test.describe("Semaphoria engine – phase transitions", () => {
  test("initial state is 'lobby'", () => {
    const s = makeState();
    expect(s.phase).toBe("lobby");
  });

  test("startCountdown transitions lobby → countdown", () => {
    const s = makeState();
    const after = startCountdown(s);
    expect(after.phase).toBe("countdown");
  });

  test("startCountdown is idempotent in non-lobby phases", () => {
    const s = startCountdown(makeState());
    const again = startCountdown(s);
    expect(again).toBe(s); // same reference
  });

  test("tick advances countdown and transitions to playing", () => {
    let s = startCountdown(makeState());
    expect(s.phase).toBe("countdown");
    s = tick(s, 10, NO_INPUT, null);
    expect(s.phase).toBe("playing");
  });

  test("tick in non-playing phase does not change phase", () => {
    const s = makeState();
    const after = tick(s, 1, NO_INPUT, null);
    expect(after.phase).toBe("lobby");
  });
});

// ── Timer ─────────────────────────────────────────────────────────────────────

test.describe("Semaphoria engine – timer", () => {
  test("timer decrements in playing phase", () => {
    let s = makePlayingState();
    const before = s.timeRemaining;
    s = tick(s, 1, NO_INPUT, null);
    expect(s.timeRemaining).toBeLessThan(before);
  });

  test("timer expiry triggers failure", () => {
    let s = makePlayingState();
    // Advance way past the timer
    s = tick(s, 10000, NO_INPUT, null);
    expect(s.phase).toBe("failure");
  });

  test("timeRemaining never goes below zero", () => {
    let s = makePlayingState();
    s = tick(s, 99999, NO_INPUT, null);
    expect(s.timeRemaining).toBeGreaterThanOrEqual(0);
  });

  test("difficulty 2 starts with shorter timer", () => {
    const easy = makeState(0);
    const hard = makeState(2);
    const easyTimer = DIFFICULTY_CONFIG[0].timerS;
    const hardTimer = DIFFICULTY_CONFIG[2].timerS;
    expect(easy.timeRemaining).toBe(easyTimer);
    expect(hard.timeRemaining).toBe(hardTimer);
    expect(hardTimer).toBeLessThan(easyTimer);
  });
});

// ── Signals ───────────────────────────────────────────────────────────────────

test.describe("Semaphoria engine – signal dispatch", () => {
  test("sendSignal starts a flash when cooldown is zero", () => {
    let s = makePlayingState();
    s = sendSignal(s, "go");
    expect(s.activeFlash).not.toBeNull();
  });

  test("sendSignal increments signalsSent", () => {
    let s = makePlayingState();
    expect(s.signalsSent).toBe(0);
    s = sendSignal(s, "go");
    expect(s.signalsSent).toBe(1);
  });

  test("sendSignal is blocked during cooldown", () => {
    let s = makePlayingState();
    s = sendSignal(s, "go");
    const first = s.signalsSent;
    // Flash is active, so another sendSignal should be blocked
    s = sendSignal(s, "left");
    expect(s.signalsSent).toBe(first);
  });

  test("sendSignal is blocked in non-playing phases", () => {
    let s = makeState();
    s = sendSignal(s, "go");
    expect(s.activeFlash).toBeNull();
    expect(s.signalsSent).toBe(0);
  });

  test("getCurrentFlashColor returns null when no signal is active", () => {
    const s = makePlayingState();
    expect(getCurrentFlashColor(s)).toBeNull();
  });

  test("getCurrentFlashColor returns color when a flash is active", () => {
    let s = makePlayingState();
    s = sendSignal(s, "go");
    const color = getCurrentFlashColor(s);
    expect(color).not.toBeNull();
    expect(typeof color).toBe("string");
  });

  test("signal cooldown ticks down over time", () => {
    let s = makePlayingState();
    s = sendSignal(s, "go");
    const cooldownBefore = s.signalCooldown;
    s = tick(s, 0.5, NO_INPUT, null);
    expect(s.signalCooldown).toBeLessThan(cooldownBefore);
  });
});

// ── deriveStats ───────────────────────────────────────────────────────────────

test.describe("Semaphoria engine – deriveStats", () => {
  test("deriveStats reflects phase as result", () => {
    let s = makePlayingState();
    s = tick(s, 99999, NO_INPUT, null); // timeout → failure
    const stats = deriveStats(s);
    expect(stats.result).toBe("failure");
  });

  test("deriveStats includes signalsSent and nearMisses", () => {
    const s = makePlayingState();
    const stats = deriveStats(s);
    expect(typeof stats.signalsSent).toBe("number");
    expect(typeof stats.nearMisses).toBe("number");
  });

  test("timeTaken equals timerS minus remaining", () => {
    let s = makePlayingState(0);
    const configTimer = DIFFICULTY_CONFIG[0].timerS;
    s = tick(s, 10, NO_INPUT, null); // advance 10 seconds
    const stats = deriveStats(s);
    // timeTaken ≈ 10 (may be slightly off due to drift/collision checks)
    expect(stats.timeTaken).toBeCloseTo(configTimer - s.timeRemaining, 0);
  });
});
