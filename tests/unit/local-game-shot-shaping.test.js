import { describe, it, expect } from "vitest";
import { classifyShot, LocalGame } from "../../client/src/game/local-game.js";
import { W, H } from "../../client/src/core/shared.js";

describe("LocalGame Shot Classification & Physics", () => {
  it("classifies standard centered hit with moderate speed as standard or drive", () => {
    const player = { team: "bottom", laserActiveUntil: 0 };
    const ball = { vx: 0, vy: -430, speed: 430 };
    const shot = classifyShot(player, ball, 0, W / 2, W / 2, 140, 10);
    expect(["standard", "drive"]).toContain(shot);
  });

  it("classifies rapid paddle acceleration as smash", () => {
    const player = { team: "bottom", laserActiveUntil: 0 };
    const ball = { vx: 0, vy: -430, speed: 430 };
    // absPaddleSpeed >= 1100 and offset <= 0.38
    const shot = classifyShot(player, ball, 1500, W / 2 + 10, W / 2, 140, 10);
    expect(shot).toBe("smash");
  });

  it("classifies outer edge slicing hit with paddle movement as curve", () => {
    const player = { team: "bottom", laserActiveUntil: 0 };
    const ball = { vx: 0, vy: -430, speed: 430 };
    // absOffset >= 0.52 (offset = (50)/70 = ~0.71) and paddleSpeed >= 380
    const shot = classifyShot(player, ball, 450, W / 2 + 50, W / 2, 140, 10);
    expect(shot).toBe("curve");
  });

  it("classifies parry opposite to incoming ball as counter", () => {
    const player = { team: "bottom", laserActiveUntil: 0 };
    const ball = { vx: 300, vy: -500, speed: 580 };
    // paddle moving left (negative vx), ball moving right (positive vx)
    const shot = classifyShot(player, ball, -400, W / 2, W / 2, 140, 10);
    expect(shot).toBe("counter");
  });

  it("invokes onContact callback when ball collides with player paddle in LocalGame", () => {
    let contacted = null;
    const game = new LocalGame({
      getInputX: () => 0.5,
      hitEffect: () => {},
      playMiss: () => {},
      playPower: () => {},
      playStrike: () => {},
      playWall: () => {},
      onContact: (player, ball, shotType) => {
        contacted = { player, shotType };
      }
    });

    const ball = {
      id: 1,
      x: W / 2,
      y: H - 35,
      prevX: W / 2,
      prevY: H - 55,
      r: 8,
      vx: 0,
      vy: 430,
      speed: 430,
      bump: false
    };

    game.balls = [ball];
    game.collide(game.players[0], ball);

    expect(contacted).not.toBeNull();
    expect(contacted.player.team).toBe("bottom");
    expect(typeof contacted.shotType).toBe("string");
  });
});
