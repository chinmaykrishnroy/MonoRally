import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  calculateAchievements,
  createDefaultProfile,
  loadLocalProfile,
  saveLocalProfile
} from "../../client/src/core/profile.js";
import { createProfileUi } from "../../client/src/ui/profile-ui.js";

describe("client player profile and UI", () => {
  let mockStorage = {};
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    mockStorage = {};
    globalThis.localStorage = {
      getItem: (key) => mockStorage[key] ?? null,
      setItem: (key, val) => {
        mockStorage[key] = String(val);
      }
    };
    globalThis.document = {
      createElement: (tag) => ({
        tagName: tag,
        className: "",
        setAttribute() {},
        appendChild() {},
        innerHTML: ""
      }),
      querySelectorAll: () => []
    };
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
  });

  test("generates valid default profile with Silver rank and zero stats", () => {
    const profile = createDefaultProfile();
    expect(profile.id).toBeTruthy();
    expect(profile.handle).toMatch(/^[a-z]+-[a-z]+$/);
    expect(profile.eloRating).toBe(1200);
    expect(profile.peakRating).toBe(1200);
    expect(profile.matchesPlayed).toBe(0);
    expect(profile.wins).toBe(0);
    expect(profile.losses).toBe(0);
    expect(profile.rankTier.tier).toBe("Silver");
  });

  test("persists and reloads profile from local storage", () => {
    const fresh = createDefaultProfile();
    fresh.handle = "AceRally";
    fresh.eloRating = 1450;
    saveLocalProfile(fresh);

    const loaded = loadLocalProfile();
    expect(loaded.id).toBe(fresh.id);
    expect(loaded.handle).toBe("AceRally");
    expect(loaded.eloRating).toBe(1450);
  });

  test("calculates progression achievements according to player stats", () => {
    const beginner = createDefaultProfile();
    const beginnerAch = calculateAchievements(beginner);
    expect(beginnerAch.every((a) => !a.unlocked)).toBe(true);

    const veteran = {
      ...createDefaultProfile(),
      matchesPlayed: 10,
      wins: 7,
      eloRating: 1450,
      peakRating: 1480,
      bestStreak: 4,
      peakSpeed: 890,
      smashCount: 15,
      curveCount: 8,
      counterCount: 12
    };

    const veteranAch = calculateAchievements(veteran);
    const unlockedMap = Object.fromEntries(veteranAch.map((a) => [a.id, a.unlocked]));

    expect(unlockedMap.first_blood).toBe(true);
    expect(unlockedMap.centurion).toBe(true);
    expect(unlockedMap.gold_standard).toBe(true);
    expect(unlockedMap.streak_master).toBe(true);
    expect(unlockedMap.sonic_boomer).toBe(true);
    expect(unlockedMap.smash_specialist).toBe(true);
  });

  test("profile UI renders modal elements and opens/closes cleanly", async () => {
    const domNodes = {};
    const getOrCreate = (id) => {
      if (!domNodes[id]) {
        domNodes[id] = {
          id,
          textContent: "",
          innerHTML: "",
          style: {},
          classList: {
            classes: new Set(["hidden"]),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
          },
          setAttribute() {},
          appendChild() {},
          querySelector() { return null; }
        };
      }
      return domNodes[id];
    };

    const elements = {
      $: (id) => getOrCreate(id),
      profileBtn: { addEventListener() {} },
      profileModal: getOrCreate("profileModal"),
      overlay: getOrCreate("overlay")
    };

    const state = {};
    const ui = createProfileUi({ elements, state });
    expect(ui.getProfile()).toBeTruthy();

    await ui.openProfile();
    expect(elements.profileModal.classList.contains("hidden")).toBe(false);
    expect(elements.overlay.classList.contains("hidden")).toBe(false);

    ui.closeProfile();
    expect(elements.profileModal.classList.contains("hidden")).toBe(true);
  });
});
