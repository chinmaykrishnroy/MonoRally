import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "../client/public/og-image.png");

async function generate() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

  const code = fs.readFileSync(path.resolve(__dirname, "../client/src/sharing/result-card.js"), "utf8");

  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;overflow:hidden;background:#000;"><canvas id="c" width="1200" height="630"></canvas></body></html>`);

  await page.addScriptTag({ content: code.replace(/export\s+/g, "") });

  await page.evaluate(() => {
    const canvas = document.getElementById("c");
    /* global renderResultCard */
    renderResultCard(canvas, {
      outcome: "CYBER RALLIES",
      mode: "1v1 RANKED",
      duration: "02:15",
      player: {
        name: "swift-orbit",
        rankTier: "MASTER",
        elo: 2050,
        delta: "+32",
        misses: 0,
        missLimit: 5
      },
      opponent: {
        name: "neon-ghost",
        rankTier: "DIAMOND",
        elo: 1940,
        delta: "-32",
        misses: 5,
        missLimit: 5
      },
      stats: {
        peakSpeed: 960,
        totalReturns: 48,
        skillShots: { smash: 6, curve: 4, counter: 3, drive: 7 }
      },
      siteUrl: "monorally.app"
    });
  });

  const canvasEl = await page.$("#c");
  await canvasEl.screenshot({ path: outputPath });
  await browser.close();
  console.log("Successfully generated og-image.png at", outputPath);
}

generate().catch((err) => {
  console.error("Failed to generate og-image:", err);
  process.exit(1);
});
