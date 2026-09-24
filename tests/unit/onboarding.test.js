import { describe, it, expect, beforeEach, vi } from "vitest";
import { OnboardingController, ONBOARDING_STEPS } from "../../client/src/game/onboarding.js";
import { tracker } from "../../client/src/analytics/tracker.js";

describe("OnboardingController (Session Zero)", () => {
  let onboarding;
  let trackedEvents;

  beforeEach(() => {
    trackedEvents = [];
    vi.spyOn(tracker, "track").mockImplementation((name, props) => trackedEvents.push({ name, props }));
    vi.spyOn(tracker, "trackFirst").mockImplementation((name, props) => trackedEvents.push({ name, props }));
    vi.spyOn(tracker, "markActivated").mockImplementation(() => {});

    onboarding = new OnboardingController();
  });

  it("starts in MOVEMENT step with appropriate cues and tracks start", () => {
    onboarding.start();
    expect(onboarding.isActive()).toBe(true);
    expect(onboarding.step).toBe(ONBOARDING_STEPS.MOVEMENT);
    expect(onboarding.cueText).toBe("MOVE YOUR PADDLE");

    expect(trackedEvents.some((e) => e.name === "onboarding_started")).toBe(true);
  });

  it("advances from MOVEMENT to FIRST_RETURN when player moves paddle", () => {
    onboarding.start();

    // Initial input sets baseline
    onboarding.handleInput(0.5, "touch");
    expect(onboarding.step).toBe(ONBOARDING_STEPS.MOVEMENT);

    // Delta > 0.05 triggers movement completion
    onboarding.handleInput(0.65, "touch");
    expect(onboarding.step).toBe(ONBOARDING_STEPS.FIRST_RETURN);
    expect(onboarding.cueText).toBe("HIT THE BALL");

    expect(trackedEvents.some((e) => e.name === "first_input")).toBe(true);
    expect(trackedEvents.some((e) => e.name === "onboarding_step" && e.props.step === 1)).toBe(true);
  });

  it("advances from FIRST_RETURN to SHOT_SHAPING on first contact", () => {
    onboarding.start();
    onboarding.handleInput(0.5);
    onboarding.handleInput(0.65); // Now at FIRST_RETURN

    onboarding.handleContact({ team: "bottom" }, {}, "standard");
    expect(onboarding.step).toBe(ONBOARDING_STEPS.SHOT_SHAPING);
    expect(onboarding.cueText).toBe("MOVE WHILE HITTING");

    expect(trackedEvents.some((e) => e.name === "first_return")).toBe(true);
    expect(trackedEvents.some((e) => e.name === "onboarding_step" && e.props.step === 2)).toBe(true);
  });

  it("advances to MATCH when a skill shot is executed", () => {
    onboarding.start();
    onboarding.handleInput(0.5);
    onboarding.handleInput(0.65);
    onboarding.handleContact({ team: "bottom" }, {}, "standard"); // Now at SHOT_SHAPING

    // Standard hit keeps them in SHOT_SHAPING
    onboarding.handleContact({ team: "bottom" }, {}, "standard");
    expect(onboarding.step).toBe(ONBOARDING_STEPS.SHOT_SHAPING);

    // Skill shot (e.g. drive or curve) advances to MATCH
    onboarding.handleContact({ team: "bottom" }, {}, "drive");
    expect(onboarding.step).toBe(ONBOARDING_STEPS.MATCH);

    expect(trackedEvents.some((e) => e.name === "first_skill_shot")).toBe(true);
    expect(trackedEvents.some((e) => e.name === "onboarding_step" && e.props.step === 3)).toBe(true);
  });

  it("handles skipping cleanly and marks player activated", () => {
    const onSkip = vi.fn();
    onboarding = new OnboardingController({ onSkip });
    onboarding.start();

    onboarding.skip();
    expect(onboarding.isActive()).toBe(false);
    expect(onboarding.step).toBe(ONBOARDING_STEPS.INACTIVE);
    expect(onSkip).toHaveBeenCalled();
    expect(trackedEvents.some((e) => e.name === "onboarding_skipped")).toBe(true);
  });
});
