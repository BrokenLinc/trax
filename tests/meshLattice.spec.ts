import { describe, expect, it } from 'vitest';
import {
  meshLateralBounds,
  signedColFromWorldX,
  worldXForSignedCol,
} from '../src/render/meshLattice.ts';

describe('worldXForSignedCol', () => {
  const road = 2;
  const landscape = 5;

  it('places centre column at X = 0', () => {
    expect(worldXForSignedCol(0, road, landscape)).toBe(0);
  });

  it('uses road spacing at |col| = 1', () => {
    expect(worldXForSignedCol(-1, road, landscape)).toBe(-2);
    expect(worldXForSignedCol(1, road, landscape)).toBe(2);
  });

  it('accumulates landscape spacing from |col| >= 2', () => {
    expect(worldXForSignedCol(-2, road, landscape)).toBe(-(road + landscape));
    expect(worldXForSignedCol(3, road, landscape)).toBe(road + 2 * landscape);
  });

  it('matches uniform spacing when road and landscape are equal', () => {
    const spacing = 4;
    for (const col of [-3, -2, -1, 0, 1, 2, 3]) {
      expect(worldXForSignedCol(col, spacing, spacing)).toBe(col * spacing);
    }
  });
});

describe('signedColFromWorldX', () => {
  const road = 2;
  const landscape = 5;

  it('inverts worldXForSignedCol at integer columns', () => {
    for (const col of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
      const x = worldXForSignedCol(col, road, landscape);
      expect(signedColFromWorldX(x, road, landscape)).toBeCloseTo(col, 8);
    }
  });

  it('inverts fractional positions in the road band', () => {
    expect(signedColFromWorldX(1, road, landscape)).toBeCloseTo(0.5, 8);
    expect(signedColFromWorldX(-1, road, landscape)).toBeCloseTo(-0.5, 8);
  });
});

describe('meshLateralBounds', () => {
  it('matches outermost columns for odd cols', () => {
    const road = 0.6;
    const landscape = 0.6;
    const cols = 7;
    const half = Math.floor(cols / 2);
    const b = meshLateralBounds(cols, road, landscape);
    expect(b.minX).toBe(worldXForSignedCol(-half, road, landscape));
    expect(b.maxX).toBe(worldXForSignedCol(half, road, landscape));
  });

  it('treats even cols as odd+1', () => {
    const b9 = meshLateralBounds(9, 2, 5);
    const b8 = meshLateralBounds(8, 2, 5);
    expect(b8).toEqual(b9);
  });
});
