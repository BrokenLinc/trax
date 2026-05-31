import { describe, expect, it } from 'vitest';
import { PlayerController } from '../src/player/controller.ts';
import { createPlayerState } from '../src/player/state.ts';

const baseParams = {
  accel: 1,
  decel: 1,
  friction: 0,
  maxSpeed: 10,
  strafeSpeedFactor: 1,
  strafeAccel: 1e6,
  driftFactor: 0,
};

const noSlopeChange = 0;

describe('PlayerController strafe', () => {
  const bounds = { minX: -10, maxX: 10 };

  it('does not move lateralX when speed is zero', () => {
    const c = new PlayerController(baseParams);
    c.strafeRight = true;
    const player = createPlayerState({ speed: 0, lateralX: 0 });
    c.update(player, 1, bounds, 4, noSlopeChange);
    expect(player.lateralX).toBe(0);
    expect(player.lateralSpeed).toBe(0);
  });

  it('clamps lateralX to mesh bounds', () => {
    const c = new PlayerController(baseParams);
    c.strafeRight = true;
    const player = createPlayerState({ speed: 5, lateralX: 9 });
    c.update(player, 1, bounds, 4, noSlopeChange);
    expect(player.lateralX).toBe(10);
  });

  it('ramps lateralSpeed below max on the first frame', () => {
    const c = new PlayerController({
      ...baseParams,
      strafeAccel: 10,
    });
    c.strafeRight = true;
    const player = createPlayerState({ speed: 5, lateralX: 0 });
    const rowSpacing = 4;
    const dt = 0.1;
    const maxStrafe = baseParams.strafeSpeedFactor * Math.abs(player.speed) * rowSpacing;

    c.update(player, dt, bounds, rowSpacing, noSlopeChange);

    expect(player.lateralSpeed).toBeCloseTo(1, 5);
    expect(player.lateralSpeed).toBeLessThan(maxStrafe);
    expect(player.lateralX).toBeCloseTo(0.1, 5);
    expect(player.lateralX).toBeLessThan(maxStrafe * dt);
  });

  it('decelerates lateralSpeed toward zero when strafe keys are released', () => {
    const c = new PlayerController({
      ...baseParams,
      strafeAccel: 10,
    });
    c.strafeRight = true;
    const player = createPlayerState({ speed: 5, lateralX: 0 });
    c.update(player, 0.5, bounds, 4, noSlopeChange);
    expect(player.lateralSpeed).toBeGreaterThan(0);

    c.strafeRight = false;
    c.update(player, 0.2, bounds, 4, noSlopeChange);
    expect(player.lateralSpeed).toBeGreaterThan(0);
    expect(player.lateralSpeed).toBeLessThan(20);

    c.update(player, 2, bounds, 4, noSlopeChange);
    expect(player.lateralSpeed).toBe(0);
  });
});

describe('PlayerController bend drift', () => {
  const bounds = { minX: -10, maxX: 10 };
  const rowSpacing = 4;
  const slopeChangeRight = 2;

  it('does not drift when driftFactor is zero', () => {
    const c = new PlayerController({ ...baseParams, driftFactor: 0 });
    c.forward = true;
    const player = createPlayerState({ speed: 5, lateralX: 0 });
    c.update(player, 0.2, bounds, rowSpacing, slopeChangeRight);
    expect(player.lateralX).toBe(0);
  });

  it('does not drift when slope change is zero (constant ramp)', () => {
    const c = new PlayerController({ ...baseParams, driftFactor: 1 });
    c.forward = true;
    const player = createPlayerState({ speed: 5, lateralX: 0 });
    c.update(player, 0.2, bounds, rowSpacing, 0);
    expect(player.lateralX).toBe(0);
  });

  it('drifts left when moving forward through tightening right-hand bend', () => {
    const c = new PlayerController({ ...baseParams, driftFactor: 1 });
    const player = createPlayerState({ speed: 5, lateralX: 0 });
    c.update(player, 0.2, bounds, rowSpacing, slopeChangeRight);
    expect(player.lateralX).toBeCloseTo(-2, 5);
  });

  it('drifts right when reversing through tightening right-hand bend', () => {
    const c = new PlayerController({ ...baseParams, driftFactor: 1 });
    const player = createPlayerState({ speed: -5, lateralX: 0 });
    c.update(player, 0.2, bounds, rowSpacing, slopeChangeRight);
    expect(player.lateralX).toBeCloseTo(2, 5);
  });

  it('clamps drifted lateralX and zeroes lateralSpeed on wall hit', () => {
    const c = new PlayerController({ ...baseParams, driftFactor: 1 });
    const player = createPlayerState({ speed: -5, lateralX: 9.5 });
    c.update(player, 0.2, bounds, rowSpacing, slopeChangeRight);
    expect(player.lateralX).toBe(10);
    expect(player.lateralSpeed).toBe(0);
  });
});
