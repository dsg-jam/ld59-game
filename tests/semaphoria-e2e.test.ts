import { test, expect, type Page, type Browser } from "@playwright/test";

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

/**
 * Connect two players, start a game, and return both pages once the game is
 * in the "PLAYING" phase on both sides.  Caller is responsible for closing
 * the pages when done.
 */
async function startTwoPlayerGame(
  browser: Browser
): Promise<{ keeperPage: Page; captainPage: Page }> {
  const keeperPage = await browser.newPage();
  const captainPage = await browser.newPage();

  await Promise.all([openSemaphoria(keeperPage), openSemaphoria(captainPage)]);

  await keeperPage.getByRole("button", { name: /KEEPER/i }).click();
  await keeperPage.locator("#lobby-host-btn").click();

  const roomCode = await readLobbyRoomCode(keeperPage);

  await captainPage.getByLabel("Room code").fill(roomCode);
  await captainPage.locator("#lobby-join-btn").click();

  // Wait for captain to see "Waiting for keeper" status — confirms connection is open
  await expect(captainPage.locator("#lobby-status")).toContainText("Waiting", {
    timeout: 30_000,
  });

  await expect(keeperPage.locator("#lobby-players")).toContainText("Captain", {
    timeout: 30_000,
  });
  await expect(keeperPage.locator("#lobby-start-btn")).toBeEnabled({ timeout: 30_000 });

  await keeperPage.locator("#lobby-start-btn").click();

  // Both players should enter the game view
  await Promise.all([
    expect(keeperPage.getByRole("heading", { level: 2, name: "SEMAPHORIA" })).toBeVisible({
      timeout: 20_000,
    }),
    expect(captainPage.getByRole("heading", { level: 2, name: "SEMAPHORIA" })).toBeVisible({
      timeout: 20_000,
    }),
  ]);

  // Wait for the countdown to finish and the game to enter the playing phase
  await Promise.all([
    expect(keeperPage.locator(".pill", { hasText: "PLAYING" })).toBeVisible({ timeout: 15_000 }),
    expect(captainPage.locator(".pill", { hasText: "PLAYING" })).toBeVisible({ timeout: 15_000 }),
  ]);

  return { keeperPage, captainPage };
}

// ── Basic page tests ──────────────────────────────────────────────────────────

test.describe("Semaphoria – page load", () => {
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
});

// ── Multiplayer lobby ─────────────────────────────────────────────────────────

