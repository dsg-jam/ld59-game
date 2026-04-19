/**
 * Semaphoria – Playwright end-to-end tests.
 *
 * Verify the game page loads, lobby UI is functional, and the Threlte 3D
 * canvas initialises without errors.
 */
import { test, expect } from "@playwright/test";

const GAME_PATH = "/games/semaphoria";

test.describe("Semaphoria – page load", () => {
  test("page loads without uncaught JavaScript errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(GAME_PATH);
    await page.waitForLoadState("networkidle");

    expect(errors).toHaveLength(0);
  });

  test("page has the correct <title>", async ({ page }) => {
    await page.goto(GAME_PATH);
    await expect(page).toHaveTitle(/Semaphoria/i);
  });

  test("page does not return a 404", async ({ page }) => {
    const res = await page.request.get(GAME_PATH);
    expect(res.status()).not.toBe(404);
  });
});

test.describe("Semaphoria – lobby UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(GAME_PATH);
  });

  test("displays the game title SEMAPHORIA", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("SEMAPHORIA");
  });

  test("has a role selector with KEEPER and CAPTAIN buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /KEEPER/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /CAPTAIN/i })).toBeVisible();
  });

  test("role buttons are toggleable", async ({ page }) => {
    const keeperBtn = page.getByRole("button", { name: /KEEPER/i });
    const captainBtn = page.getByRole("button", { name: /CAPTAIN/i });
    await captainBtn.click();
    await expect(captainBtn).toHaveClass(/active/);
    await keeperBtn.click();
    await expect(keeperBtn).toHaveClass(/active/);
  });

  test("shows signal reference card in lobby", async ({ page }) => {
    await expect(page.locator(".signal-ref")).toBeVisible();
  });

  test("signal reference card lists all 8 commands", async ({ page }) => {
    // SIGNAL_REFERENCE has 8 entries
    const rows = page.locator(".ref-row");
    await expect(rows).toHaveCount(8);
  });

  test("has a network/open-channel button", async ({ page }) => {
    // The Lobby component renders a host/open-channel button
    const hostBtn = page.getByRole("button", { name: /OPEN CHANNEL|OPEN|HOST/i }).first();
    await expect(hostBtn).toBeVisible();
  });
});

test.describe("Semaphoria – navigation from index", () => {
  test("Semaphoria appears as a game card on the index page", async ({ page }) => {
    await page.goto("/");
    const semaphoriaCard = page.locator(`a.game[href$="${GAME_PATH}"]`);
    await expect(semaphoriaCard).toBeVisible();
  });

  test("Semaphoria card links to the correct page", async ({ page }) => {
    await page.goto("/");
    const semaphoriaCard = page.locator(`a.game[href$="${GAME_PATH}"]`);
    await semaphoriaCard.click();
    await expect(page).toHaveURL(new RegExp(GAME_PATH));
    await expect(page.locator("h1")).toHaveText("SEMAPHORIA");
  });
});

test.describe("Semaphoria – multiplayer lobby connection", () => {
  test("keeper can open a channel and get a room code", async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto(GAME_PATH);

    const keeperBtn = page.getByRole("button", { name: /KEEPER/i });
    await keeperBtn.click();

    const hostBtn = page.getByRole("button", { name: /OPEN CHANNEL|OPEN|HOST/i }).first();
    await hostBtn.click();

    // Room code should appear (the Lobby component shows it)
    await expect(page.locator(".room-code, #room-code, [class*=room]")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("joining without a room code shows an error", async ({ page }) => {
    await page.goto(GAME_PATH);

    // Click captain, try to join with empty code
    const captainBtn = page.getByRole("button", { name: /CAPTAIN/i });
    await captainBtn.click();

    const joinBtn = page.getByRole("button", { name: /JOIN|TUNE|CONNECT/i }).first();
    await joinBtn.click();

    // Expect some error feedback in lobby status
    await expect(page.locator(".lobby-status, #lobby-status, [class*=status]")).toContainText(
      /code|enter/i,
      { timeout: 5_000 }
    );
  });
});
