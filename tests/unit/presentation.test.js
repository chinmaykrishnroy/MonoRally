import { describe, expect, test, vi } from "vitest";
import { presentationDelayMs } from "../../client/src/network/presentation.js";

describe("clock-scheduled impact presentation", () => {
  test("uses the synchronized future server timestamp as audio lead time", () => {
    const toLocalPerformance = vi.fn(() => 1090);

    const delay = presentationDelayMs({
      encodedTimestamp: 123,
      protocol: 4,
      synced: true,
      toLocalPerformance,
      now: 1035
    });

    expect(delay).toBe(55);
    expect(toLocalPerformance).toHaveBeenCalledWith(123);
  });

  test("plays immediately until the clock is synchronized", () => {
    expect(presentationDelayMs({
      encodedTimestamp: 123,
      protocol: 4,
      synced: false,
      toLocalPerformance: () => 1090,
      now: 1035
    })).toBe(0);
  });

  test("plays late packets immediately instead of adding another delay", () => {
    expect(presentationDelayMs({
      encodedTimestamp: 123,
      protocol: 4,
      synced: true,
      toLocalPerformance: () => 1000,
      now: 1035
    })).toBe(0);
  });

  test("different client clocks schedule the same server impact with equal lead time", () => {
    const first = presentationDelayMs({
      encodedTimestamp: 456,
      protocol: 4,
      synced: true,
      toLocalPerformance: () => 2050,
      now: 2000
    });
    const second = presentationDelayMs({
      encodedTimestamp: 456,
      protocol: 4,
      synced: true,
      toLocalPerformance: () => 8050,
      now: 8000
    });

    expect(first).toBe(50);
    expect(second).toBe(first);
  });
});
