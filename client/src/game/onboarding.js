/**
 * Interactive In-Game Onboarding Controller (Session Zero).
 * Teaches mechanics directly on court through gameplay, not modals.
 */

import { tracker } from "../analytics/tracker.js";

export const ONBOARDING_STEPS = {
  INACTIVE: 0,
  MOVEMENT: 1,
  FIRST_RETURN: 2,
  SHOT_SHAPING: 3,
  MATCH: 4,
  COMPLETED: 5
};

export class OnboardingController {
  constructor({ onComplete, onSkip, onCueChange } = {}) {
    this.step = ONBOARDING_STEPS.INACTIVE;
    this.active = false;
    this.initialInputX = null;
    this.stepTimer = 0;
    this.celebrationText = "";
    this.celebrationUntil = 0;
    this.cueText = "";
    this.cueSubtext = "";
    this.onComplete = onComplete;
    this.onSkip = onSkip;
    this.onCueChange = onCueChange;
  }

  start() {
    this.active = true;
    this.step = ONBOARDING_STEPS.MOVEMENT;
    this.initialInputX = null;
    this.celebrationText = "";
    this.celebrationUntil = 0;
    this.updateCue(
      "MOVE YOUR PADDLE",
      "Drag lower screen, use A / D, or Arrow Keys"
    );
    tracker.track("onboarding_started");
  }

  updateCue(text, subtext = "") {
    this.cueText = text;
    this.cueSubtext = subtext;
    this.onCueChange?.({ text, subtext, step: this.step });
  }

  celebrate(text, durationMs = 1800) {
    this.celebrationText = text;
    this.celebrationUntil = performance.now() + durationMs;
  }

  /**
   * Called on every game frame or input update with player's current inputX.
   * @param {number} inputX Normalized paddle target position [0, 1]
   */
  handleInput(inputX, inputMethod = "touch") {
    if (!this.active || this.step !== ONBOARDING_STEPS.MOVEMENT) return;

    if (this.initialInputX === null) {
      this.initialInputX = inputX;
      return;
    }

    const delta = Math.abs(inputX - this.initialInputX);
    if (delta > 0.05) {
      tracker.setInputMethod(inputMethod);
      tracker.trackFirst("first_input", { method: inputMethod });
      tracker.track("onboarding_step", { step: 1, name: "movement" });
      this.celebrate("LOCKED IN!", 1200);

      this.step = ONBOARDING_STEPS.FIRST_RETURN;
      this.updateCue(
        "HIT THE BALL",
        "Position your paddle to return the serve"
      );
    }
  }

  /**
   * Called when a ball makes contact with a player's paddle.
   * @param {Object} player
   * @param {Object} ball
   * @param {string} shotType ('standard', 'drive', 'curve', 'smash', 'counter')
   */
  handleContact(player, ball, shotType = "standard") {
    if (!this.active) return;
    if (player.team !== "bottom") return; // Only track human player hits

    tracker.trackFirst("first_ball_contact", { shotType });
    tracker.trackFirst("first_return", { shotType });

    if (this.step === ONBOARDING_STEPS.FIRST_RETURN) {
      this.celebrate("NICE RETURN!", 1600);
      tracker.track("onboarding_step", { step: 2, name: "first_return", shotType });

      this.step = ONBOARDING_STEPS.SHOT_SHAPING;
      this.updateCue(
        "MOVE WHILE HITTING",
        "Slice edge for CURVE · Push with speed for DRIVE"
      );
      return;
    }

    if (this.step === ONBOARDING_STEPS.SHOT_SHAPING) {
      const isSkillShot = shotType !== "standard";
      if (isSkillShot) {
        tracker.trackFirst("first_skill_shot", { shotType });
        tracker.track("onboarding_step", { step: 3, name: "shot_shaping", shotType });
        this.celebrate(`${shotType.toUpperCase()}!`, 2000);

        this.step = ONBOARDING_STEPS.MATCH;
        this.updateCue(
          "SESSION ZERO RALLY",
          "You've got the basics! Win the rally"
        );
      } else {
        this.celebrate("GOOD! NOW HIT WITH PADDLE MOTION", 1400);
      }
    }
  }

  /**
   * Called when the rally or match completes.
   */
  handleMatchEnded(winner) {
    if (!this.active) return;
    this.complete(winner === "bottom");
  }

  complete(won = true) {
    if (!this.active) return;
    this.active = false;
    this.step = ONBOARDING_STEPS.COMPLETED;
    tracker.markActivated();
    tracker.track("onboarding_completed", { won });
    this.celebrate(won ? "VICTORY! YOU'RE READY" : "GREAT RALLY! YOU'RE READY", 2400);
    this.updateCue("");
    this.onComplete?.({ won });
  }

  skip() {
    if (!this.active) return;
    const previousStep = this.step;
    this.active = false;
    this.step = ONBOARDING_STEPS.INACTIVE;
    tracker.markActivated();
    tracker.track("onboarding_skipped", { atStep: previousStep });
    this.updateCue("");
    this.onSkip?.();
  }

  isActive() {
    return this.active;
  }

  getRenderState() {
    const now = performance.now();
    return {
      active: this.active,
      step: this.step,
      cueText: this.cueText,
      cueSubtext: this.cueSubtext,
      celebration: now < this.celebrationUntil ? this.celebrationText : null
    };
  }
}
