import { describe, expect, it, vi } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  formatDuration,
  renderResultCard
} from "../../client/src/sharing/result-card.js";

describe("result-card generator", () => {
  it("formats match durations into MM:SS correctly", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(45)).toBe("00:45");
    expect(formatDuration(84)).toBe("01:24");
    expect(formatDuration(3605)).toBe("60:05");
  });

  it("renders result card on mock 2D canvas with correct dimensions and theme", () => {
    const mockGradient = { addColorStop: vi.fn() };
    const mockCtx = {
      createLinearGradient: vi.fn(() => mockGradient),
      createRadialGradient: vi.fn(() => mockGradient),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      arc: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text) => ({ width: text.length * 10 })),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "",
      textBaseline: "",
      shadowColor: "",
      shadowBlur: 0
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx)
    };

    const matchData = {
      outcome: "VICTORY",
      mode: "1v1",
      duration: 75,
      player: {
        name: "swift-orbit",
        rankTier: "GOLD",
        elo: 1450,
        delta: "+24",
        misses: 1,
        missLimit: 5
      },
      opponent: {
        name: "cyber-blade",
        rankTier: "SILVER",
        elo: 1380,
        delta: "-24",
        misses: 5,
        missLimit: 5
      },
      stats: {
        peakSpeed: 890,
        totalReturns: 45,
        skillShots: { smash: 4, curve: 3, counter: 2, drive: 5 }
      },
      siteUrl: "monorally.app"
    };

    renderResultCard(mockCanvas, matchData);

    expect(mockCanvas.width).toBe(CARD_WIDTH);
    expect(mockCanvas.height).toBe(CARD_HEIGHT);
    expect(mockCanvas.getContext).toHaveBeenCalledWith("2d");
    expect(mockCtx.fillRect).toHaveBeenCalled();

    // Verify key text elements were rendered
    const textCalls = mockCtx.fillText.mock.calls.map((c) => c[0]);
    expect(textCalls).toContain("MONO/RALLY");
    expect(textCalls).toContain("VICTORY");
    expect(textCalls).toContain("swift-orbit");
    expect(textCalls).toContain("cyber-blade");
    expect(textCalls).toContain("890");
    expect(textCalls).toContain("45");
  });
});
