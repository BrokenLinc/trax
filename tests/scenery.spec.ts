import { describe, expect, it } from 'vitest';

import { SCENERY_CLEARANCE_M, sceneryForRow, sceneryInRange } from '../src/world/scenery.ts';

describe('sceneryForRow', () => {
  it('stays off the asphalt and is stable for a seed', () => {
    const first = sceneryForRow('mode7', 40);
    expect(sceneryForRow('mode7', 40)).toEqual(first);
    for (let row = -30; row < 250; row++) {
      for (const inst of sceneryForRow('mode7', row)) {
        expect(Math.abs(inst.localX)).toBeGreaterThanOrEqual(SCENERY_CLEARANCE_M);
        expect(inst.row).toBe(row);
        expect(inst.height).toBeGreaterThan(0.4);
        if (inst.kind === 'broadleaf' || inst.kind === 'pine') {
          expect(Math.abs(inst.localX)).toBeGreaterThanOrEqual(11);
          expect(inst.height).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  it('changes with the seed', () => {
    const a = sceneryInRange('mode7', 0, 40);
    const b = sceneryInRange('other-day', 0, 40);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });
});
