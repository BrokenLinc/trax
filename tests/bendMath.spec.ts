import { describe, expect, it } from 'vitest';
import {
  prefixSum,
  rebuildOffsets,
  rebuildOffsetsTangentAligned,
  rowOffset,
  rowOffsetReference,
  rowOffsetTangentAligned,
} from '../src/render/bendMath.ts';

const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

describe('prefixSum', () => {
  it('produces an exclusive prefix sum', () => {
    const p = prefixSum([1, 2, 3, 4]);
    expect(Array.from(p)).toEqual([0, 1, 3, 6, 10]);
  });

  it('reuses the provided buffer when large enough', () => {
    const out = new Float32Array(8);
    const p = prefixSum([1, 1, 1], out);
    expect(p).toBe(out);
    expect(p[3]).toBe(3);
  });
});

describe('rowOffset — discrete examples from the spec', () => {
  // Window covers absolute rows [-3 .. 3]; every bend = 1.
  // Recall bends[i] is the slope on the half-open interval [i-1, i], so the
  // bend "at" the player row IS used when the first step is taken backward.
  const windowRowStart = -3;
  const bends = new Float32Array([1, 1, 1, 1, 1, 1, 1]);
  const prefix = prefixSum(bends);

  it('player exactly on row 0 → forward, offsets are cumulative bends', () => {
    const playerRow = 0;
    expect(rowOffset(0, playerRow, windowRowStart, bends, prefix)).toBe(0);
    expect(rowOffset(1, playerRow, windowRowStart, bends, prefix)).toBe(1);
    expect(rowOffset(2, playerRow, windowRowStart, bends, prefix)).toBe(2);
    expect(rowOffset(3, playerRow, windowRowStart, bends, prefix)).toBe(3);
  });

  it('player exactly on row 0 → backward, offsets are cumulative negative bends', () => {
    const playerRow = 0;
    expect(rowOffset(-1, playerRow, windowRowStart, bends, prefix)).toBe(-1);
    expect(rowOffset(-2, playerRow, windowRowStart, bends, prefix)).toBe(-2);
    expect(rowOffset(-3, playerRow, windowRowStart, bends, prefix)).toBe(-3);
  });

  it('asymmetric bend example: forward and backward use different first slopes', () => {
    // bends at rows [-3, -2, -1, 0, 1, 2, 3] = [9, 9, 9, 5, 7, 9, 9].
    // Going forward 1 row crosses interval [0, 1] with slope = bend@row1 = 7.
    // Going backward 1 row crosses interval [-1, 0] with slope = bend@row0 = 5.
    const localBends = new Float32Array([9, 9, 9, 5, 7, 9, 9]);
    const localPrefix = prefixSum(localBends);
    expect(rowOffset(1, 0, windowRowStart, localBends, localPrefix)).toBe(7);
    expect(rowOffset(-1, 0, windowRowStart, localBends, localPrefix)).toBe(-5);
  });
});

describe('rowOffset — interpolation', () => {
  const windowRowStart = -5;
  const bends = new Float32Array([2, -1, 3, 0, 1, 2, -2, 1, 0, 1, -1]);
  const prefix = prefixSum(bends);

  it('agrees with the reference implementation for a grid of (row, playerRow)', () => {
    for (let pr10 = -30; pr10 <= 40; pr10++) {
      const playerRow = pr10 / 10;
      for (let row = -5; row <= 5; row++) {
        const fast = rowOffset(row, playerRow, windowRowStart, bends, prefix);
        const slow = rowOffsetReference(row, playerRow, windowRowStart, bends);
        expect(close(fast, slow)).toBe(true);
      }
    }
  });

  it('is continuous across an integer row crossing', () => {
    // As player crosses from playerRow = lo+1-ε to lo+1+ε, every row's offset
    // should be (almost) identical at the seam — no discontinuity.
    const lo = 1;
    const eps = 1e-6;
    for (let row = -5; row <= 5; row++) {
      const before = rowOffset(row, lo + 1 - eps, windowRowStart, bends, prefix);
      const after = rowOffset(row, lo + 1 + eps, windowRowStart, bends, prefix);
      expect(Math.abs(after - before)).toBeLessThan(1e-3);
    }
  });

  it('player row always lies on offset = 0', () => {
    for (let pr10 = -30; pr10 <= 40; pr10++) {
      const playerRow = pr10 / 10;
      // Exact row equal to playerRow only exists when frac=0; sample row=floor.
      const lo = Math.floor(playerRow);
      const frac = playerRow - lo;
      const atPlayer = rowOffset(lo, playerRow, windowRowStart, bends, prefix);
      // Offset at floor row equals -frac * slope between lo and lo+1.
      const slope = bends[lo + 1 - windowRowStart] ?? 0;
      expect(close(atPlayer, -frac * slope)).toBe(true);
    }
  });
});

