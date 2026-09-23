/**
 * MonoRally Match Result Card Generator (1200x630)
 * High-resolution canvas rendering for social sharing, OpenGraph, and clipboard export.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const TIER_COLORS = {
  BRONZE: "#cd7f32",
  SILVER: "#c0c0c0",
  GOLD: "#ffd700",
  PLATINUM: "#00e5ff",
  DIAMOND: "#b9f2ff",
  MASTER: "#ff007f"
};

/**
 * Formats seconds into MM:SS format.
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

/**
 * Renders the match result card to a 2D canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Object} data Match details
 */
export function renderResultCard(canvas, data = {}) {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const outcome = (data.outcome || "VICTORY").toUpperCase();
  const isVictory = outcome.includes("VICTORY") || outcome.includes("WON");
  const isDefeat = outcome.includes("DEFEAT") || outcome.includes("LOST");
  const accentColor = isVictory ? "#00f0ff" : isDefeat ? "#ff3366" : "#ffd700";
  const modeText = (data.mode || "1v1").toUpperCase();
  const durationText = typeof data.duration === "number" ? formatDuration(data.duration) : (data.duration || "01:15");
  const siteUrl = data.siteUrl || "monorally.app";

  const player = data.player || {
    name: "Player 1",
    rankTier: "GOLD",
    elo: 1450,
    delta: "+24",
    misses: 0,
    missLimit: 5
  };

  const opponent = data.opponent || {
    name: "Opponent",
    rankTier: "SILVER",
    elo: 1380,
    delta: "-24",
    misses: 5,
    missLimit: 5
  };

  const stats = data.stats || {
    peakSpeed: 820,
    totalReturns: 38,
    skillShots: { smash: 3, curve: 2, counter: 1, drive: 4 }
  };

  // 1. Deep Space Cyberpunk Background
  const bgGrad = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bgGrad.addColorStop(0, "#080c14");
  bgGrad.addColorStop(0.5, "#0b1220");
  bgGrad.addColorStop(1, "#060910");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 2. Ambient Glow Spheres
  const radGlow1 = ctx.createRadialGradient(250, 150, 20, 250, 150, 450);
  radGlow1.addColorStop(0, isVictory ? "rgba(0, 240, 255, 0.12)" : "rgba(255, 51, 102, 0.12)");
  radGlow1.addColorStop(1, "transparent");
  ctx.fillStyle = radGlow1;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const radGlow2 = ctx.createRadialGradient(950, 480, 20, 950, 480, 400);
  radGlow2.addColorStop(0, "rgba(255, 215, 0, 0.08)");
  radGlow2.addColorStop(1, "transparent");
  ctx.fillStyle = radGlow2;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 3. Grid Lines (Isometric / Stadium Court)
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x <= CARD_WIDTH; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= CARD_HEIGHT; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CARD_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Outer Neon Cyber Border
  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, CARD_WIDTH - 40, CARD_HEIGHT - 40);

  // Corner Accent Brackets
  const cornerSize = 24;
  ctx.lineWidth = 4;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(20, 20 + cornerSize); ctx.lineTo(20, 20); ctx.lineTo(20 + cornerSize, 20);
  // Top-right
  ctx.moveTo(CARD_WIDTH - 20 - cornerSize, 20); ctx.lineTo(CARD_WIDTH - 20, 20); ctx.lineTo(CARD_WIDTH - 20, 20 + cornerSize);
  // Bottom-left
  ctx.moveTo(20, CARD_HEIGHT - 20 - cornerSize); ctx.lineTo(20, CARD_HEIGHT - 20); ctx.lineTo(20 + cornerSize, CARD_HEIGHT - 20);
  // Bottom-right
  ctx.moveTo(CARD_WIDTH - 20 - cornerSize, CARD_HEIGHT - 20); ctx.lineTo(CARD_WIDTH - 20, CARD_HEIGHT - 20); ctx.lineTo(CARD_WIDTH - 20, CARD_HEIGHT - 20 - cornerSize);
  ctx.stroke();
  ctx.restore();

  // 5. Header: Logo & Match Mode Tag
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 28px 'Segoe UI', system-ui, -apple-system, sans-serif";
  ctx.fillText("MONO/RALLY", 56, 72);

  // Cyber dot
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(245, 63, 6, 0, Math.PI * 2);
  ctx.fill();

  // Subtitle / Eyebrow
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("PRECISION MULTIPLAYER ARCADE", 265, 68);

  // Mode badge (top right)
  const modeBadgeText = `${modeText} · ${durationText}`;
  ctx.font = "700 14px 'Segoe UI', system-ui, sans-serif";
  const badgeWidth = ctx.measureText(modeBadgeText).width + 32;
  const badgeX = CARD_WIDTH - 56 - badgeWidth;
  const badgeY = 48;

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  roundRect(ctx, badgeX, badgeY, badgeWidth, 34, 17, true, true);

  ctx.fillStyle = "#ffffff";
  ctx.fillText(modeBadgeText, badgeX + 16, badgeY + 22);
  ctx.restore();

  // 6. Outcome Banner (Hero Display)
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "900 76px 'Segoe UI', system-ui, -apple-system, sans-serif";
  ctx.fillStyle = accentColor;
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = 24;
  ctx.fillText(outcome, CARD_WIDTH / 2, 175);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "600 16px 'Segoe UI', system-ui, sans-serif";
  const outcomeSub = isVictory
    ? "OUTSTANDING COURT DOMINANCE"
    : isDefeat
      ? "HARD-FOUGHT RALLY FINALE"
      : "EVENLY MATCHED CYBER CONTEST";
  ctx.fillText(outcomeSub, CARD_WIDTH / 2, 210);
  ctx.restore();

  // 7. Contestants Panel (Two Cards Side-by-Side with VS in center)
  const panelY = 245;
  const panelHeight = 160;
  const cardWidth = 470;
  const leftCardX = 60;
  const rightCardX = CARD_WIDTH - 60 - cardWidth;

  // Left Contestant (Player)
  drawPlayerCard(ctx, leftCardX, panelY, cardWidth, panelHeight, player, true, isVictory);

  // VS Badge in Center
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.arc(CARD_WIDTH / 2, panelY + panelHeight / 2, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 20px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("VS", CARD_WIDTH / 2, panelY + panelHeight / 2);
  ctx.restore();

  // Right Contestant (Opponent)
  drawPlayerCard(ctx, rightCardX, panelY, cardWidth, panelHeight, opponent, false, !isVictory && !outcome.includes("DRAW"));

  // 8. Stats Strip (4 Cards across bottom: Peak Speed, Total Returns, Skill Shots, Rank Division)
  const statsY = 430;
  const statsHeight = 110;
  const statCardWidth = 250;
  const gap = 26;
  const startX = (CARD_WIDTH - (4 * statCardWidth + 3 * gap)) / 2;

  // Stat 1: Peak Speed
  drawMetricCard(
    ctx,
    startX,
    statsY,
    statCardWidth,
    statsHeight,
    "PEAK SPEED",
    `${stats.peakSpeed || 0}`,
    "px/s",
    "#00f0ff"
  );

  // Stat 2: Total Returns
  drawMetricCard(
    ctx,
    startX + (statCardWidth + gap),
    statsY,
    statCardWidth,
    statsHeight,
    "RALLY RETURNS",
    `${stats.totalReturns || 0}`,
    "hits",
    "#ffd700"
  );

  // Stat 3: Signature Skill Shots
  const skillCount = stats.skillShots
    ? (stats.skillShots.smash || 0) + (stats.skillShots.curve || 0) + (stats.skillShots.counter || 0)
    : 0;
  drawMetricCard(
    ctx,
    startX + 2 * (statCardWidth + gap),
    statsY,
    statCardWidth,
    statsHeight,
    "SKILL SHOTS",
    `${skillCount}`,
    "smash/spin",
    "#ff3366"
  );

  // Stat 4: Tier / Rating
  drawMetricCard(
    ctx,
    startX + 3 * (statCardWidth + gap),
    statsY,
    statCardWidth,
    statsHeight,
    "RATING TIER",
    player.rankTier || "GOLD",
    `${player.elo || 1200} Elo`,
    TIER_COLORS[player.rankTier] || "#ffd700"
  );

  // 9. Footer: Discoverability Watermark
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("PLAY INSTANTLY IN BROWSER — NO INSTALL REQUIRED", 60, CARD_HEIGHT - 38);

  ctx.textAlign = "right";
  ctx.fillStyle = accentColor;
  ctx.font = "700 15px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(siteUrl, CARD_WIDTH - 60, CARD_HEIGHT - 38);
  ctx.restore();
}

