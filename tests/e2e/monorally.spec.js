import { expect, test } from "@playwright/test";

test("menu renders and AI mode draws the court", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MonoRally" })).toBeVisible();
  await page.getByRole("button", { name: "AI mode" }).click();
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator("#court")).toBeVisible();
  await expect(page.locator("#status")).toContainText("AI mode");
});

test("room link can be created and copied", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "new room / 2" }).click();
  await expect(page.locator("#roomCode")).toHaveValue(/[A-F0-9]{6}/);
  await page.getByRole("button", { name: "copy room link" }).click();
  await expect(page.locator("#status")).toContainText(/copied room link|ready to copy/);
});

test("shared room links prefill the room code", async ({ page }) => {
  await page.goto("/?room=ABC123");
  await expect(page.locator("#roomCode")).toHaveValue("ABC123");
});

test("quick 2v2 running match does not keep the waiting status", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "quick-match status contract");

  await page.goto("/");
  await page.getByRole("button", { name: "2v2" }).click();
  await page.getByRole("button", { name: "quick match" }).click();
  await expect(page.locator("#game")).toBeVisible({ timeout: 7000 });
  await expect(page.locator("#modeLabel")).toContainText("2v2");
  await expect(page.locator("#status")).toContainText("2v2 rally", { timeout: 7000 });
  await expect(page.locator("#status")).not.toContainText("waiting for players");
});

test("iPhone 16 game view is full screen with readable controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iPhone 16", "iPhone 16 viewport contract");

  await page.addInitScript(() => {
    window.__MONORALLY_DEBUG__ = true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "AI mode" }).click();
  await page.waitForFunction(() => Boolean(window.__MONORALLY_VIEWPORT__));

  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const hudButtons = [...document.querySelectorAll(".hud button")]
      .filter((button) => !button.hidden)
      .map((button) => button.getBoundingClientRect().height);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: rect("#court"),
      court: window.__MONORALLY_VIEWPORT__,
      game: rect("#game"),
      status: rect("#status"),
      hudButtonMin: Math.min(...hudButtons),
      hudFontSize: Number.parseFloat(getComputedStyle(document.querySelector(".hud button")).fontSize),
      statusFontSize: Number.parseFloat(getComputedStyle(document.querySelector("#status")).fontSize),
      hudBottom: document.querySelector(".hud").getBoundingClientRect().bottom,
      scrollHeight: document.documentElement.scrollHeight
    };
  });

  expect(metrics.game.width).toBeGreaterThanOrEqual(metrics.viewport.width - 1);
  expect(metrics.game.height).toBeGreaterThanOrEqual(metrics.viewport.height - 1);
  expect(metrics.canvas.width).toBeGreaterThanOrEqual(metrics.viewport.width - 1);
  expect(metrics.canvas.height).toBeGreaterThanOrEqual(metrics.viewport.height - 1);
  expect(metrics.court.width).toBeCloseTo(metrics.viewport.width, 0);
  expect(metrics.court.height).toBeLessThan(metrics.viewport.height * 0.45);
  expect(metrics.hudBottom).toBeLessThan(metrics.court.y);
  expect(metrics.court.width / metrics.court.height).toBeCloseTo(1000 / 680, 1);
  expect(metrics.hudButtonMin).toBeGreaterThanOrEqual(44);
  expect(metrics.hudFontSize).toBeGreaterThanOrEqual(13);
  expect(metrics.statusFontSize).toBeGreaterThanOrEqual(13);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewport.height + 2);
});

test("iPhone 16 landscape uses an undistorted height-fit court", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iPhone 16 landscape", "iPhone 16 landscape viewport contract");

  await page.addInitScript(() => {
    window.__MONORALLY_DEBUG__ = true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "AI mode" }).click();
  await page.waitForFunction(() => Boolean(window.__MONORALLY_VIEWPORT__));

  const metrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    court: window.__MONORALLY_VIEWPORT__,
    hud: (() => {
      const box = document.querySelector(".hud").getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    })(),
    status: (() => {
      const box = document.querySelector("#status").getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    })(),
    sideRail: document.body.classList.contains("court-side-rail"),
    hudButtonMin: Math.min(...[...document.querySelectorAll(".hud button")].filter((button) => !button.hidden).map((button) => button.getBoundingClientRect().height)),
    scrollHeight: document.documentElement.scrollHeight
  }));

  expect(metrics.court.height).toBeCloseTo(metrics.viewport.height, 0);
  expect(metrics.court.width).toBeLessThan(metrics.viewport.width);
  expect(metrics.court.width / metrics.court.height).toBeCloseTo(1000 / 680, 1);
  expect(metrics.sideRail).toBe(true);
  expect(metrics.hud.x).toBeGreaterThanOrEqual(metrics.court.x + metrics.court.width);
  expect(metrics.status.right).toBeLessThanOrEqual(metrics.court.x);
  expect(metrics.hudButtonMin).toBeGreaterThanOrEqual(44);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewport.height + 2);
});
