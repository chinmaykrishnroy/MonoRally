import fs from "node:fs";
import path from "node:path";

const MAX_STORED_ENTRIES = 100;

export function createLeaderboard(filePath) {
  let entries = loadEntries(filePath);
  let writeChain = Promise.resolve();

  function top(mode, limit = 3) {
    return [...entries]
      .filter((entry) => !mode || entry.mode === mode)
      .sort(compareEntries)
      .slice(0, Math.max(0, limit));
  }

  function recordRoom(room) {
    if (!room || room.leaderboardRecorded || room.status !== "ended" || !room.winner || !room.startedAt) return false;
    room.leaderboardRecorded = true;
    const duration = Math.max(1, Math.floor(((room.endedAt || performance.now()) - room.startedAt) / 1000));
    const winners = room.players.filter((player) => player.team === room.winner && !player.bot);
    if (!winners.length) return false;
    const score = winners.reduce((total, player) => total + Math.max(0, Number(player.returns) || 0), 0);
    if (score === 0) return false;
    const misses = Math.max(0, Number(room.misses?.[room.winner]) || 0);
    const handles = winners.map((player) => String(player.name || "player").slice(0, 18)).sort((a, b) => a.localeCompare(b));
    const name = room.mode === "2v2" ? handles.join(" + ") : handles[0];
    const key = `${room.mode}:${handles.map((handle) => handle.toLocaleLowerCase("en-US")).join("+")}`;
    const existing = entries.find((entry) => entry.key === key);
    let changed = false;
    const next = { key, name, score, misses, duration, mode: room.mode, achievedAt: new Date().toISOString() };
    if (!existing || compareEntries(next, existing) < 0) {
      if (existing) Object.assign(existing, next);
      else entries.push(next);
      changed = true;
    }

    if (changed) {
      entries = entries.sort(compareEntries).slice(0, MAX_STORED_ENTRIES);
      persist();
    }
    return changed;
  }

  function persist() {
    if (!filePath) return;
    const snapshot = JSON.stringify({ version: 2, entries }, null, 2);
    writeChain = writeChain
      .then(async () => {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp`;
        await fs.promises.writeFile(temporary, snapshot, "utf8");
        await fs.promises.rename(temporary, filePath);
      })
      .catch((error) => console.error(`Leaderboard persistence failed: ${error.message}`));
  }

  return { flush: () => writeChain, recordRoom, top };
}

function loadEntries(filePath) {
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(validEntry).slice(0, MAX_STORED_ENTRIES);
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Leaderboard load failed: ${error.message}`);
    return [];
  }
}

function validEntry(entry) {
  return (
    entry &&
    typeof entry.key === "string" &&
    typeof entry.name === "string" &&
    Number.isInteger(entry.score) &&
    entry.score > 0 &&
    Number.isInteger(entry.misses) &&
    entry.misses >= 0 &&
    Number.isInteger(entry.duration) &&
    entry.duration > 0 &&
    ["1v1", "2v2"].includes(entry.mode)
  );
}

function compareEntries(a, b) {
  return b.score - a.score || a.misses - b.misses || b.duration - a.duration || a.name.localeCompare(b.name);
}
