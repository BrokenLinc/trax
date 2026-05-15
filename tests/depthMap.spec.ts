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
    for (let r = -5; r <= 5; r++) {
      for (let c = -5; c <= 5; c++) {
        if (a.sample(r, c) !== b.sample(r, c)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(50);
  });

  it('flattens the road centre column more than the shoulders', () => {
    const map = new DepthMap('mode7', {
      ...DEFAULT_DEPTH_PARAMS,
      amplitude: 5,
      roadFlatColumns: 4,
      roadFlatStrength: 1,
    });
    let centreSumSq = 0;
    let shoulderSumSq = 0;
    for (let r = 0; r < 200; r++) {
      centreSumSq += map.sample(r, 0) ** 2;
      shoulderSumSq += map.sample(r, 12) ** 2;
    }
    expect(centreSumSq).toBeLessThan(shoulderSumSq);
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
