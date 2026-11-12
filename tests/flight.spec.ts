import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FLIGHT,
  stepFlight,
  type FlightBody,
  type FlightParams,
} from '../src/player/flight.ts';
import { PlayerController } from '../src/player/controller.ts';
import { createPlayerState } from '../src/player/state.ts';

const dt = 1 / 60;
const flightOn: FlightParams = { ...DEFAULT_FLIGHT, enabled: true };

function planted(groundY: number): FlightBody {
  const body: FlightBody = { y: 0, vy: 0, airborne: false, prevGroundY: null };
  stepFlight(body, groundY, dt, flightOn);
  return body;
}

describe('stepFlight', () => {
  it('sticks to a steady climb and takes the road upward speed', () => {
    const climb = 8;
    const body = planted(0);
    let ground = 0;
    for (let i = 0; i < 20; i++) {
      ground += climb * dt;
      stepFlight(body, ground, dt, flightOn);
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
      stepFlight(body, ground, dt, flightOn);
    }
    const drop = DEFAULT_FLIGHT.gravity * dt + 2;
    ground += (climb - drop) * dt;
    stepFlight(body, ground, dt, flightOn);
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
      stepFlight(body, ground, dt, flightOn);
      expect(body.airborne).toBe(false);
    }
    expect(body.vy).toBeCloseTo(-6, 4);
    expect(body.y).toBeCloseTo(ground, 4);
  });

  it('sticks on landing with no rebound', () => {
    const body: FlightBody = { y: 4, vy: -6, airborne: true, prevGroundY: 0 };
    let frames = 0;
    while (body.airborne && frames < 400) {
      stepFlight(body, 0, dt, flightOn);
      frames += 1;
      if (body.airborne) expect(body.vy).toBeLessThan(0);
    }
    expect(frames).toBeGreaterThan(0);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(0);
    expect(body.vy).toBe(0);
    stepFlight(body, 0, dt, flightOn);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(0);
    expect(body.vy).toBe(0);
  });

  it('plants on the first sample and on a teleport', () => {
    const body: FlightBody = { y: 12, vy: 9, airborne: true, prevGroundY: null };
    stepFlight(body, 3, dt, flightOn);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(3);
    expect(body.vy).toBe(0);

    body.vy = 15;
    body.airborne = true;
    body.prevGroundY = null;
    stepFlight(body, 1, 0, flightOn);
    expect(body.y).toBe(1);
    expect(body.vy).toBe(0);
    expect(body.airborne).toBe(false);
  });

  it('stays planted on a dropping crest when gravity is off', () => {
    expect(DEFAULT_FLIGHT.enabled).toBe(false);
    const body: FlightBody = { y: 8, vy: 12, airborne: true, prevGroundY: 8 };
    stepFlight(body, 1, dt);
    expect(body.airborne).toBe(false);
    expect(body.y).toBe(1);
    expect(body.vy).toBe(0);
  });
});

describe('PlayerController airborne lock', () => {
  const bounds = { minX: -10, maxX: 10 };

  it('coasts when locked, drifts at full strength, and strafes at half strength', () => {
    const driftFactor = 4;
    const c = new PlayerController({
      accel: 20,
      decel: 20,
      friction: 10,
      maxSpeed: 30,
      strafeSpeedFactor: 1,
      strafeAccel: 100,
      driftFactor,
    });
    c.forward = true;
    c.boost = true;
    c.strafeRight = true;
    const speed = 5;
    const lateralX = 1;
    const dt = 0.2;
    const rowSpacing = 4;
    const slopeChange = 2;
    const player = createPlayerState({ speed, lateralX, lateralSpeed: 2 });
    c.update(player, dt, bounds, rowSpacing, slopeChange, true);
    expect(player.speed).toBe(speed);
    expect(player.distance).toBeCloseTo(speed * dt, 5);
    // Grounded cap would be 20. Half cap is 10, and half accel reaches it.
    const maxStrafe = 0.5 * Math.abs(speed) * rowSpacing;
    expect(player.lateralSpeed).toBeCloseTo(maxStrafe, 5);
    const fullDrift = -speed * dt * slopeChange * driftFactor;
    expect(player.lateralX).toBeCloseTo(lateralX + fullDrift + maxStrafe * dt, 5);
  });
});
