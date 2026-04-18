import { test, expect } from "@playwright/test";

test.describe("Multiplayer lobby coverage", () => {
  test("Signal Weave allows a second player to join host lobby", async ({ browser }) => {
    test.setTimeout(60_000);

    const hostPage = await browser.newPage();
    const guestPage = await browser.newPage();

    try {
      await Promise.all([hostPage.goto("/games/signal-weave/"), guestPage.goto("/games/signal-weave/")]);

      await hostPage.locator("#host-btn").click();
      await expect(hostPage.locator("#room-wrap")).toBeVisible();

      const roomCode = (await hostPage.locator("#room-code").textContent())?.trim() ?? "";
      expect(roomCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
      await expect(hostPage.locator("#start-btn")).toBeDisabled();

      await guestPage.locator("#join-code").fill(roomCode);
      await guestPage.locator("#join-btn").click();

      await expect(hostPage.locator("#lobby-status")).toContainText("Ready to begin.", {
        timeout: 30_000,
      });
      await expect(hostPage.locator("#start-btn")).toBeEnabled({ timeout: 30_000 });
      await expect(hostPage.locator("#slot")).toHaveText("P1");

      await expect(guestPage.locator("#lobby-status")).toContainText("Linked as operator 2", {
        timeout: 30_000,
      });
      await expect(guestPage.locator("#slot")).toHaveText("P2");
    } finally {
      await Promise.all([hostPage.close(), guestPage.close()]);
    }
  });

  test("Signal Weave requires a room code before joining", async ({ page }) => {
    await page.goto("/games/signal-weave/");
    await page.locator("#join-btn").click();
    await expect(page.locator("#lobby-status")).toHaveText("Enter room code.");
  });
});
