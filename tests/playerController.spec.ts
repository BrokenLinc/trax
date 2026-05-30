import { describe, expect, it } from 'vitest';
import { PlayerController } from '../src/player/controller.ts';
import { createPlayerState } from '../src/player/state.ts';

describe('PlayerController strafe', () => {
  const bounds = { minX: -10, maxX: 10 };

  it('does not move lateralX when speed is zero', () => {
    const c = new PlayerController({
      strafeSpeedFactor: 1,
      accel: 1,
      decel: 1,
      friction: 0,
      maxSpeed: 10,
    });
    c.strafeRight = true;
    const player = createPlayerState({ speed: 0, lateralX: 0 });
    c.update(player, 1, bounds, 4);
    expect(player.lateralX).toBe(0);
  });

  it('clamps lateralX to mesh bounds', () => {
    const c = new PlayerController({
      strafeSpeedFactor: 10,
      accel: 1,
      decel: 1,
      friction: 0,
      maxSpeed: 10,
    });
    c.strafeRight = true;
    const player = createPlayerState({ speed: 5, lateralX: 9 });
    c.update(player, 1, bounds, 4);
    expect(player.lateralX).toBe(10);
  });
});
