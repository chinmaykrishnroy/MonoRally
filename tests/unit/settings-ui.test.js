import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SETTINGS_KEY, config, settings } from "../../client/src/core/shared.js";
import { createSettingsUi } from "../../client/src/ui/settings-ui.js";

describe("settings UI and themes", () => {
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
      body: {
        classList: {
          add() {},
          remove() {}
        }
      },
      documentElement: {
        dataset: {}
      }
    };
    settings.theme = "cyan";
    settings.highContrast = false;
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
  });

  test("loads and saves theme and high contrast settings", () => {
    const elements = {
      aiDifficulty: { value: "medium" },
      bottomControlInput: { checked: true },
      highContrastInput: { checked: false },
      infoModal: { classList: { toggle() {} } },
      nameInput: { value: "pilot" },
      overlay: { classList: { remove() {}, add() {} } },
      quick1: { classList: { toggle() {} } },
      quick2: { classList: { toggle() {} } },
      quickStatus: { textContent: "" },
      renderDelayInput: { value: "25" },
      settingsModal: { classList: { toggle() {} } },
      settingsName: { value: "pilot" },
      soundInput: { checked: true },
      themeSelect: { value: "cyan" }
    };
    const state = { quickMode: "1v1", renderDelay: 25 };
    const ui = createSettingsUi({ elements, state });

    settings.theme = "emerald";
    settings.highContrast = true;
    ui.saveSettings();

    expect(globalThis.document.documentElement.dataset.theme).toBe("emerald");
    expect(globalThis.document.documentElement.dataset.contrast).toBe("high");

    const saved = JSON.parse(mockStorage[SETTINGS_KEY]);
    expect(saved.theme).toBe("emerald");
    expect(saved.highContrast).toBe(true);

    settings.theme = "cyan";
    settings.highContrast = false;
    ui.loadSettings();

    expect(settings.theme).toBe("emerald");
    expect(settings.highContrast).toBe(true);
    expect(elements.themeSelect.value).toBe("emerald");
    expect(elements.highContrastInput.checked).toBe(true);
    expect(globalThis.document.documentElement.dataset.theme).toBe("emerald");
    expect(globalThis.document.documentElement.dataset.contrast).toBe("high");
  });
});
