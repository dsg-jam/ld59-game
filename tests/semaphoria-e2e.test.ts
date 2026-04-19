import { test, expect, type Page } from "@playwright/test";

const GAME_PATH = "/games/semaphoria";
const ROOM_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

async function openSemaphoria(page: Page): Promise<void> {
  await page.goto(GAME_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "SEMAPHORIA" })).toBeVisible();
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
    await page.getByRole("button", { name: "TUNE IN" }).click();
    await expect(page.getByText("Enter room code.")).toBeVisible();
  });

  test("two players can host, join, start, and exchange signals", async ({ browser }) => {
    test.setTimeout(90_000);

    const keeperPage = await browser.newPage();
    const captainPage = await browser.newPage();

    try {
      await Promise.all([openSemaphoria(keeperPage), openSemaphoria(captainPage)]);

      await keeperPage.getByRole("button", { name: /KEEPER/i }).click();
      await keeperPage.getByRole("button", { name: "OPEN CHANNEL" }).click();

      const roomCode = (await keeperPage.locator(".room").textContent())?.trim() ?? "";
      expect(roomCode).toMatch(ROOM_CODE_REGEX);

      await captainPage.getByLabel("Room code").fill(roomCode);
      await captainPage.getByRole("button", { name: "TUNE IN" }).click();

      await expect(keeperPage.getByText("Captain")).toBeVisible({ timeout: 30_000 });
      await expect(keeperPage.getByRole("button", { name: "START" })).toBeEnabled({
        timeout: 30_000,
      });

      await keeperPage.getByRole("button", { name: "START" }).click();

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