describe('rebuildOffsets', () => {
  it('matches per-row rowOffset across the whole window', () => {
    const windowRowStart = -4;
    const rowCount = 9;
    const bends = new Float32Array([1, 0, -2, 3, 1, 0.5, -1, 2, 0]);
    const prefix = prefixSum(bends);
    const playerRow = 0.37;
    const out = new Float32Array(rowCount);
    rebuildOffsets(windowRowStart, rowCount, playerRow, bends, prefix, out);
    for (let i = 0; i < rowCount; i++) {
      const row = windowRowStart + i;
      const single = rowOffset(row, playerRow, windowRowStart, bends, prefix);
      expect(out[i]).toBeCloseTo(single, 6);
    }
  });

  it('throws when the output buffer is too small', () => {
    const bends = new Float32Array([1, 2, 3]);
    const prefix = prefixSum(bends);
    expect(() => rebuildOffsets(0, 3, 0, bends, prefix, new Float32Array(2))).toThrow(/out length/);
  });
});

describe('rowOffsetTangentAligned — visual presentation', () => {
  const windowRowStart = -5;
  const bends = new Float32Array([2, -1, 3, 0, 1, 2, -2, 1, 0, 1, -1]);
  const prefix = prefixSum(bends);

  it('returns 0 at the player position for any fractional player row', () => {
    for (let pr10 = -30; pr10 <= 40; pr10++) {
      const playerRow = pr10 / 10;
      // We can't sample at a fractional row, but the mathematical invariant is
      // that the linear interpolation of the two integer-row offsets at the
      // player's exact position is zero. Check the floor and ceiling rows.
      const lo = Math.floor(playerRow);
      const frac = playerRow - lo;
      const lower = rowOffsetTangentAligned(lo, playerRow, windowRowStart, bends, prefix);
      const upper = rowOffsetTangentAligned(lo + 1, playerRow, windowRowStart, bends, prefix);
      const interpolated = (1 - frac) * lower + frac * upper;
      expect(close(interpolated, 0)).toBe(true);
    }
  });

  it('has zero local slope at integer player rows', () => {
    // At a row crossing the residual slope is exactly zero by construction.
    for (let p = -3; p <= 5; p++) {
      const eps = 1e-4;
      const before = rowOffsetTangentAligned(p, p - eps, windowRowStart, bends, prefix);
      const after = rowOffsetTangentAligned(p, p + eps, windowRowStart, bends, prefix);
      // Both should be ~0 because the player is essentially on row p.
      expect(Math.abs(before)).toBeLessThan(1e-3);
      expect(Math.abs(after)).toBeLessThan(1e-3);
    }
  });

  it('collapses a constant-bend ramp to flat (every row has offset 0)', () => {
    const constant = new Float32Array([1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7]);
    const constPrefix = prefixSum(constant);
    for (let pr10 = -20; pr10 <= 30; pr10++) {
      const playerRow = pr10 / 10;
      for (let row = -3; row <= 3; row++) {
        const v = rowOffsetTangentAligned(row, playerRow, -4, constant, constPrefix);
        expect(close(v, 0)).toBe(true);
      }
    }
  });

  it('is continuous in playerRow at integer-row crossings', () => {
    const eps = 1e-6;
    for (let p = -3; p <= 5; p++) {
      for (let row = -5; row <= 5; row++) {
        const before = rowOffsetTangentAligned(row, p - eps, windowRowStart, bends, prefix);
        const after = rowOffsetTangentAligned(row, p + eps, windowRowStart, bends, prefix);
        expect(Math.abs(after - before)).toBeLessThan(1e-3);
      }
    }
  });

  it('matches rowOffsetTangentAligned per-row when called in bulk', () => {
    const windowStart = -4;
    const rowCount = 9;
    const localBends = new Float32Array([1, 0, -2, 3, 1, 0.5, -1, 2, 0]);
    const localPrefix = prefixSum(localBends);
    const playerRow = 0.37;
    const out = new Float32Array(rowCount);
    rebuildOffsetsTangentAligned(windowStart, rowCount, playerRow, localBends, localPrefix, out);
    for (let i = 0; i < rowCount; i++) {
      const row = windowStart + i;
      const single = rowOffsetTangentAligned(row, playerRow, windowStart, localBends, localPrefix);
      expect(out[i]).toBeCloseTo(single, 6);
    }
  });

  it('throws when the bulk output buffer is too small', () => {
    const b = new Float32Array([1, 2, 3]);
    const p = prefixSum(b);
    expect(() => rebuildOffsetsTangentAligned(0, 3, 0, b, p, new Float32Array(2))).toThrow(
      /out length/,
    );
  });

  it('preserves curvature beyond the player (a straight tangent locally, curve in the distance)', () => {
    // Bends are 0 except a single +1 at the slope into row 5 (well ahead of
    // the player). From playerRow=0 the local tangent is 0 (bend[1]=bend[2]=0),
    // so the visible offsets equal the cumulative offsets and the bump shows
    // up undisturbed at row 5+. Window covers absolute rows [-4 .. 7].
    const bumpBends = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    const bumpPrefix = prefixSum(bumpBends);
    const ws = -4;
    const playerRow = 0;
    expect(rowOffsetTangentAligned(0, playerRow, ws, bumpBends, bumpPrefix)).toBe(0);
    expect(rowOffsetTangentAligned(3, playerRow, ws, bumpBends, bumpPrefix)).toBe(0);
    expect(rowOffsetTangentAligned(4, playerRow, ws, bumpBends, bumpPrefix)).toBe(0);
    expect(rowOffsetTangentAligned(5, playerRow, ws, bumpBends, bumpPrefix)).toBe(1);
    expect(rowOffsetTangentAligned(6, playerRow, ws, bumpBends, bumpPrefix)).toBe(1);
  });

  it('cancels a near bump and preserves the curve once the player drives past it', () => {
    // bend[i] = slope on [i-1, i]. Bump = +1 slope on the interval [0, 1].
    // From playerRow=0, the road climbs by 1 unit going to row 1; tangent
    // alignment subtracts that local +1 slope, so visible(1)=0 (locally flat).
    // At playerRow=2 the bump is two rows behind; the local tangent is 0
    // (bends[3]=bends[4]=0), so we see the cumulative offsets — row 0 sits at
    // X=-1 because behind the bump the road slopes back down.
    const bumpBends = new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 0]);
    const bumpPrefix = prefixSum(bumpBends);
    const ws = -4;
    const onBump = rowOffsetTangentAligned(1, 0, ws, bumpBends, bumpPrefix);
    expect(close(onBump, 0)).toBe(true);
    const past = rowOffsetTangentAligned(0, 2, ws, bumpBends, bumpPrefix);
    expect(close(past, -1)).toBe(true);
  });
});
