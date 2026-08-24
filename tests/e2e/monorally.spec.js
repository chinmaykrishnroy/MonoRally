import { expect, test } from "@playwright/test";

async function openModeStep(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

async function startPractice(page) {
  await openModeStep(page);
  await page.getByRole("button", { name: /Practice with AI/ }).click();
  await expect(page.locator("#game")).toBeVisible();
}

test("home guides players through a small play flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MonoRally" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.getByText("Top rally scores")).toBeVisible();
  await expect(page.getByRole("button", { name: /Quick match/ })).toBeHidden();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("Choose your match")).toBeVisible();
  await expect(page.getByRole("button", { name: /Practice with AI/ })).toBeVisible();

  await page.getByRole("button", { name: /Play online/ }).click();
  await expect(page.getByText("How would you like to play?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Quick match/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Public rooms/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Private room/ })).toBeVisible();
});

test("practice draws the court and coaches the controls", async ({ page }) => {
  await startPractice(page);
  await expect(page.locator("#court")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Practice match");
  await expect(page.locator("#controlCoach")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator("#controlCoach")).toBeHidden();
});

test("private room code remains visible in the game HUD", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "single network room contract");
  await openModeStep(page);
  await page.getByRole("button", { name: "2 versus 2" }).click();
  await page.getByRole("button", { name: /Play online/ }).click();
  await page.getByRole("button", { name: /Private room/ }).click();
  await page.getByRole("button", { name: "Create private 2v2" }).click();

  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator("#roomBadge")).toBeVisible();
  await expect(page.locator("#roomValue")).toHaveText(/[A-F0-9]{6}/);
  await expect(page.locator("#roomValue")).not.toHaveCSS("text-overflow", "ellipsis");
});

test("shared room links open the private join step", async ({ page }) => {
  await page.goto("/?room=ABC123");
  await expect(page.locator("#flowTitle")).toHaveText("Private room");
  await expect(page.locator("#roomCode")).toHaveValue("ABC123");
});

