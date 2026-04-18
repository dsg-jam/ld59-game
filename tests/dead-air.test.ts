/**
 * Dead Air – end-to-end tests.
 *
 * These tests exercise the extracted game engine (pure logic, no DOM / PeerJS)
 * by simulating full game rounds, and verify the page loads correctly via
 * Playwright's browser automation.
 */
import { test, expect } from "@playwright/test";
import {
  WORLD_W,
  WORLD_H,
  TOWER_REQUIRED,
  REPAIR_RADIUS,
  DARK_CHECK_RADIUS,
  WARM_X,
  WARM_Y,
  VOTE_DURATION_MS,
  MAX_PLAYERS,
  PLAYER_COLORS,
  createDefaultTowers,
  createPlayer,
  assignRoles,
  checkWinConditions,
  updateTowers,
  isIsolatedInDark,
  resolveVote,
  applyMovement,
  clamp,
  dist,
} from "../src/lib/dead-air-engine";
import type { Player, Tower, Role, VoteState } from "../src/lib/dead-air-engine";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a players Map from an array. */
function playersMap(arr: Player[]): Map<string, Player> {
  return new Map(arr.map((p) => [p.id, p]));
}

// ── Unit-level engine tests ──────────────────────────────────────────────────

test.describe("Dead Air engine – utilities", () => {
  test("clamp restricts value to range", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(200, 0, 100)).toBe(100);
  });

  test("dist returns Euclidean distance", () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
    expect(dist(10, 10, 10, 10)).toBe(0);
  });
});

test.describe("Dead Air engine – createDefaultTowers", () => {
  test("returns 3 towers with zero progress", () => {
    const towers = createDefaultTowers();
    expect(towers).toHaveLength(3);
    for (const t of towers) {
      expect(t.progress).toBe(0);
      expect(t.x).toBeGreaterThan(0);
      expect(t.y).toBeGreaterThan(0);
    }
  });

  test("returns independent copies", () => {
    const a = createDefaultTowers();
    const b = createDefaultTowers();
    a[0]!.progress = 99;
    expect(b[0]!.progress).toBe(0);
  });
});

test.describe("Dead Air engine – createPlayer", () => {
  test("creates a player near spawn with correct color", () => {
    const p = createPlayer("p1", "Alice", 0);
    expect(p.id).toBe("p1");
    expect(p.name).toBe("Alice");
    expect(p.color).toBe(PLAYER_COLORS[0]);
    expect(p.alive).toBe(true);
    expect(p.spectator).toBe(false);
  });
});

test.describe("Dead Air engine – assignRoles", () => {
  test("assigns exactly one mimic and rest researchers", () => {
    const ids = ["a", "b", "c", "d"];
    const roles = assignRoles(ids);
    const mimics = [...roles.values()].filter((r) => r === "mimic");
    const researchers = [...roles.values()].filter((r) => r === "researcher");
    expect(mimics).toHaveLength(1);
    expect(researchers).toHaveLength(3);
  });

  test("deterministic with fixed rng", () => {
    const roles = assignRoles(["x", "y", "z"], () => 0);
    const mimics = [...roles.entries()].filter(([, r]) => r === "mimic");
    expect(mimics).toHaveLength(1);
    // With rng=0, Fisher-Yates produces a deterministic shuffle
    const mimicId = mimics[0]![0];
    expect(roles.get(mimicId)).toBe("mimic");
    for (const [id, role] of roles) {
      if (id !== mimicId) expect(role).toBe("researcher");
    }
  });

  test("handles 2-player minimum", () => {
    const roles = assignRoles(["host", "guest"]);
    const values = [...roles.values()];
    expect(values).toContain("mimic");
    expect(values).toContain("researcher");
  });

  test("returns empty map for empty input", () => {
    expect(assignRoles([])).toEqual(new Map());
  });
});