/**
 * Draws a player card in the contestants panel.
 */
function drawPlayerCard(ctx, x, y, width, height, player, isSelf, isWinner) {
  ctx.save();
  ctx.fillStyle = isWinner ? "rgba(0, 240, 255, 0.08)" : "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = isWinner ? "rgba(0, 240, 255, 0.4)" : "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = isWinner ? 2 : 1;
  roundRect(ctx, x, y, width, height, 12, true, true);

  // Tier Pill
  const tierName = (player.rankTier || "SILVER").toUpperCase();
  const tierColor = TIER_COLORS[tierName] || "#ffd700";
  ctx.font = "800 12px 'Segoe UI', system-ui, sans-serif";
  const tierWidth = ctx.measureText(tierName).width + 20;

  ctx.fillStyle = tierColor;
  roundRect(ctx, x + 24, y + 20, tierWidth, 24, 12, true, false);
  ctx.fillStyle = "#000000";
  ctx.fillText(tierName, x + 34, y + 36);

  // Player Name
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 24px 'Segoe UI', system-ui, sans-serif";
  const displayName = player.name ? (player.name.length > 15 ? player.name.slice(0, 14) + "…" : player.name) : "Player";
  ctx.fillText(displayName, x + 24, y + 80);

  // Rating and Delta
  const deltaStr = player.delta ? ` (${player.delta})` : "";
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.font = "600 15px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${player.elo || 1200} Elo${deltaStr}`, x + 24, y + 108);

  // Misses Score (Right side of card)
  ctx.textAlign = "right";
  ctx.fillStyle = isWinner ? "#00f0ff" : "rgba(255, 255, 255, 0.4)";
  ctx.font = "900 48px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`${player.misses ?? 0}`, x + width - 28, y + 78);

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`/ ${player.missLimit || 5} MISSES`, x + width - 28, y + 105);

  if (isWinner) {
    ctx.fillStyle = "#00f0ff";
    ctx.font = "800 13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("★ WINNER", x + width - 28, y + 36);
  }
  ctx.restore();
}

