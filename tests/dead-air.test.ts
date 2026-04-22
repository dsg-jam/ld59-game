/**
 * Dead Air — telephone audio puzzle tests.
 *
 * Covers the pure engine (melody generation, relay chain generation, scoring,
 * seeded RNG) and a smoke test that the page renders without JS errors.
 */
import { test, expect } from "@playwright/test";
import {
  DIFFICULTY_LADDER,
  RELAY_KINDS,
  SCALE,
  SCALE_LABELS,
  clamp,
  createSeededRng,
  generateMelody,
  generateRelayChain,
  getConfigForRound,
  noteToFreq,
  scoreGuess,
} from "../src/lib/dead-air-engine";

// ── Engine: utilities ────────────────────────────────────────────────────────

test.describe("Dead Air engine — utilities", () => {
  test("clamp bounds values", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(200, 0, 100)).toBe(100);
  });

  test("noteToFreq rises monotonically within scale", () => {
    for (let i = 1; i < SCALE.length; i++) {
      expect(noteToFreq(i)).toBeGreaterThan(noteToFreq(i - 1));
    }
  });

  test("scale labels align with scale degrees", () => {
    expect(SCALE_LABELS.length).toBe(SCALE.length);
  });
});

// ── Engine: melody generation ────────────────────────────────────────────────

test.describe("Dead Air engine — generateMelody", () => {
  test("produces the requested number of notes", () => {
    const m = generateMelody(5);
    expect(m.notes).toHaveLength(5);
    expect(m.length).toBe(5);
  });

  test("all notes are in-scale", () => {
    const m = generateMelody(12);
    for (const n of m.notes) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SCALE.length);
    }
  });

  test("clamps length to at least 1", () => {
    expect(generateMelody(0).notes.length).toBeGreaterThanOrEqual(1);
    expect(generateMelody(-5).notes.length).toBeGreaterThanOrEqual(1);
  });

  test("no immediate repetitions", () => {
    const m = generateMelody(16);
    for (let i = 1; i < m.notes.length; i++) {
      expect(m.notes[i]).not.toBe(m.notes[i - 1]);
    }
  });

  test("deterministic when seeded", () => {
    const a = generateMelody(6, createSeededRng(42));
    const b = generateMelody(6, createSeededRng(42));
    expect(a.notes).toEqual(b.notes);
  });
});

// ── Engine: relay chain generation ───────────────────────────────────────────

test.describe("Dead Air engine — generateRelayChain", () => {
  test("produces the requested number of relays", () => {
    const chain = generateRelayChain(4, 0.8);
    expect(chain).toHaveLength(4);
  });

  test("all relay kinds come from the public list", () => {
    const chain = generateRelayChain(10, 1.0);
    for (const r of chain) {
      expect(RELAY_KINDS).toContain(r.kind);
    }
  });

  test("strengths stay within [0, maxStrength] tolerance", () => {
    const chain = generateRelayChain(8, 0.5);
    for (const r of chain) {
      expect(r.strength).toBeGreaterThanOrEqual(0);
      expect(r.strength).toBeLessThanOrEqual(0.6); // 20% headroom for ramping jitter
    }
  });

  test("zero count yields empty chain", () => {
    expect(generateRelayChain(0, 0.5)).toHaveLength(0);
  });

  test("deterministic when seeded", () => {
    const a = generateRelayChain(5, 0.7, createSeededRng(99));
    const b = generateRelayChain(5, 0.7, createSeededRng(99));
    expect(a).toEqual(b);
  });
});

// ── Engine: scoring ──────────────────────────────────────────────────────────

test.describe("Dead Air engine — scoreGuess", () => {
  test("perfect guess is 100%", () => {
    const original = { notes: [1, 3, 5], length: 3 };
    const score = scoreGuess(original, [1, 3, 5]);
    expect(score.accuracy).toBe(1);
    expect(score.correct).toBe(3);
    expect(score.perNote).toEqual([true, true, true]);
  });

  test("all-wrong guess is 0%", () => {
    const original = { notes: [1, 3, 5], length: 3 };
    const score = scoreGuess(original, [0, 0, 0]);
    expect(score.accuracy).toBe(0);
    expect(score.correct).toBe(0);
  });

  test("partial guess computes correct fraction", () => {
    const original = { notes: [1, 2, 3, 4], length: 4 };
    const score = scoreGuess(original, [1, 2, 7, 7]);
    expect(score.correct).toBe(2);
    expect(score.accuracy).toBe(0.5);
    expect(score.perNote).toEqual([true, true, false, false]);
  });

  test("missing guess entries count as wrong", () => {
    const original = { notes: [1, 2, 3], length: 3 };
    const score = scoreGuess(original, [1]);
    expect(score.correct).toBe(1);
    expect(score.accuracy).toBeCloseTo(1 / 3, 5);
  });
});

// ── Engine: difficulty ladder ────────────────────────────────────────────────

test.describe("Dead Air engine — difficulty ladder", () => {
  test("round 0 is easier than last entry", () => {
    const easy = getConfigForRound(0);
    const hard = getConfigForRound(DIFFICULTY_LADDER.length - 1);
    expect(easy.melodyLength).toBeLessThanOrEqual(hard.melodyLength);
    expect(easy.relayCount).toBeLessThanOrEqual(hard.relayCount);
    expect(easy.maxRelayStrength).toBeLessThanOrEqual(hard.maxRelayStrength);
  });

  test("rounds past the ladder clamp to the last config", () => {
    const last = DIFFICULTY_LADDER[DIFFICULTY_LADDER.length - 1];
    expect(getConfigForRound(999)).toEqual(last);
  });
});

// ── Seeded RNG ──────────────────────────────────────────────────────────────

test.describe("Dead Air engine — createSeededRng", () => {
  test("same seed reproduces the same sequence", () => {
    const a = createSeededRng(12345);
    const b = createSeededRng(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test("values land in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ── Browser smoke test ──────────────────────────────────────────────────────

test.describe("Dead Air page — browser", () => {
  test("page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/games/dead-air/");
    const response = await page.request.get("/games/dead-air/");
    expect(response.status()).not.toBe(404);
    expect(errors).toHaveLength(0);
  });

  test("lobby UI is visible by default", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator("#lobby")).toBeVisible();
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#host-btn")).toBeVisible();
    await expect(page.locator("#join-btn")).toBeVisible();
    await expect(page.locator("#join-code")).toBeVisible();
  });

  test("callsign input has a default value", async ({ page }) => {
    await page.goto("/games/dead-air/");
    const value = await page.locator("#name").inputValue();
    expect(value).toMatch(/^OPERATIVE-\d+$/);
  });

  test("join button is disabled without a code", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator("#join-btn")).toBeDisabled();
  });

  test("how-to-play instructions are visible in lobby", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator(".how h3")).toHaveText("HOW TO PLAY");
  });
});
