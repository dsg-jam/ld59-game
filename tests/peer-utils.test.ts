import { test, expect } from "@playwright/test";
import { describePeerError, makeCode, resetNet } from "../src/lib/peer";

test.describe("Peer utility coverage", () => {
  test("makeCode creates uppercase room codes of expected length", () => {
    const defaultCode = makeCode();
    const customCode = makeCode(8);

    expect(defaultCode).toHaveLength(5);
    expect(customCode).toHaveLength(8);
    expect(defaultCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    expect(customCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });

  test("describePeerError formats known and unknown error types", () => {
    expect(describePeerError({ type: "peer-unavailable" })).toBe(
      "Room not found or offline. [peer-unavailable]"
    );

    expect(describePeerError({ type: "mystery", message: "details" })).toBe(
      "Connection issue. [mystery] (details)"
    );

    expect(describePeerError(undefined)).toBe("Connection issue. [unknown]");
  });

  test("resetNet destroys active peers and always returns null", () => {
    const peer = {
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };

    const result = resetNet(peer);

    expect(result).toBeNull();
    expect(peer.destroyed).toBeTruthy();
  });

  test("resetNet reports destroy errors through callback", () => {
    const error = new Error("boom");
    let received: unknown;

    const peer = {
      destroy() {
        throw error;
      },
    };

    const result = resetNet(peer, (err) => {
      received = err;
    });

    expect(result).toBeNull();
    expect(received).toBe(error);
  });
});
