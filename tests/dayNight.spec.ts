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
    expect(noon.horizon.r).toBeCloseTo(1, 2);
    expect(noon.sun.color.r).toBeGreaterThan(0.95);
  });

  it('gels the sunset light and keeps fog on the mountain haze', () => {
    const noon = sampleDayNight(0.5);
    const sunset = sampleDayNight(0.75);
    expect(sunset.sun.y).toBeLessThan(noon.sun.y);
    expect(sunset.sun.intensity).toBeGreaterThan(0);
    expect(sunset.sun.color.r).toBeGreaterThan(sunset.sun.color.b + 0.15);
    expect(sunset.cloud.r).toBeGreaterThan(sunset.cloud.b);
    expect(sunset.fog.r / sunset.fog.b).toBeGreaterThan(noon.fog.r / noon.fog.b);
    expect(sunset.sky.r - sunset.sky.g).toBeGreaterThan(sunset.fog.r - sunset.fog.g);
    expect(sunset.star).toBeLessThan(0.5);
  });

  it('gives midnight a full star field and no sun', () => {
    const night = sampleDayNight(0);
    expect(night.sun.intensity).toBe(0);
    expect(night.star).toBeGreaterThan(0.9);
    expect(night.moon).toBeGreaterThan(0.8);
    expect(night.fog.b).toBeGreaterThan(night.fog.r);
    expect(night.horizon.r).toBeLessThan(0.35);
    expect(night.fog.r).toBeLessThan(0.2);
  });

  it('wraps the clock', () => {
    expect(wrapDayTime(1)).toBe(0);
    expect(wrapDayTime(-0.25)).toBeCloseTo(0.75);
    expect(sampleDayNight(1.5).sun.y).toBeCloseTo(sampleDayNight(0.5).sun.y);
  });
});
