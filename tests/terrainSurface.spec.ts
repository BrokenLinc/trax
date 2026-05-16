import { describe, expect, it } from 'vitest';
import {
  asphaltSideForQuad,
  isAsphaltQuad,
  SURFACE_ATLAS_WIDTH,
  uvForSurface,
} from '../src/render/terrainSurface.ts';

describe('terrainSurface', () => {
  it('marks the two road quads flanking centreCol as asphalt', () => {
    const centre = 16;
    expect(isAsphaltQuad(centre - 1, centre)).toBe(true);
    expect(isAsphaltQuad(centre, centre)).toBe(true);
    expect(isAsphaltQuad(centre - 2, centre)).toBe(false);
    expect(isAsphaltQuad(centre + 1, centre)).toBe(false);
  });

  it('maps west/east road quads to left/right atlas texels', () => {
    const centre = 16;
    expect(asphaltSideForQuad(centre - 1, centre)).toBe('left');
    expect(asphaltSideForQuad(centre, centre)).toBe('right');
  });

  it('places UVs at texel centres in the 4×1 atlas', () => {
    const w = SURFACE_ATLAS_WIDTH;
    expect(uvForSurface('shoulder', 'left')).toEqual([0.5 / w, 0.5]);
    expect(uvForSurface('asphalt', 'left')).toEqual([1.5 / w, 0.5]);
    expect(uvForSurface('asphalt', 'right')).toEqual([2.5 / w, 0.5]);
    expect(uvForSurface('shoulder', 'right')).toEqual([3.5 / w, 0.5]);
  });
});
