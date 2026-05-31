import { describe, expect, it } from 'vitest';
import { tangentSlopeAtRow, tangentSlopeChangeAtRow } from '../src/world/bendField.ts';
import { World } from '../src/world/world.ts';

describe('World', () => {
  it('produces identical bend + depth for the same seed', () => {
    const a = new World('mode7');
    const b = new World('mode7');
    for (let r = -10; r <= 10; r++) {
      expect(a.bend.sample(r)).toBe(b.bend.sample(r));
      expect(a.depth.sample(r, 0)).toBe(b.depth.sample(r, 0));
    }
  });

  it('reseed swaps the underlying samplers and changes outputs', () => {
    const w = new World('alpha');
    // Low row indices sit in a flat bend-noise basin at MODE7_DEFAULTS.bend.frequency.
    const rows = Array.from({ length: 10 }, (_, i) => 100 + i);
    const before = rows.map((r) => w.bend.sample(r));
    w.reseed('beta');
    const after = rows.map((r) => w.bend.sample(r));
    let same = 0;
    for (let i = 0; i < 10; i++) if (before[i] === after[i]) same++;
    expect(same).toBeLessThan(5);
    expect(w.getSeed()).toBe('beta');
  });

  it('reseed preserves depth + bend params', () => {
    const w = new World('alpha');
    const dp = w.depth.getParams();
    const bp = w.bend.getParams();
    w.reseed('beta');
    expect(w.depth.getParams()).toEqual(dp);
    expect(w.bend.getParams()).toEqual(bp);
  });

  it('bend samples decorrelate from depth samples', () => {
    const w = new World('mode7');
    let collisions = 0;
    // Skip the flat basin near row 0 where both channels are exactly zero.
    for (let r = 50; r < 200; r++) {
      if (w.bend.sample(r) === w.depth.sample(r, 0)) collisions++;
    }
    expect(collisions).toBeLessThan(2);
  });
});

describe('tangentSlopeAtRow', () => {
  it('lerps bend samples across the player interval', () => {
    const w = new World('mode7');
    const row = 120.25;
    const lo = Math.floor(row);
    const frac = row - lo;
    const expected = (1 - frac) * w.bend.sample(lo + 1) + frac * w.bend.sample(lo + 2);
    expect(tangentSlopeAtRow(row, w.bend)).toBe(expected);
  });
});

describe('tangentSlopeChangeAtRow', () => {
  it('lerps adjacent bend first differences across the player interval', () => {
    const w = new World('mode7');
    const row = 120.25;
    const lo = Math.floor(row);
    const frac = row - lo;
    const d1 = w.bend.sample(lo + 2) - w.bend.sample(lo + 1);
    const d2 = w.bend.sample(lo + 3) - w.bend.sample(lo + 2);
    const expected = (1 - frac) * d1 + frac * d2;
    expect(tangentSlopeChangeAtRow(row, w.bend)).toBe(expected);
  });
});