test.describe("Dead Air engine – checkWinConditions", () => {
  function makeState(overrides: {
    towersDone?: boolean;
    mimicAlive?: boolean;
    researchersAlive?: number;
  }) {
    const towers = createDefaultTowers();
    if (overrides.towersDone) {
      for (const t of towers) t.progress = TOWER_REQUIRED;
    }

    const players: Player[] = [];
    const roles = new Map<string, Role>();

    // mimic
    const mimicAlive = overrides.mimicAlive ?? true;
    players.push({
      id: "mimic-1",
      name: "Mimic",
      color: "#f00",
      x: 0,
      y: 0,
      alive: mimicAlive,
      spectator: !mimicAlive,
    });
    roles.set("mimic-1", "mimic");

    // researchers
    const rCount = overrides.researchersAlive ?? 3;
    for (let i = 0; i < rCount; i++) {
      const id = `r-${i}`;
      players.push({
        id,
        name: `R${i}`,
        color: "#0f0",
        x: WARM_X,
        y: WARM_Y,
        alive: true,
        spectator: false,
      });
      roles.set(id, "researcher");
    }

    return { players: playersMap(players), roles, towers };
  }

  test("returns null when game is in progress", () => {
    const { players, roles, towers } = makeState({});
    expect(checkWinConditions(players, roles, towers)).toBeNull();
  });

  test("researchers win when all towers are repaired", () => {
    const { players, roles, towers } = makeState({ towersDone: true });
    expect(checkWinConditions(players, roles, towers)).toBe("researchers");
  });

  test("researchers win when mimic is voted out", () => {
    const { players, roles, towers } = makeState({ mimicAlive: false });
    expect(checkWinConditions(players, roles, towers)).toBe("researchers");
  });

  test("mimic wins when all researchers are eliminated", () => {
    const { players, roles, towers } = makeState({ researchersAlive: 0 });
    expect(checkWinConditions(players, roles, towers)).toBe("mimic");
  });

  test("game does NOT end immediately with 1 researcher (the old bug)", () => {
    const { players, roles, towers } = makeState({ researchersAlive: 1 });
    expect(checkWinConditions(players, roles, towers)).toBeNull();
  });

  test("game does NOT end immediately with 2-player minimum (1 mimic + 1 researcher)", () => {
    const players = playersMap([
      createPlayer("host", "Host", 0),
      createPlayer("guest", "Guest", 1),
    ]);
    const roles = new Map<string, Role>();
    roles.set("host", "mimic");
    roles.set("guest", "researcher");
    const towers = createDefaultTowers();

    // This is the exact scenario that used to cause the instant game-over.
    expect(checkWinConditions(players, roles, towers)).toBeNull();
  });
});

test.describe("Dead Air engine – updateTowers", () => {
  test("tower progresses when researcher is within repair radius", () => {
    const towers = createDefaultTowers();
    const t0 = towers[0]!;
    const players = playersMap([
      { id: "r1", name: "R", color: "#0f0", x: t0.x, y: t0.y, alive: true, spectator: false },
    ]);
    const roles = new Map<string, Role>([["r1", "researcher"]]);

    updateTowers(towers, players, roles, 5);
    expect(t0.progress).toBe(5);
  });

  test("tower does NOT progress when only mimic is nearby", () => {
    const towers = createDefaultTowers();
    const t0 = towers[0]!;
    const players = playersMap([
      { id: "m1", name: "M", color: "#f00", x: t0.x, y: t0.y, alive: true, spectator: false },
    ]);
    const roles = new Map<string, Role>([["m1", "mimic"]]);

    updateTowers(towers, players, roles, 5);
    expect(t0.progress).toBe(0);
  });

  test("tower does NOT progress past TOWER_REQUIRED", () => {
    const towers = createDefaultTowers();
    const t0 = towers[0]!;
    t0.progress = TOWER_REQUIRED - 1;
    const players = playersMap([
      { id: "r1", name: "R", color: "#0f0", x: t0.x, y: t0.y, alive: true, spectator: false },
    ]);
    const roles = new Map<string, Role>([["r1", "researcher"]]);

    updateTowers(towers, players, roles, 10);
    expect(t0.progress).toBe(TOWER_REQUIRED);
  });

  test("dead researcher does not repair", () => {
    const towers = createDefaultTowers();
    const t0 = towers[0]!;
    const players = playersMap([
      { id: "r1", name: "R", color: "#0f0", x: t0.x, y: t0.y, alive: false, spectator: true },
    ]);
    const roles = new Map<string, Role>([["r1", "researcher"]]);

    updateTowers(towers, players, roles, 5);
    expect(t0.progress).toBe(0);
  });
});

