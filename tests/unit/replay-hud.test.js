import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayHudController } from "../../client/src/replay/replay-hud.js";
import { createCourtViewport } from "../../client/src/rendering/viewport.js";

describe("Replay HUD & Interactive Controls", () => {
  let mockStorage = {};
  const origSessionStorage = globalThis.sessionStorage;
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  let bodyClasses = new Set();
  const windowListeners = {};

  beforeEach(() => {
    mockStorage = {};
    bodyClasses = new Set();
    globalThis.sessionStorage = {
      getItem: (k) => mockStorage[k] ?? null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    };
    globalThis.window = {
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
      addEventListener: (t, fn) => {
        if (!windowListeners[t]) windowListeners[t] = [];
        windowListeners[t].push(fn);
      },
      removeEventListener: (t, fn) => {
        if (windowListeners[t]) windowListeners[t] = windowListeners[t].filter((f) => f !== fn);
      }
    };
    globalThis.document = {
      body: {
        classList: {
          add: (...cls) => cls.forEach((c) => bodyClasses.add(c)),
          remove: (...cls) => cls.forEach((c) => bodyClasses.delete(c)),
          toggle: (c, force) => {
            if (force === undefined) {
              if (bodyClasses.has(c)) bodyClasses.delete(c);
              else bodyClasses.add(c);
            } else if (force) bodyClasses.add(c);
            else bodyClasses.delete(c);
          },
          contains: (c) => bodyClasses.has(c)
        }
      },
      documentElement: {
        style: {
          setProperty: vi.fn()
        }
      },
      querySelector: () => null
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = origSessionStorage;
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  });

  function createMockElement(id = "", classList = []) {
    const classes = new Set(classList);
    const listeners = {};
    return {
      id,
      style: {},
      classList: {
        add: (...cls) => cls.forEach((c) => classes.add(c)),
        remove: (...cls) => cls.forEach((c) => classes.delete(c)),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (force) classes.add(c);
          else classes.delete(c);
        },
        contains: (c) => classes.has(c)
      },
      addEventListener: (type, fn) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
      },
      dispatchEvent: (e) => {
        (listeners[e.type] || []).forEach((fn) => fn(e));
      },
      getBoundingClientRect: () => ({
        left: 100,
        top: 500,
        width: 400,
        height: 60,
        right: 500,
        bottom: 560
      }),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      setAttribute: vi.fn()
    };
  }

  it("detaches and clamps coordinates during pointer drag", () => {
    const hudEl = createMockElement("replayHud");
    const controlsEl = createMockElement("replayControls");
    const dragHandleEl = createMockElement("replayDragHandle");
    const minimizeBtn = createMockElement("replayMinimizeBtn");
    const dockBtn = createMockElement("replayDockBtn", ["hidden"]);
    const courtEl = createMockElement("court");

    const player = { status: "playing", subscribe: vi.fn() };

    const controller = new ReplayHudController({
      hudEl,
      controlsEl,
      dragHandleEl,
      minimizeBtn,
      dockBtn,
      courtEl,
      replayPlayer: player
    });

    // Start drag
    dragHandleEl.dispatchEvent({ type: "pointerdown", button: 0, clientX: 120, clientY: 510, pointerId: 1 });
    expect(controller.isDragging).toBe(true);
    expect(controlsEl.classList.contains("is-dragging")).toBe(true);

    // Drag move to (300, 200)
    controller.onPointerMove({ clientX: 300, clientY: 200 });
    expect(controller.isDetached).toBe(true);
    expect(controlsEl.classList.contains("is-detached")).toBe(true);
    expect(dockBtn.classList.contains("hidden")).toBe(false);
    expect(controlsEl.style.position).toBe("fixed");
    expect(controlsEl.style.left).toBe("280px");
    expect(controlsEl.style.top).toBe("190px");

    // Pointer up completes drag and saves to sessionStorage
    controller.onPointerUp({ pointerId: 1 });
    expect(controller.isDragging).toBe(false);
    expect(controlsEl.classList.contains("is-dragging")).toBe(false);
    expect(mockStorage["monorally_replay_ctrl_pos"]).toBeDefined();
  });

  it("resets to docked position when dock button is clicked", () => {
    const hudEl = createMockElement("replayHud");
    const controlsEl = createMockElement("replayControls");
    const dragHandleEl = createMockElement("replayDragHandle");
    const minimizeBtn = createMockElement("replayMinimizeBtn");
    const dockBtn = createMockElement("replayDockBtn");
    const courtEl = createMockElement("court");

    const controller = new ReplayHudController({
      hudEl,
      controlsEl,
      dragHandleEl,
      minimizeBtn,
      dockBtn,
      courtEl,
      replayPlayer: null
    });

    // Manually simulate detached state
    controller.isDetached = true;
    controlsEl.classList.add("is-detached");
    controlsEl.style.position = "fixed";
    controlsEl.style.left = "200px";

    controller.resetDock();
    expect(controller.isDetached).toBe(false);
    expect(controlsEl.classList.contains("is-detached")).toBe(false);
    expect(controlsEl.style.position).toBe("");
    expect(controlsEl.style.left).toBe("");
    expect(dockBtn.classList.contains("hidden")).toBe(true);
    expect(mockStorage["monorally_replay_ctrl_pos"]).toBeUndefined();
  });

  it("toggles minimize mode cleanly", () => {
    const hudEl = createMockElement("replayHud");
    const controlsEl = createMockElement("replayControls");
    const dragHandleEl = createMockElement("replayDragHandle");
    const minimizeBtn = createMockElement("replayMinimizeBtn");
    const dockBtn = createMockElement("replayDockBtn");

    const controller = new ReplayHudController({
      hudEl,
      controlsEl,
      dragHandleEl,
      minimizeBtn,
      dockBtn,
      courtEl: null,
      replayPlayer: null
    });

    controller.toggleMinimize();
    expect(controller.isMinimized).toBe(true);
    expect(controlsEl.classList.contains("minimized")).toBe(true);
    expect(minimizeBtn.textContent).toBe("⤒");

    controller.toggleMinimize();
    expect(controller.isMinimized).toBe(false);
    expect(controlsEl.classList.contains("minimized")).toBe(false);
    expect(minimizeBtn.textContent).toBe("⤓");
  });

  it("toggles controls visibility on canvas tap", () => {
    const hudEl = createMockElement("replayHud");
    const controlsEl = createMockElement("replayControls");

    const controller = new ReplayHudController({
      hudEl,
      controlsEl,
      dragHandleEl: null,
      minimizeBtn: null,
      dockBtn: null,
      courtEl: null,
      replayPlayer: null
    });

    controller.toggleControlsVisibility();
    expect(controller.isControlsHidden).toBe(true);
    expect(hudEl.classList.contains("controls-hidden")).toBe(true);

    controller.toggleControlsVisibility();
    expect(controller.isControlsHidden).toBe(false);
    expect(hudEl.classList.contains("controls-hidden")).toBe(false);
  });

  it("court viewport reserves vertical clearance in replay mode to protect paddles", () => {
    const ctx = {
      canvas: { width: 1000, height: 680 },
      imageSmoothingEnabled: true,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn()
    };

    // Simulate normal mode viewport
    document.body.classList.remove("is-replaying");
    const vpNormal = createCourtViewport(ctx, () => false);
    vpNormal.prepareCanvas(false);
    const normalY = vpNormal.viewport.y;
    const normalHeight = vpNormal.viewport.height;

    // Simulate replay mode viewport
    document.body.classList.add("is-replaying");
    const vpReplay = createCourtViewport(ctx, () => false);
    vpReplay.prepareCanvas(false);
    const replayY = vpReplay.viewport.y;
    const replayHeight = vpReplay.viewport.height;

    // In replay mode, the court top must be pushed down (safe top clearance)
    // and total height must leave room for bottom playback controls
    expect(replayY).toBeGreaterThanOrEqual(50);
    expect(replayHeight).toBeLessThan(normalHeight);

    document.body.classList.remove("is-replaying");
  });
});
