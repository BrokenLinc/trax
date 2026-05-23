import { describe, expect, it } from 'vitest';
import { DepthMap, DEFAULT_DEPTH_PARAMS } from '../src/world/depthMap.ts';

describe('DepthMap', () => {
  it('is deterministic for a given seed', () => {
    const a = new DepthMap('alpha');
    const b = new DepthMap('alpha');
    for (let r = -5; r <= 5; r++) {
      for (let c = -5; c <= 5; c++) {
        expect(a.sample(r, c)).toBe(b.sample(r, c));
      }
    }
  });

  it('decorrelates between different seeds', () => {
    const a = new DepthMap('alpha');
    const b = new DepthMap('beta');
    let differences = 0;
    for (let r = -20; r <= 20; r++) {
      for (let c = -20; c <= 20; c++) {
        if (Math.abs(c) <= 1) continue;
        if (a.sample(r, c) !== b.sample(r, c)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(50);
  });

  it('pulls the centerline toward zero more than far shoulders', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      amplitude: 5,
      roadDatumPull: 1,
      shoulderBlendColumns: 0,
    });
    let centreSumSq = 0;
    let shoulderSumSq = 0;
    for (let r = 0; r < 200; r++) {
      centreSumSq += map.sample(r, 0) ** 2;
      shoulderSumSq += map.sample(r, 12) ** 2;
    }
    expect(centreSumSq).toBe(0);
    expect(shoulderSumSq).toBeGreaterThan(0);
  });

  it('keeps asphalt columns level at the centerline height', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      roadDatumPull: 0.37,
      shoulderBlendColumns: 4,
    });
    for (let r = -20; r <= 200; r++) {
      const centre = map.sample(r, 0);
      expect(map.sample(r, -1)).toBe(centre);
      expect(map.sample(r, 1)).toBe(centre);
    }
  });

  it('roadDatumPull 0 leaves centerline equal to natural at col 0', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      roadDatumPull: 0,
      shoulderBlendColumns: 0,
    });
    for (let r = 0; r < 50; r++) {
      const natural = map.sample(r, 0);
      expect(map.sample(r, -1)).toBe(natural);
    }
  });

  it('roadDatumPull 1 forces centerline and asphalt to Y = 0', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      roadDatumPull: 1,
    });
    for (let r = 0; r < 50; r++) {
      expect(map.sample(r, 0)).toBe(0);
      expect(map.sample(r, -1)).toBe(0);
      expect(map.sample(r, 1)).toBe(0);
    }
  });

  it('blends shoulders between centerline and natural at |col| = 2', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      amplitude: 10,
      roadDatumPull: 0,
      shoulderBlendColumns: 6,
    });
    let blended = 0;
    for (let r = 0; r < 100; r++) {
      const centre = map.sample(r, 0);
      const shoulder = map.sample(r, 2);
      const far = map.sample(r, 12);
      if (centre !== far && centre !== shoulder && shoulder !== far) blended++;
    }
    expect(blended).toBeGreaterThan(10);
  });

  it('bilinear sample at integer coordinates equals the integer sample', () => {
    const map = new DepthMap('mode7');
    for (let r = -3; r <= 3; r++) {
      for (let c = -3; c <= 3; c++) {
        expect(map.sampleBilinear(r, c)).toBeCloseTo(map.sample(r, c), 6);
      }
    }
  });

  it('bilinear sample is bounded by its four corners', () => {
    const map = new DepthMap('mode7');
    const corners = [map.sample(0, 0), map.sample(0, 1), map.sample(1, 0), map.sample(1, 1)];
    const min = Math.min(...corners);
    const max = Math.max(...corners);
    for (let i = 1; i < 10; i++) {
      for (let j = 1; j < 10; j++) {
        const v = map.sampleBilinear(i / 10, j / 10);
        expect(v).toBeGreaterThanOrEqual(min - 1e-9);
        expect(v).toBeLessThanOrEqual(max + 1e-9);
      }
    }
  });
});
