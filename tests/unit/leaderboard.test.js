import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createLeaderboard } from "../../server/src/leaderboard.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("persistent leaderboard", () => {
  test("records human winners and keeps one personal best per handle", () => {
    const leaderboard = createLeaderboard(null);
    leaderboard.recordRoom(endedRoom({ durationSeconds: 75, names: ["steady-serve", "AI-1"], returns: 14 }));
    leaderboard.recordRoom(endedRoom({ durationSeconds: 42, names: ["steady-serve"], returns: 9 }));

    expect(leaderboard.top("1v1")).toEqual([
      expect.objectContaining({ name: "steady-serve", score: 14, duration: 75, mode: "1v1" })
    ]);
  });

  test("records both human teammates in a 2v2 win", () => {
    const leaderboard = createLeaderboard(null);
    leaderboard.recordRoom(endedRoom({ durationSeconds: 91, mode: "2v2", names: ["swift-orbit", "calm-vector"], returns: 22 }));

    expect(leaderboard.top("2v2")).toEqual([
      expect.objectContaining({ name: "calm-vector + swift-orbit", score: 22, duration: 91 })
    ]);
  });

  test("never publishes bot-only or zero-return wins", () => {
    const leaderboard = createLeaderboard(null);
    leaderboard.recordRoom(endedRoom({ durationSeconds: 40, names: ["AI-1"], returns: 12 }));
    leaderboard.recordRoom(endedRoom({ durationSeconds: 40, names: ["quiet-player"], returns: 0 }));

    expect(leaderboard.top("1v1")).toEqual([]);
  });

  test("survives a leaderboard process restart", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "monorally-board-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "leaderboard.json");
    const leaderboard = createLeaderboard(file);
    leaderboard.recordRoom(endedRoom({ durationSeconds: 123, names: ["bold-rally"], returns: 31 }));
    await leaderboard.flush();

    expect(createLeaderboard(file).top("1v1")).toEqual([
      expect.objectContaining({ name: "bold-rally", score: 31, duration: 123 })
    ]);
  });
});

function endedRoom({ durationSeconds, mode = "1v1", names, returns }) {
  return {
    status: "ended",
    winner: "bottom",
    mode,
    startedAt: 1000,
    endedAt: 1000 + durationSeconds * 1000,
    returns: { top: 0, bottom: returns },
    misses: { top: 5, bottom: 2 },
    leaderboardRecorded: false,
    players: names.map((name, index) => ({ name, team: "bottom", bot: name.startsWith("AI-"), returns: index === 0 ? returns : 0 }))
  };
}
