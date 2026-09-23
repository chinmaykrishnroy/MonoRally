import { describe, expect, it } from "vitest";
import { ReplayStore } from "../../client/src/replay/replay-store.js";

describe("ReplayStore", () => {
  it("saves, lists, and caps saved replays in local storage", () => {
    const memory = {};
    const mockStorage = {
      getItem: (k) => memory[k] || null,
      setItem: (k, v) => {
        memory[k] = String(v);
      },
      removeItem: (k) => {
        delete memory[k];
      }
    };

    const store = new ReplayStore(mockStorage);
    expect(store.getAll()).toEqual([]);

    for (let i = 1; i <= 7; i++) {
      store.save({
        id: `rly_${i}`,
        mode: "1v1",
        frames: [{ t: 0.1 }],
        startedAt: new Date().toISOString()
      });
    }

    const saved = store.getAll();
    expect(saved.length).toBe(5); // Capped at MAX_SAVED_REPLAYS (5)
    expect(saved[0].id).toBe("rly_7"); // Newest first
    expect(saved[4].id).toBe("rly_3"); // Oldest remaining
  });

  it("validates and imports replay JSON correctly", () => {
    const store = new ReplayStore(null);
    const validJson = JSON.stringify({
      id: "rly_custom_99",
      mode: "1v1",
      frames: [{ t: 0.1, balls: [] }]
    });

    const parsed = store.importJson(validJson);
    expect(parsed.id).toBe("rly_custom_99");
    expect(parsed.frames.length).toBe(1);

    expect(() => store.importJson("not-json")).toThrow();
    expect(() => store.importJson(JSON.stringify({ frames: [] }))).toThrow("no frame data");
  });
});
