import { describe, expect, it } from 'vitest';

import {
  ENGINE_DOWNSHIFT_COUPLED_RPM,
  ENGINE_GEAR_RATIOS,
  ENGINE_IDLE_RPM,
  ENGINE_NEXT_GEAR_MIN_RPM,
  ENGINE_REDLINE_RPM,
  ENGINE_REV_UP_PER_SEC,
  ENGINE_UPSHIFT_RPM,
  coupledRpm,
  createEngineState,
  stepEngine,
} from '../src/audio/engine.ts';

describe('stepEngine', () => {
  it('idles in 1st with no speed and no throttle', () => {
    const engine = createEngineState();
    stepEngine(engine, { speed: 0, throttle: false }, 1);
    expect(engine.rpm).toBe(ENGINE_IDLE_RPM);
    expect(engine.gear).toBe(0);
  });

  it('revs ahead of a stopped bike and does not upshift', () => {
    const engine = createEngineState();
    stepEngine(engine, { speed: 0, throttle: true }, 0.2);
    expect(engine.rpm).toBeCloseTo(ENGINE_IDLE_RPM + ENGINE_REV_UP_PER_SEC * 0.2, 5);
    expect(engine.gear).toBe(0);

    for (let i = 0; i < 80; i++) stepEngine(engine, { speed: 0, throttle: true }, 0.05);
    expect(engine.rpm).toBe(ENGINE_REDLINE_RPM);
    expect(engine.gear).toBe(0);
  });

  it('settles onto the gear ratio when the throttle is closed', () => {
    const engine = createEngineState();
    const speed = 4;
    const coupled = coupledRpm(speed, 0);
    expect(coupled).toBeGreaterThan(ENGINE_IDLE_RPM);
    expect(coupled).toBeLessThan(ENGINE_UPSHIFT_RPM);
    for (let i = 0; i < 40; i++) stepEngine(engine, { speed, throttle: false }, 0.1);
    expect(engine.rpm).toBeCloseTo(coupled, 4);
    expect(engine.gear).toBe(0);
  });

  it('drops RPM by the gear ratio on an upshift', () => {
    const speed = 11;
    expect(coupledRpm(speed, 1)).toBeGreaterThanOrEqual(ENGINE_NEXT_GEAR_MIN_RPM);
    const engine = createEngineState();
    engine.rpm = ENGINE_UPSHIFT_RPM - 100;
    const dt = 0.05;
    stepEngine(engine, { speed, throttle: true }, dt);
    const climbed = ENGINE_UPSHIFT_RPM - 100 + ENGINE_REV_UP_PER_SEC * dt;
    const first = ENGINE_GEAR_RATIOS[0] ?? 1;
    const second = ENGINE_GEAR_RATIOS[1] ?? 1;
    expect(engine.gear).toBe(1);
    expect(engine.rpm).toBeCloseTo(climbed * (second / first), 4);
    expect(engine.rpm).toBeLessThan(climbed);
  });

  it('raises RPM by the gear ratio on a downshift', () => {
    const second = ENGINE_GEAR_RATIOS[1] ?? 1;
    const speed = (ENGINE_DOWNSHIFT_COUPLED_RPM - 100 - ENGINE_IDLE_RPM) / second;
    expect(coupledRpm(speed, 1)).toBeLessThanOrEqual(ENGINE_DOWNSHIFT_COUPLED_RPM);
    const engine = createEngineState();
    engine.gear = 1;
    engine.rpm = coupledRpm(speed, 1);
    stepEngine(engine, { speed, throttle: false }, 0.05);
    const first = ENGINE_GEAR_RATIOS[0] ?? 1;
    expect(engine.gear).toBe(0);
    expect(engine.rpm).toBeCloseTo(coupledRpm(speed, 1) * (first / second), 4);
  });

  it('uses the same gears in reverse', () => {
    const forward = createEngineState();
    const reverse = createEngineState();
    for (let i = 0; i < 30; i++) {
      stepEngine(forward, { speed: 6, throttle: false }, 0.1);
      stepEngine(reverse, { speed: -6, throttle: false }, 0.1);
    }
    expect(reverse.rpm).toBeCloseTo(forward.rpm, 4);
    expect(reverse.gear).toBe(forward.gear);
  });
});
