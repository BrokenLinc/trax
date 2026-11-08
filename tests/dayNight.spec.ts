import { describe, expect, it } from 'vitest';
import { colorHex, NOON_FOG, sampleDayNight, wrapDayTime } from '../src/render/dayNight.ts';

describe('dayNight', () => {
  it('keeps noon on the tuned daylight', () => {
    const noon = sampleDayNight(0.5);
    expect(colorHex(noon.fog)).toBe(NOON_FOG);
    expect(noon.sun.intensity).toBeGreaterThan(0.5);
    expect(noon.sun.y).toBeGreaterThan(40);
    expect(noon.star).toBe(0);
    expect(noon.moon).toBe(0);
    expect(noon.sky.r).toBeCloseTo(1, 2);
    expect(noon.albedo.r).toBeCloseTo(1, 2);
  });

  it('makes sunset warm with the sun on the horizon', () => {
    const noon = sampleDayNight(0.5);
    const sunset = sampleDayNight(0.75);
    expect(sunset.sun.y).toBeLessThan(noon.sun.y);
    expect(sunset.sun.intensity).toBeGreaterThan(0);
    expect(sunset.fog.r).toBeGreaterThan(sunset.fog.b + 0.2);
    expect(sunset.cloud.r).toBeGreaterThan(sunset.cloud.b);
    expect(sunset.star).toBeLessThan(0.5);
  });

  it('gives midnight a full star field and no sun', () => {
    const night = sampleDayNight(0);
    expect(night.sun.intensity).toBe(0);
    expect(night.star).toBeGreaterThan(0.9);
    expect(night.moon).toBeGreaterThan(0.8);
    expect(night.fog.b).toBeGreaterThan(night.fog.r);
    expect(night.albedo.r).toBeLessThan(0.4);
  });

  it('wraps the clock', () => {
    expect(wrapDayTime(1)).toBe(0);
    expect(wrapDayTime(-0.25)).toBeCloseTo(0.75);
    expect(sampleDayNight(1.5).sun.y).toBeCloseTo(sampleDayNight(0.5).sun.y);
  });
});
