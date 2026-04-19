import { test, expect } from "@playwright/test";

const GAMES = [
  { id: "deconstruct", title: "Deconstruct", path: "/games/deconstruct" },
  { id: "signal-1", title: "Signal 1", path: "/games/signal-1" },
  { id: "signal-2", title: "Signal 2", path: "/games/signal-2" },
  { id: "signal-weave", title: "Signal Weave", path: "/games/signal-weave" },
  { id: "dead-air", title: "Dead Air", path: "/games/dead-air" },
] as const;

test.describe("Index page", () => {
  test("renders the page title and brand", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("ARCADE // INDEX");
    await expect(page.locator(".brand")).toBeVisible();
  });

  test("shows all game cards", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".game");
    await expect(cards).toHaveCount(GAMES.length);
  });

  test("all game links are present and point to valid paths", async ({ page }) => {
    await page.goto("/");
    for (const game of GAMES) {
      const link = page.locator(`a.game[href$="${game.path}"]`);
      await expect(link).toBeVisible();
    }
  });

  test("live clock is displayed", async ({ page }) => {
    await page.goto("/");
    const clock = page.locator(".status span").last();
    await expect(clock).toHaveText(/\d{2}:\d{2}:\d{2}/);
  });
});

test.describe("Game routes", () => {
  for (const game of GAMES) {
    test(`${game.title} page loads without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(game.path);

      // Page should not 404
      const response = await page.request.get(game.path);
      expect(response.status()).not.toBe(404);

      // No uncaught JS errors on load
      expect(errors).toHaveLength(0);
    });

    test(`${game.title} page has a title`, async ({ page }) => {
      await page.goto(game.path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });
  }
});
