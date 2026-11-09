import { describe, expect, it } from 'vitest';

import {
  SCENERY_CLEARANCE_M,
  flatHeight,
  sceneryForRow,
  sceneryInRange,
} from '../src/world/scenery.ts';

const flat = flatHeight(0);

describe('sceneryForRow', () => {
  it('stays off the asphalt and is stable', () => {
    const first = sceneryForRow('mode7', 40, flat);
    expect(sceneryForRow('mode7', 40, flat)).toEqual(first);
    for (let row = -30; row < 250; row++) {
      for (const inst of sceneryForRow('mode7', row, flat)) {
        expect(Math.abs(inst.localX)).toBeGreaterThanOrEqual(SCENERY_CLEARANCE_M);
        expect(inst.row).toBe(row);
        expect(inst.height).toBeGreaterThan(0.4);
        expect(['shrub', 'bloom', 'flowers', 'post', 'rock']).toContain(inst.kind);
      }
    }
  });

  it('changes with the seed', () => {
    const a = sceneryInRange('mode7', 0, 40, flat);
    const b = sceneryInRange('other-day', 0, 40, flat);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });
});