test.describe("Dead Air engine – isIsolatedInDark", () => {
  test("player near a tower is NOT isolated", () => {
    const towers = createDefaultTowers();
    const t0 = towers[0]!;
    const players = playersMap([
      { id: "r1", name: "R", color: "#0f0", x: t0.x, y: t0.y, alive: true, spectator: false },
      { id: "m1", name: "M", color: "#f00", x: 0, y: 0, alive: true, spectator: false },
    ]);
    const roles = new Map<string, Role>([
      ["r1", "researcher"],
      ["m1", "mimic"],
    ]);
    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(false);
  });

  test("player near another researcher is NOT isolated", () => {
    // Place both far from all towers
    const towers = createDefaultTowers();
    const players = playersMap([
      { id: "r1", name: "R1", color: "#0f0", x: 0, y: 0, alive: true, spectator: false },
      { id: "r2", name: "R2", color: "#0f0", x: 10, y: 10, alive: true, spectator: false },
      { id: "m1", name: "M", color: "#f00", x: 0, y: 0, alive: true, spectator: false },
    ]);
    const roles = new Map<string, Role>([
      ["r1", "researcher"],
      ["r2", "researcher"],
      ["m1", "mimic"],
    ]);
    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(false);
  });

  test("lone player far from towers and others IS isolated", () => {
    // Place target far from everything
    const towers = createDefaultTowers();
    const players = playersMap([
      {
        id: "r1",
        name: "R1",
        color: "#0f0",
        x: WORLD_W,
        y: WORLD_H,
        alive: true,
        spectator: false,
      },
      { id: "r2", name: "R2", color: "#0f0", x: 0, y: 0, alive: true, spectator: false },
      {
        id: "m1",
        name: "M",
        color: "#f00",
        x: WORLD_W - 5,
        y: WORLD_H - 5,
        alive: true,
        spectator: false,
      },
    ]);
    const roles = new Map<string, Role>([
      ["r1", "researcher"],
      ["r2", "researcher"],
      ["m1", "mimic"],
    ]);
    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(true);
  });

  test("dead target returns false", () => {
    const towers = createDefaultTowers();
    const players = playersMap([
      {
        id: "r1",
        name: "R1",
        color: "#0f0",
        x: WORLD_W,
        y: WORLD_H,
        alive: false,
        spectator: true,
      },
    ]);
    const roles = new Map<string, Role>([["r1", "researcher"]]);
    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(false);
  });
});

test.describe("Dead Air engine – resolveVote", () => {
  function makeVote(votes: Record<string, string>): VoteState {
    return { active: true, endsAt: Date.now() + VOTE_DURATION_MS, votes, caller: "r1" };
  }

  const basePlayers = playersMap([
    createPlayer("m1", "Mimic", 0),
    createPlayer("r1", "R1", 1),
    createPlayer("r2", "R2", 2),
    createPlayer("r3", "R3", 3),
  ]);
  const baseRoles = new Map<string, Role>([
    ["m1", "mimic"],
    ["r1", "researcher"],
    ["r2", "researcher"],
    ["r3", "researcher"],
  ]);

  test("correct vote eliminates mimic", () => {
    const vote = makeVote({ r1: "m1", r2: "m1", r3: "r1" });
    const result = resolveVote(vote, basePlayers, baseRoles);
    expect(result.eliminated).toBe("m1");
    expect(result.correct).toBe(true);
    expect(result.tie).toBe(false);
  });

  test("wrong vote eliminates researcher", () => {
    const vote = makeVote({ r1: "r2", r2: "r2" });
    const result = resolveVote(vote, basePlayers, baseRoles);
    expect(result.eliminated).toBe("r2");
    expect(result.correct).toBe(false);
  });

  test("tied vote eliminates nobody", () => {
    const vote = makeVote({ r1: "m1", r2: "r1" });
    const result = resolveVote(vote, basePlayers, baseRoles);
    expect(result.eliminated).toBeNull();
    expect(result.tie).toBe(true);
  });

  test("empty votes result in tie", () => {
    const vote = makeVote({});
    const result = resolveVote(vote, basePlayers, baseRoles);
    expect(result.eliminated).toBeNull();
    expect(result.tie).toBe(true);
  });
});

