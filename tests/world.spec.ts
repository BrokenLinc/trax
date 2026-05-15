import { describe, expect, it } from 'vitest';
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
    const before = Array.from({ length: 10 }, (_, i) => w.bend.sample(i));
    w.reseed('beta');
    const after = Array.from({ length: 10 }, (_, i) => w.bend.sample(i));
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
    for (let r = 0; r < 200; r++) {
      if (w.bend.sample(r) === w.depth.sample(r, 0)) collisions++;
    }
    expect(collisions).toBeLessThan(2);
  });
});
