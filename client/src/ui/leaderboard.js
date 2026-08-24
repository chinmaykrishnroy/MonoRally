export function createLeaderboardUi(roots) {
  async function refresh() {
    if (!roots?.one || !roots?.two) return;
    try {
      const response = await fetch("/leaderboard.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      render(roots.one, payload.boards?.["1v1"] || []);
      render(roots.two, payload.boards?.["2v2"] || []);
    } catch {
      renderError(roots.one);
      renderError(roots.two);
    }
  }

  function render(root, entries) {
    if (!entries.length) {
      root.innerHTML = '<p class="leaderboardEmpty">The first record is waiting.</p>';
      return;
    }
    root.replaceChildren(...entries.slice(0, 10).map(renderEntry));
  }

  function renderEntry(entry, index) {
    const row = document.createElement("div");
    row.className = "leaderboardRow";
    const rank = document.createElement("span");
    rank.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("strong");
    name.textContent = String(entry.name || "player");
    const score = document.createElement("time");
    score.textContent = `${Number(entry.score) || 0} · ${formatTime(Number(entry.duration) || 0)}`;
    score.title = `${entry.score || 0} successful returns, ${entry.misses || 0} misses, ${formatTime(entry.duration || 0)} played`;
    row.append(rank, name, score);
    return row;
  }

  return { refresh };
}

function renderError(root) {
  root.innerHTML = '<p class="leaderboardEmpty">Records unavailable</p>';
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
