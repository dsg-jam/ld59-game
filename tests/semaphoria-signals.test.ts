/**
 * Semaphoria – signals unit tests.
 *
 * Tests for signal encoding / decoding and the reference card.
 */
import { test, expect } from "@playwright/test";
import {
  encodeSignal,
  decodePattern,
  SIGNAL_ALPHABET,
  SIGNAL_REFERENCE,
} from "../src/lib/semaphoria/signals";
import type { SignalCommand, Flash } from "../src/lib/semaphoria/signals";

const COMMANDS = Object.keys(SIGNAL_ALPHABET) as SignalCommand[];

// ── Encoding ──────────────────────────────────────────────────────────────────

test.describe("Semaphoria signals – encoding", () => {
  test("encodeSignal returns a non-empty pattern for every command", () => {
    for (const cmd of COMMANDS) {
      const pattern = encodeSignal(cmd);
      expect(pattern.length).toBeGreaterThan(0);
    }
  });

  test("each flash in every pattern has valid type and color", () => {
    for (const cmd of COMMANDS) {
      const pattern = encodeSignal(cmd);
      for (const flash of pattern) {
        expect(["dot", "dash"]).toContain(flash.type);
        expect(["white", "red", "green", "yellow"]).toContain(flash.color);
      }
    }
  });

  test("all encoded patterns are unique (no two commands share a pattern)", () => {
    const serialized = COMMANDS.map((cmd) =>
      encodeSignal(cmd)
        .map((f) => `${f.color}-${f.type}`)
        .join("|")
    );
    const unique = new Set(serialized);
    expect(unique.size).toBe(COMMANDS.length);
  });
});

// ── Decoding ──────────────────────────────────────────────────────────────────

test.describe("Semaphoria signals – decoding", () => {
  test("every command round-trips through encode→decode", () => {
    for (const cmd of COMMANDS) {
      const pattern = encodeSignal(cmd);
      const decoded = decodePattern(pattern);
      expect(decoded).toBe(cmd);
    }
  });

  test("decodePattern returns null for an empty pattern", () => {
    expect(decodePattern([])).toBeNull();
  });

  test("decodePattern returns null for a single unknown flash", () => {
    const unknown: Flash[] = [{ type: "dash", color: "green" }];
    expect(decodePattern(unknown)).toBeNull();
  });

  test("decodePattern returns null for a pattern with wrong color", () => {
    // "go" is white dot; changing to red dot should not match
    const wrong: Flash[] = [{ type: "dot", color: "red" }];
    // "right" is red-dot, red-dash — one dot alone should still be null
    // Actually red-dot alone doesn't match any command
    expect(decodePattern(wrong)).toBeNull();
  });

  test("decodePattern is sensitive to order of flashes", () => {
    // rocks-left = dot-dash-dash (red); rocks-right = dash-dash-dot (red)
    const rocksLeft: Flash[] = [
      { type: "dot", color: "red" },
      { type: "dash", color: "red" },
      { type: "dash", color: "red" },
    ];
    const rocksRight: Flash[] = [
      { type: "dash", color: "red" },
      { type: "dash", color: "red" },
      { type: "dot", color: "red" },
    ];
    expect(decodePattern(rocksLeft)).toBe("rocks-left");
    expect(decodePattern(rocksRight)).toBe("rocks-right");
    // Reversed left should decode as right, and vice versa
    expect(decodePattern([...rocksLeft].reverse())).toBe("rocks-right");
  });

  test("decodePattern is sensitive to flash type", () => {
    // "left" is dot-dot green; changing one to dash should not match "left"
    const mutated: Flash[] = [
      { type: "dash", color: "green" },
      { type: "dot", color: "green" },
    ];
    expect(decodePattern(mutated)).toBeNull();
  });

  test("decodePattern is sensitive to color", () => {
    // "go" is a single white dot; changing color to green should not match
    const wrong: Flash[] = [{ type: "dot", color: "green" }];
    // green-dot alone: "left" is green dot-dot; one dot alone is not a valid command
    expect(decodePattern(wrong)).toBeNull();
  });

  test("extra flashes at the end prevent a match", () => {
    const goPattern: Flash[] = [
      { type: "dot", color: "white" },
      { type: "dot", color: "white" }, // extra
    ];
    expect(decodePattern(goPattern)).toBeNull();
  });
});

// ── Reference card ────────────────────────────────────────────────────────────

test.describe("Semaphoria signals – reference card", () => {
  test("SIGNAL_REFERENCE has one entry per command", () => {
    expect(SIGNAL_REFERENCE.length).toBe(COMMANDS.length);
  });

  test("every reference entry has a label and description", () => {
    for (const entry of SIGNAL_REFERENCE) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test("every reference entry pattern matches the encoded signal", () => {
    for (const entry of SIGNAL_REFERENCE) {
      const encoded = encodeSignal(entry.command);
      expect(entry.pattern).toEqual(encoded);
    }
  });

  test("all reference labels are unique", () => {
    const labels = SIGNAL_REFERENCE.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