test.describe("Dead Air engine – applyMovement", () => {
  test("moves player in correct direction", () => {
    const pos = applyMovement(WARM_X, WARM_Y, 1, 0, 1);
    expect(pos.x).toBeGreaterThan(WARM_X);
    expect(pos.y).toBe(WARM_Y);
  });

  test("clamps to world bounds", () => {
    const pos = applyMovement(0, 0, -1, -1, 100);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  test("no movement when dx=dy=0", () => {
    const pos = applyMovement(WARM_X, WARM_Y, 0, 0, 1);
    expect(pos.x).toBe(WARM_X);
    expect(pos.y).toBe(WARM_Y);
  });

  test("diagonal movement is normalised", () => {
    const straight = applyMovement(WARM_X, WARM_Y, 1, 0, 1);
    const diag = applyMovement(WARM_X, WARM_Y, 1, 1, 1);
    const straightDist = dist(WARM_X, WARM_Y, straight.x, straight.y);
    const diagDist = dist(WARM_X, WARM_Y, diag.x, diag.y);
    expect(Math.abs(straightDist - diagDist)).toBeLessThan(0.01);
  });
});

// ── Full game round simulation (engine only) ────────────────────────────────

test.describe("Dead Air engine – full game round simulation", () => {
  test("researchers win by repairing all towers", () => {
    // Setup: 4 players (1 mimic + 3 researchers)
    const ids = ["host", "p2", "p3", "p4"];
    const roles = new Map<string, Role>([
      ["host", "mimic"],
      ["p2", "researcher"],
      ["p3", "researcher"],
      ["p4", "researcher"],
    ]);

    const towers = createDefaultTowers();
    const players = playersMap(ids.map((id, i) => createPlayer(id, `Player${i}`, i)));

    // Verify game is in progress
    expect(checkWinConditions(players, roles, towers)).toBeNull();

    // Researchers move to towers and repair them
    const t0 = towers[0]!;
    const t1 = towers[1]!;
    const t2 = towers[2]!;

    // Move researchers to towers
    players.get("p2")!.x = t0.x;
    players.get("p2")!.y = t0.y;
    players.get("p3")!.x = t1.x;
    players.get("p3")!.y = t1.y;
    players.get("p4")!.x = t2.x;
    players.get("p4")!.y = t2.y;

    // Simulate 30+ seconds of repair (dt per tick, many ticks)
    for (let i = 0; i < 300; i++) {
      updateTowers(towers, players, roles, 0.1);
    }

    // All towers should be complete
    expect(t0.progress).toBe(TOWER_REQUIRED);
    expect(t1.progress).toBe(TOWER_REQUIRED);
    expect(t2.progress).toBe(TOWER_REQUIRED);

    // Researchers win
    expect(checkWinConditions(players, roles, towers)).toBe("researchers");
  });

  test("mimic wins by eliminating all researchers", () => {
    const ids = ["host", "p2", "p3"];
    const roles = new Map<string, Role>([
      ["host", "mimic"],
      ["p2", "researcher"],
      ["p3", "researcher"],
    ]);

    const towers = createDefaultTowers();
    const players = playersMap(ids.map((id, i) => createPlayer(id, `Player${i}`, i)));

    // Game is in progress
    expect(checkWinConditions(players, roles, towers)).toBeNull();

    // Mimic eliminates p2
    players.get("p2")!.alive = false;
    players.get("p2")!.spectator = true;
    expect(checkWinConditions(players, roles, towers)).toBeNull(); // 1 researcher left

    // Mimic eliminates p3
    players.get("p3")!.alive = false;
    players.get("p3")!.spectator = true;
    expect(checkWinConditions(players, roles, towers)).toBe("mimic"); // 0 researchers
  });

  test("researchers win by voting out the mimic", () => {
    const ids = ["m1", "r1", "r2", "r3"];
    const roles = new Map<string, Role>([
      ["m1", "mimic"],
      ["r1", "researcher"],
      ["r2", "researcher"],
      ["r3", "researcher"],
    ]);

    const towers = createDefaultTowers();
    const players = playersMap(ids.map((id, i) => createPlayer(id, `P${i}`, i)));

    // Researchers vote correctly
    const vote: VoteState = {
      active: true,
      endsAt: Date.now() + VOTE_DURATION_MS,
      votes: { r1: "m1", r2: "m1", r3: "m1" },
      caller: "r1",
    };

    const result = resolveVote(vote, players, roles);
    expect(result.eliminated).toBe("m1");
    expect(result.correct).toBe(true);

    // Apply the elimination
    players.get("m1")!.alive = false;
    players.get("m1")!.spectator = true;

    // Researchers win
    expect(checkWinConditions(players, roles, towers)).toBe("researchers");
  });

  test("wrong vote doesn't end the game (researcher eliminated by vote)", () => {
    const ids = ["m1", "r1", "r2", "r3"];
    const roles = new Map<string, Role>([
      ["m1", "mimic"],
      ["r1", "researcher"],
      ["r2", "researcher"],
      ["r3", "researcher"],
    ]);
    const towers = createDefaultTowers();
    const players = playersMap(ids.map((id, i) => createPlayer(id, `P${i}`, i)));

    // Researchers vote wrong — eliminate r1
    const vote: VoteState = {
      active: true,
      endsAt: Date.now() + VOTE_DURATION_MS,
      votes: { r2: "r1", r3: "r1" },
      caller: "r2",
    };
    const result = resolveVote(vote, players, roles);
    expect(result.eliminated).toBe("r1");
    expect(result.correct).toBe(false);

    // Apply elimination
    players.get("r1")!.alive = false;
    players.get("r1")!.spectator = true;

    // Game continues — 2 researchers left
    expect(checkWinConditions(players, roles, towers)).toBeNull();
  });

  test("full round: researchers repair under pressure and win", () => {
    // 3 players: 1 mimic (m1), 2 researchers (r1, r2)
    const roles = new Map<string, Role>([
      ["m1", "mimic"],
      ["r1", "researcher"],
      ["r2", "researcher"],
    ]);
    const towers = createDefaultTowers();
    const players = playersMap([
      createPlayer("m1", "Mimic", 0),
      createPlayer("r1", "R1", 1),
      createPlayer("r2", "R2", 2),
    ]);

    // r1 starts repairing tower A
    const tA = towers[0]!;
    players.get("r1")!.x = tA.x;
    players.get("r1")!.y = tA.y;

    // Simulate 35 seconds of repair for tower A
    for (let i = 0; i < 350; i++) {
      updateTowers(towers, players, roles, 0.1);
    }
    expect(tA.progress).toBe(TOWER_REQUIRED);
    expect(checkWinConditions(players, roles, towers)).toBeNull(); // not done yet

    // r1 moves to tower B
    const tB = towers[1]!;
    players.get("r1")!.x = tB.x;
    players.get("r1")!.y = tB.y;

    // r2 repairs tower C simultaneously
    const tC = towers[2]!;
    players.get("r2")!.x = tC.x;
    players.get("r2")!.y = tC.y;

    // Simulate another 35 seconds
    for (let i = 0; i < 350; i++) {
      updateTowers(towers, players, roles, 0.1);
    }
    expect(tB.progress).toBe(TOWER_REQUIRED);
    expect(tC.progress).toBe(TOWER_REQUIRED);

    // All towers repaired — researchers win!
    expect(checkWinConditions(players, roles, towers)).toBe("researchers");
  });

  test("mimic cannot eliminate researcher near tower (not isolated)", () => {
    const roles = new Map<string, Role>([
      ["m1", "mimic"],
      ["r1", "researcher"],
    ]);
    const towers = createDefaultTowers();
    const tA = towers[0]!;
    const players = playersMap([
      {
        id: "m1",
        name: "M",
        color: "#f00",
        x: tA.x + 5,
        y: tA.y + 5,
        alive: true,
        spectator: false,
      },
      { id: "r1", name: "R", color: "#0f0", x: tA.x, y: tA.y, alive: true, spectator: false },
    ]);

    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(false);
  });

  test("mimic can eliminate isolated researcher in the dark", () => {
    const roles = new Map<string, Role>([
      ["m1", "mimic"],
      ["r1", "researcher"],
    ]);
    const towers = createDefaultTowers();
    // r1 is at the far corner — far from all towers and no other researcher nearby
    const players = playersMap([
      {
        id: "m1",
        name: "M",
        color: "#f00",
        x: WORLD_W - 1,
        y: WORLD_H - 1,
        alive: true,
        spectator: false,
      },
      { id: "r1", name: "R", color: "#0f0", x: WORLD_W, y: WORLD_H, alive: true, spectator: false },
    ]);

    expect(isIsolatedInDark("r1", players, roles, towers)).toBe(true);

    // Eliminate the researcher
    players.get("r1")!.alive = false;
    players.get("r1")!.spectator = true;

    // Mimic wins — 0 researchers alive
    expect(checkWinConditions(players, roles, towers)).toBe("mimic");
  });
});

// ── Playwright browser tests ─────────────────────────────────────────────────

test.describe("Dead Air page – browser", () => {
  test("page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/games/dead-air/");

    const response = await page.request.get("/games/dead-air/");
    expect(response.status()).not.toBe(404);
    expect(errors).toHaveLength(0);
  });

  test("lobby UI elements are visible", async ({ page }) => {
    await page.goto("/games/dead-air/");

    await expect(page.locator("#lobby")).toBeVisible();
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#host-btn")).toBeVisible();
    await expect(page.locator("#join-btn")).toBeVisible();
    await expect(page.locator("#join-code")).toBeVisible();
    await expect(page.locator("#start-btn")).toBeVisible();
  });

  test("callsign input has a default value", async ({ page }) => {
    await page.goto("/games/dead-air/");
    const value = await page.locator("#name").inputValue();
    expect(value).toMatch(/^OPERATIVE-\d+$/);
  });

  test("start button is disabled initially", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator("#start-btn")).toBeDisabled();
  });

  test("game area is hidden before game starts", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator("#game")).toBeHidden();
  });

  test("end screen is hidden before game starts", async ({ page }) => {
    await page.goto("/games/dead-air/");
    await expect(page.locator("#end")).toBeHidden();
  });

  test("game does NOT show end screen immediately after hosting", async ({ page }) => {
    await page.goto("/games/dead-air/");

    // Click HOST — this creates a room but needs another player to start
    await page.locator("#host-btn").click();

    // Wait for room to open
    await page.waitForFunction(
      () => document.getElementById("room-code")?.textContent !== "-----",
      { timeout: 10_000 }
    );

    // The end screen must NOT be visible — the old bug would show it instantly
    await expect(page.locator("#end")).toBeHidden();

    // Lobby should still be visible
    await expect(page.locator("#lobby")).toBeVisible();
  });
});
