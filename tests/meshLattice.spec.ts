import { describe, expect, it } from 'vitest';
import { worldXForSignedCol } from '../src/render/meshLattice.ts';

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