/**
 * Draws a highlighted metric card.
 */
function drawMetricCard(ctx, x, y, width, height, title, value, unit, accent) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 10, true, true);

  // Accent line top
  ctx.fillStyle = accent;
  ctx.fillRect(x + 16, y, 36, 3);

  // Title
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "700 11px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(title, x + 18, y + 30);

  // Value
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 32px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(value, x + 18, y + 72);

  // Unit
  const valWidth = ctx.measureText(value).width;
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(unit, x + 24 + valWidth, y + 72);
  ctx.restore();
}

/**
 * Helper to draw rounded rectangles.
 */
function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

/**
 * Convert canvas to Blob Promise.
 */
export function canvasToBlob(canvas, type = "image/png", quality = 0.95) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } else {
      resolve(null);
    }
  });
}

/**
 * Copy result card image to clipboard.
 */
export async function copyCardImageToClipboard(canvas) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Clipboard Image API not supported");
  }
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error("Failed to generate image blob");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  return true;
}

/**
 * Trigger download of canvas as PNG.
 */
export function downloadCardImage(canvas, filename = `monorally-match-${Date.now()}.png`) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Share result card via Web Share API or copy text fallback.
 */
export async function shareResultCard(canvas, shareData = {}) {
  const blob = await canvasToBlob(canvas);
  if (blob && navigator.canShare && navigator.share) {
    const file = new File([blob], `monorally-result.png`, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: shareData.title || "MonoRally Match Result",
        text: shareData.text || "Check out my match result on MonoRally!",
        url: shareData.url || window.location.origin
      });
      return "shared_file";
    }
  }

  if (navigator.share) {
    await navigator.share({
      title: shareData.title || "MonoRally Match Result",
      text: shareData.text || "Check out my match result on MonoRally!",
      url: shareData.url || window.location.origin
    });
    return "shared_link";
  }

  // Fallback to clipboard text
  if (navigator.clipboard?.writeText) {
    const text = `${shareData.title || "MonoRally Match Result"}\n${shareData.text || ""}\n${shareData.url || window.location.origin}`;
    await navigator.clipboard.writeText(text);
    return "copied_text";
  }

  return "fallback";
}