test("public browser separates waiting and live rooms", async ({ page }) => {
  await openModeStep(page);
  await page.getByRole("button", { name: /Play online/ }).click();
  await page.getByRole("button", { name: /Public rooms/ }).click();
  await expect(page.getByRole("tab", { name: "Waiting" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "In progress" }).click();
  await expect(page.getByRole("tab", { name: "In progress" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Waiting" }).click();
  await expect(page.getByRole("tab", { name: "Waiting" })).toHaveAttribute("aria-selected", "true");
});

test("another client can join a waiting public room and spectate it in progress", async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "multi-client room discovery contract");
  await openModeStep(page);
  await page.getByRole("button", { name: /Play online/ }).click();
  await page.getByRole("button", { name: /Public rooms/ }).click();
  await page.getByRole("button", { name: "Host public 1v1" }).click();
  const code = (await page.locator("#roomValue").textContent())?.trim();
  expect(code).toMatch(/^[A-F0-9]{6}$/);

  const guestContext = await browser.newContext({ baseURL: "http://127.0.0.1:19087" });
  const guest = await guestContext.newPage();
  await openModeStep(guest);
  await guest.getByRole("button", { name: /Play online/ }).click();
  await guest.getByRole("button", { name: /Public rooms/ }).click();
  const waitingRoom = guest.locator(".roomItem", { hasText: code });
  await expect(waitingRoom).toBeVisible();
  await waitingRoom.getByRole("button", { name: "Join" }).click();
  await expect(guest.locator("#game")).toBeVisible();

  const spectatorContext = await browser.newContext({ baseURL: "http://127.0.0.1:19087" });
  const spectator = await spectatorContext.newPage();
  await openModeStep(spectator);
  await spectator.getByRole("button", { name: /Play online/ }).click();
  await spectator.getByRole("button", { name: /Public rooms/ }).click();
  await spectator.getByRole("tab", { name: "In progress" }).click();
  const liveRoom = spectator.locator(".roomItem", { hasText: code });
  await expect(liveRoom).toBeVisible();
  await expect(liveRoom.getByRole("button", { name: "Join" })).toHaveCount(0);
  await spectator.locator("#publicRoomCode").fill(code);
  await spectator.locator("#publicJoinSpectator").click();
  await expect(spectator.locator("#game")).toBeVisible();
  await spectatorContext.close();
  await guestContext.close();
});

test("player name and match size survive a refresh", async ({ page }) => {
  await openModeStep(page);
  await page.locator("#nameInput").fill("steady-rally");
  await page.getByRole("button", { name: "2 versus 2" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#nameInput")).toHaveValue("steady-rally");
  await expect(page.getByRole("button", { name: "2 versus 2" })).toHaveAttribute("aria-pressed", "true");
});

test("iPhone can start and reconnect to a quick match", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iPhone 16", "iPhone touch and reconnect contract");
  await openModeStep(page);
  await page.getByRole("button", { name: /Play online/ }).click();
  await page.getByRole("button", { name: /Quick match/ }).click();
  await expect(page.locator("#game")).toBeVisible({ timeout: 7000 });
  const code = (await page.locator("#roomValue").textContent())?.trim();
  expect(code).toMatch(/^[A-F0-9]{6}$/);

  await page.reload();
  await expect(page.locator("#game")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#roomValue")).toHaveText(code);
});

test("quick 2v2 falls back to a public, spectatable AI-filled match", async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "single quick-match contract");
  await openModeStep(page);
  await page.getByRole("button", { name: "2 versus 2" }).click();
  await page.getByRole("button", { name: /Play online/ }).click();
  await page.getByRole("button", { name: /Quick match/ }).click();
  await expect(page.locator("#game")).toBeVisible({ timeout: 7000 });
  await expect(page.locator("#modeLabel")).toContainText("2v2");
  await expect(page.locator("#status")).toContainText("2v2 rally", { timeout: 7000 });
  const code = (await page.locator("#roomValue").textContent())?.trim();
  const publicSnapshot = await page.evaluate(() => fetch("/rooms.json", { cache: "no-store" }).then((response) => response.json()));
  expect(publicSnapshot.rooms).toEqual(expect.arrayContaining([expect.objectContaining({ code, status: "running" })]));

  const spectatorContext = await browser.newContext({ baseURL: "http://127.0.0.1:19087" });
  const spectator = await spectatorContext.newPage();
  await openModeStep(spectator);
  await spectator.getByRole("button", { name: /Play online/ }).click();
  await spectator.getByRole("button", { name: /Public rooms/ }).click();
  await spectator.getByRole("tab", { name: "In progress" }).click();
  const room = spectator.locator(".roomItem", { hasText: code });
  await expect(room).toBeVisible();
  await room.getByRole("button", { name: "Spectate" }).click();
  await expect(spectator.locator("#game")).toBeVisible();
  await spectatorContext.close();
});

for (const project of ["iPhone 16", "iPhone 16 landscape", "tablet"]) {
  test(`${project} keeps the HUD and status outside the playable court`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== project, `${project} viewport contract`);
    await page.addInitScript(() => {
      window.__MONORALLY_DEBUG__ = true;
      localStorage.setItem("monorally-coach-v1", "done");
    });
    await startPractice(page);
    await page.waitForFunction(() => Boolean(window.__MONORALLY_VIEWPORT__));

    const metrics = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: box("#court"),
        court: window.__MONORALLY_VIEWPORT__,
        hud: box(".hud"),
        status: box("#status"),
        hudButtonMin: Math.min(...[...document.querySelectorAll(".hud button")].filter((button) => !button.hidden).map((button) => button.getBoundingClientRect().height)),
        scrollHeight: document.documentElement.scrollHeight
      };
    });

    expect(metrics.canvas.width).toBeGreaterThanOrEqual(metrics.viewport.width - 1);
    expect(metrics.canvas.height).toBeGreaterThanOrEqual(metrics.viewport.height - 1);
    expect(metrics.court.width / metrics.court.height).toBeCloseTo(1000 / 680, 1);
    expect(metrics.hud.bottom).toBeLessThanOrEqual(metrics.court.y + 1);
    expect(metrics.court.y + metrics.court.height).toBeLessThanOrEqual(metrics.status.top + 1);
    expect(metrics.hudButtonMin).toBeGreaterThanOrEqual(42);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewport.height + 2);
  });
}

test("portrait court is centered in the safe play region", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iPhone 16", "portrait centering contract");
  await page.addInitScript(() => {
    window.__MONORALLY_DEBUG__ = true;
    localStorage.setItem("monorally-coach-v1", "done");
  });
  await startPractice(page);
  await page.waitForFunction(() => Boolean(window.__MONORALLY_VIEWPORT__));

  const centers = await page.evaluate(() => {
    const hud = document.querySelector(".hud").getBoundingClientRect();
    const status = document.querySelector("#status").getBoundingClientRect();
    const court = window.__MONORALLY_VIEWPORT__;
    return { safe: (hud.bottom + status.top) / 2, court: court.y + court.height / 2 };
  });

  expect(Math.abs(centers.safe - centers.court)).toBeLessThan(8);
});
