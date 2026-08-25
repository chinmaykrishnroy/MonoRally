import { describe, expect, test } from "vitest";
import {
  bestClockEstimate,
  computeClockMeasurement,
  expandTimestamp32,
  validateClockProbePair
} from "../../client/src/network/clock-sync.js";

describe("NTP-style clock synchronization", () => {
  test("removes server processing time from RTT and estimates offset", () => {
    const measurement = computeClockMeasurement({ t0: 1000, t1: 1060, t2: 1065 }, 1115);

    expect(measurement.rtt).toBe(110);
    expect(measurement.offset).toBe(5);
  });

  test("uses the lowest-latency samples instead of queueing outliers", () => {
    const estimate = bestClockEstimate([
      { rtt: 280, offset: 80 },
      { rtt: 42, offset: 11 },
      { rtt: 48, offset: 12 },
      { rtt: 51, offset: 10 }
    ]);

    expect(estimate.rtt).toBe(42);
    expect(estimate.offset).toBe(11);
    expect(estimate.jitter).toBe(2);
  });

  test("expands wrapped 32-bit timestamps near the reference epoch", () => {
    const reference = 0x100000000 + 25;
    expect(expandTimestamp32(10, reference)).toBe(0x100000000 + 10);
  });

  test("accepts a pure probe pair and keeps its lowest RTT sample", () => {
    const first = { groupId: 4, t0: 1000, t1: 1020, rtt: 48, offset: 1 };
    const second = { groupId: 4, t0: 1040, t1: 1063, rtt: 44, offset: 2 };

    expect(validateClockProbePair(first, second)).toBe(second);
  });

  test("rejects a probe pair distorted by queueing", () => {
    const first = { groupId: 5, t0: 1000, t1: 1020, rtt: 45, offset: 1 };
    const second = { groupId: 5, t0: 1040, t1: 1095, rtt: 80, offset: 14 };

    expect(validateClockProbePair(first, second)).toBeNull();
  });

  test("measures an arbitrary server offset under symmetric delay", () => {
    const serverOffset = 137;
    const outboundDelay = 32;
    const inboundDelay = 32;
    const t0 = 10_000;
    const t1 = t0 + outboundDelay + serverOffset;
    const t2 = t1 + 3;
    const t3 = t0 + outboundDelay + 3 + inboundDelay;

    const measurement = computeClockMeasurement({ t0, t1, t2 }, t3);
    expect(measurement.rtt).toBe(outboundDelay + inboundDelay);
    expect(measurement.offset).toBe(serverOffset);
  });

  test("exposes the unavoidable half-path bias under asymmetric delay", () => {
    const measurement = computeClockMeasurement({ t0: 1000, t1: 1020, t2: 1020 }, 1100);

    expect(measurement.rtt).toBe(100);
    expect(measurement.offset).toBe(-30);
  });
});
