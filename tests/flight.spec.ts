import { describe, expect, it } from 'vitest';

import { DEFAULT_FLIGHT, stepFlight, type FlightBody } from '../src/player/flight.ts';
import { PlayerController } from '../src/player/controller.ts';
import { createPlayerState } from '../src/player/state.ts';

const dt = 1 / 60;

function planted(groundY: number): FlightBody {
  const body: FlightBody = { y: 0, vy: 0, airborne: false, prevGroundY: null };
  stepFlight(body, groundY, dt);
  return body;
}

describe('stepFlight', () => {
  it('sticks to a steady climb and takes the road upward speed', () => {
    const climb = 8;
    const body = planted(0);
    let ground = 0;
    for (let i = 0; i < 20; i++) {
      ground += climb * dt;
      stepFlight(body, ground, dt);
      expect(body.airborne).toBe(false);
      expect(body.vy).toBeCloseTo(climb, 4);
      expect(body.y).toBeCloseTo(ground, 4);
    }
  });

  it('launches off a crest that falls faster than gravity', () => {
    const climb = 8;
    const body = planted(0);
    let ground = 0;
    for (let i = 0; i < 20; i++) {
      ground += climb * dt;
      stepFlight(body, ground, dt);
    }
    const drop = DEFAULT_FLIGHT.gravity * dt + 2;
    ground += (climb - drop) * dt;
    stepFlight(body, ground, dt);
    expect(body.airborne).toBe(true);
    expect(body.vy).toBeGreaterThan(0);
    expect(body.vy).toBeCloseTo(climb - DEFAULT_FLIGHT.gravity * dt, 4);
    expect(body.y).toBeGreaterThan(ground);
  });

  it('stays on a downhill that eases in slower than gravity', () => {
    const body = planted(10);
    let ground = 10;
    let groundVy = 0;
    for (let i = 0; i < 40; i++) {
      groundVy = Math.max(-6, groundVy - 0.2);
      ground += groundVy * dt;
      stepFlight(body, ground, dt);
      expect(body.airborne).toBe(false);
    }
    expect(body.vy).toBeCloseTo(-6, 4);
    expect(body.y).toBeCloseTo(ground, 4);
  });

  it('sticks on landing with no rebound', () => {
    const body: FlightBody = { y: 4, vy: -6, airborne: true, prevGroundY: 0 };
    let frames = 0;
    while (body.airborne && frames < 400) {
      stepFlight(body, 0, dt);
      frames += 1;
      if (body.airborne) expect(body.vy).toBeLessThan(0);
    }
    expect(frames).toBeGreaterThan(0);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(0);
    expect(body.vy).toBe(0);
    stepFlight(body, 0, dt);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(0);
    expect(body.vy).toBe(0);
  });

  it('plants on the first sample and on a teleport', () => {
    const body: FlightBody = { y: 12, vy: 9, airborne: true, prevGroundY: null };
    stepFlight(body, 3, dt);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(3);
    expect(body.vy).toBe(0);

    body.vy = 15;
    body.airborne = true;
    body.prevGroundY = null;
    stepFlight(body, 1, 0);
    expect(body.y).toBe(1);
    expect(body.vy).toBe(0);
    expect(body.airborne).toBe(false);
  });
});

describe('PlayerController airborne lock', () => {
  const bounds = { minX: -10, maxX: 10 };

  it('coasts when locked, ignores drift, and strafes at half strength', () => {
    const c = new PlayerController({
      accel: 20,
      decel: 20,
      friction: 10,
      maxSpeed: 30,
      strafeSpeedFactor: 1,
      strafeAccel: 100,
      driftFactor: 4,
    });
    c.forward = true;
    c.boost = true;
    c.strafeRight = true;
    const player = createPlayerState({ speed: 5, lateralX: 1, lateralSpeed: 2 });
    c.update(player, 0.2, bounds, 4, 2, true);
    expect(player.speed).toBe(5);
    expect(player.distance).toBeCloseTo(1, 5);
    // Grounded cap would be 20. Half cap is 10, and half accel reaches it.
    expect(player.lateralSpeed).toBeCloseTo(10, 5);
    expect(player.lateralX).toBeCloseTo(3, 5);
  });
});