test.describe("Semaphoria – multiplayer lobby", () => {
  // 90s is required because PeerJS relay handshakes between two browser peers can spike in CI.
  test.setTimeout(90_000);

  test("captain lobby shows 'Waiting for keeper' after connecting", async ({ browser }) => {
    const keeperPage = await browser.newPage();
    const captainPage = await browser.newPage();

    try {
      await Promise.all([openSemaphoria(keeperPage), openSemaphoria(captainPage)]);

      await keeperPage.getByRole("button", { name: /KEEPER/i }).click();
      await keeperPage.locator("#lobby-host-btn").click();

      const roomCode = await readLobbyRoomCode(keeperPage);
      await captainPage.getByLabel("Room code").fill(roomCode);
      await captainPage.locator("#lobby-join-btn").click();

      // This status update only appears after the DataConnection is fully open —
      // it confirms that the premature-send / open-before-ready bug is fixed.
      await expect(captainPage.locator("#lobby-status")).toContainText("Waiting", {
        timeout: 30_000,
      });
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });
});

// ── Full game flow ────────────────────────────────────────────────────────────

test.describe("Semaphoria – full game flow", () => {
  // 90s covers: relay handshake + countdown + signal exchange + game-over
  test.setTimeout(90_000);

  test("both players see correct roles and can exchange signals", async ({ browser }) => {
    const { keeperPage, captainPage } = await startTwoPlayerGame(browser);

    try {
      await expect(keeperPage.locator(".pill.role")).toHaveText("KEEPER");
      await expect(captainPage.locator(".pill.role")).toHaveText("CAPTAIN");

      // Keeper sends a signal — captain must receive it
      await keeperPage.getByRole("button", { name: /Send signal: GO/i }).click();
      await expect(captainPage.getByText("↓ Signal: go")).toBeVisible({ timeout: 10_000 });
      await expect(keeperPage.getByText("↑ Signal: go")).toBeVisible({ timeout: 10_000 });
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });

  test("keeper sending the same signal twice shows both log entries", async ({ browser }) => {
    // This covers the LogPanel key-collision bug fix: duplicate text must not collapse.
    const { keeperPage, captainPage } = await startTwoPlayerGame(browser);

    try {
      // Send "go" twice; after the cooldown resets we send it again
      await keeperPage.getByRole("button", { name: /Send signal: GO/i }).click();
      await expect(captainPage.getByText("↓ Signal: go")).toBeVisible({ timeout: 10_000 });

      // Wait for cooldown before sending again (cooldown = 2.5 s)
      await captainPage.waitForTimeout(3_000);
      await keeperPage.getByRole("button", { name: /Send signal: GO/i }).click();

      // Both entries should appear in the log (unique keys by index, not text)
      await expect(captainPage.locator(".log div").filter({ hasText: "↓ Signal: go" })).toHaveCount(
        2,
        { timeout: 10_000 }
      );
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });

  test("captain can steer and the heading HUD updates", async ({ browser }) => {
    const { keeperPage, captainPage } = await startTwoPlayerGame(browser);

    try {
      // Read the initial heading from the HUD
      const headingLocator = captainPage.locator(".hud-chip", { hasText: "HEADING" });
      await expect(headingLocator).toBeVisible();
      const headingBefore = await headingLocator.textContent();

      // Press right-arrow for long enough to change heading meaningfully
      await captainPage.keyboard.down("ArrowRight");
      await captainPage.waitForTimeout(500);
      await captainPage.keyboard.up("ArrowRight");

      // Heading must have changed
      const headingAfter = await headingLocator.textContent();
      expect(headingAfter).not.toBe(headingBefore);
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });

  test("game-over result screen appears and shows play-again button", async ({ browser }) => {
    const { keeperPage, captainPage } = await startTwoPlayerGame(browser);

    try {
      // Trigger a success via the test event bridge (dispatched only in tests;
      // the listener is a no-op in normal gameplay).
      await captainPage.evaluate(() => {
        window.dispatchEvent(new CustomEvent("__sema:force-end", { detail: "success" }));
      });

      // Both players must see the result overlay
      await expect(captainPage.locator(".result-overlay")).toBeVisible({ timeout: 10_000 });
      await expect(keeperPage.locator(".result-overlay")).toBeVisible({ timeout: 10_000 });

      // Overlay content
      await expect(captainPage.locator(".result-title.success")).toHaveText("HARBOR REACHED");
      await expect(keeperPage.locator(".result-title.success")).toHaveText("HARBOR REACHED");
      await expect(captainPage.getByRole("button", { name: "PLAY AGAIN" })).toBeVisible();
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });

  test("game-over failure path shows correct result", async ({ browser }) => {
    const { keeperPage, captainPage } = await startTwoPlayerGame(browser);

    try {
      await captainPage.evaluate(() => {
        window.dispatchEvent(new CustomEvent("__sema:force-end", { detail: "failure" }));
      });

      await expect(captainPage.locator(".result-overlay")).toBeVisible({ timeout: 10_000 });
      await expect(keeperPage.locator(".result-overlay")).toBeVisible({ timeout: 10_000 });
      await expect(captainPage.locator(".result-title.failure")).toHaveText("SHIP LOST");
      await expect(keeperPage.locator(".result-title.failure")).toHaveText("SHIP LOST");
    } finally {
      await Promise.all([keeperPage.close(), captainPage.close()]);
    }
  });
});
