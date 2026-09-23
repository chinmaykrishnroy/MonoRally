/**
 * MonoRally Replay Store
 * Handles client-side storage, indexing, and JSON export/import of match replays.
 */

const STORAGE_KEY = "monorally_replays_v1";
const MAX_SAVED_REPLAYS = 5;

export class ReplayStore {
  constructor(storage = typeof localStorage !== "undefined" ? localStorage : null) {
    this.storage = storage;
  }

  /**
   * Retrieves all saved replays (summaries only or full).
   */
  getAll() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Gets a single replay by ID.
   */
  getById(id) {
    const list = this.getAll();
    return list.find((r) => r.id === id) || null;
  }

  /**
   * Saves a completed replay, evicting the oldest if limit exceeded.
   */
  save(replay) {
    if (!replay || !replay.id || !Array.isArray(replay.frames)) return false;
    if (!this.storage) return false;

    const list = this.getAll();
    const filtered = list.filter((r) => r.id !== replay.id);
    filtered.unshift(replay);

    if (filtered.length > MAX_SAVED_REPLAYS) {
      filtered.splice(MAX_SAVED_REPLAYS);
    }

    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch {
      // Storage quota exceeded: remove half and retry
      try {
        filtered.splice(2);
        this.storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Deletes a replay by ID.
   */
  delete(id) {
    if (!this.storage) return;
    const list = this.getAll().filter((r) => r.id !== id);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  /**
   * Exports a replay as a downloadable JSON file.
   */
  exportJson(replay, filename) {
    if (!replay) return;
    const name = filename || `monorally-replay-${replay.mode || "match"}-${replay.id}.json`;
    const jsonStr = JSON.stringify(replay, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Parses and validates an imported replay JSON string.
   */
  importJson(jsonString) {
    try {
      const data = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
      if (!data || typeof data !== "object") throw new Error("Invalid replay format");
      if (!Array.isArray(data.frames) || data.frames.length === 0) {
        throw new Error("Replay contains no frame data");
      }
      if (!data.id) {
        data.id = `rly_import_${Date.now()}`;
      }
      return data;
    } catch (err) {
      throw new Error(`Failed to parse replay: ${err.message}`);
    }
  }
}

export const defaultReplayStore = new ReplayStore();
