import { test, expect, type Page } from "@playwright/test";

const GAME_PATH = "/games/semaphoria";
const ROOM_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

async function openSemaphoria(page: Page): Promise<void> {
  await page.goto(GAME_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "SEMAPHORIA" })).toBeVisible();
}

async function readLobbyRoomCode(page: Page): Promise<string> {
  await expect(page.locator("#lobby-room-code")).toHaveText(ROOM_CODE_REGEX);
  return ((await page.locator("#lobby-room-code").textContent()) ?? "").trim();
}

test.describe("Semaphoria E2E", () => {
  test("loads correctly and has no uncaught errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await openSemaphoria(page);
    await expect(page).toHaveTitle(/Semaphoria/i);
    await expect(page.locator(".signal-ref .ref-row")).toHaveCount(8);
    expect(errors).toHaveLength(0);
  });

  test("requires a room code to join", async ({ page }) => {
    await openSemaphoria(page);
    await page.locator("#lobby-join-btn").click();
    await expect(page.locator("#lobby-status")).toHaveText("Enter room code.");
  });

  test("two players can host, join, start, and exchange signals", async ({ browser }) => {
    // 90s is required because PeerJS relay handshakes between two browser peers can spike in CI.
    test.setTimeout(90_000);

    const keeperPage = await browser.newPage();
    const captainPage = await browser.newPage();

    try {
      await Promise.all([openSemaphoria(keeperPage), openSemaphoria(captainPage)]);

      await keeperPage.getByRole("button", { name: /KEEPER/i }).click();
      await keeperPage.locator("#lobby-host-btn").click();

      const roomCode = await readLobbyRoomCode(keeperPage);
      expect(roomCode).toMatch(ROOM_CODE_REGEX);

      await captainPage.getByLabel("Room code").fill(roomCode);
      await captainPage.locator("#lobby-join-btn").click();

      // Connection establishment through the relay can take several seconds in CI.
      await expect(keeperPage.locator("#lobby-players")).toContainText("Captain", {
        timeout: 30_000,
      });
      await expect(keeperPage.locator("#lobby-start-btn")).toBeEnabled({
        timeout: 30_000,
      });

      await keeperPage.locator("#lobby-start-btn").click();

      await expect(keeperPage.getByRole("heading", { level: 2, name: "SEMAPHORIA" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(captainPage.getByRole("heading", { level: 2, name: "SEMAPHORIA" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(keeperPage.locator(".pill.role")).toHaveText("KEEPER");
      await expect(captainPage.locator(".pill.role")).toHaveText("CAPTAIN");

      await expect(keeperPage.locator(".pill", { hasText: "PLAYING" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(captainPage.locator(".pill", { hasText: "PLAYING" })).toBeVisible({
        timeout: 15_000,
      });

      await keeperPage.getByRole("button", { name: /Send signal: GO/i }).click();
      await expect(captainPage.getByText("↓ Signal: go")).toBeVisible({ timeout: 10_000 });
      await expect(keeperPage.getByText("↑ Signal: go")).toBeVisible({ timeout: 10_000 });
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });
});
