import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASPHALT_U_MAX,
  ASPHALT_U_MIN,
  asphaltSideForQuad,
  CHUNK_SURFACE_SIZE,
  chunkCrossSectionU,
  chunkLatticeV,
  hillTint,
  isAsphaltQuad,
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

  it('maps chunk rows onto one V repeat', () => {
    const rowsPerChunk = 8;
    expect(chunkLatticeV(0, 0, rowsPerChunk)).toBe(0);
    expect(chunkLatticeV(0, 1, rowsPerChunk)).toBe(0.125);
    expect(chunkLatticeV(rowsPerChunk - 1, 1, rowsPerChunk)).toBe(1);
  });

  it('aligns asphalt with the road and stretches each shoulder across one landscape column', () => {
    const road = 6;
    const landscape = 50;
    const center = (ASPHALT_U_MIN + ASPHALT_U_MAX) / 2;
    expect(chunkCrossSectionU(0, road, landscape)).toBeCloseTo(center, 6);
    expect(chunkCrossSectionU(-road, road, landscape)).toBeCloseTo(ASPHALT_U_MIN, 6);
    expect(chunkCrossSectionU(road, road, landscape)).toBeCloseTo(ASPHALT_U_MAX, 6);
    expect(chunkCrossSectionU(-(road + landscape), road, landscape)).toBeCloseTo(0, 6);
    expect(chunkCrossSectionU(road + landscape, road, landscape)).toBeCloseTo(1, 6);
    expect(chunkCrossSectionU(-(road + landscape / 2), road, landscape)).toBeCloseTo(
      ASPHALT_U_MIN / 2,
      6,
    );
    expect(chunkCrossSectionU(-(road + landscape * 3), road, landscape)).toBe(0);
    expect(chunkCrossSectionU(road + landscape * 3, road, landscape)).toBe(1);
  });

  it('keeps the road tint neutral and cools a valley off the shoulder', () => {
    const [r, g, b] = hillTint(0, 0, 6);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
    const valley = hillTint(-8, 40, 6);
    const crest = hillTint(24, 40, 6);
    expect(valley[0]).toBeLessThan(0.85);
    expect(crest[0]).toBeGreaterThan(valley[0]);
  });

  it('ships a 1024×1024 chunk surface PNG in public/', () => {
    const path = join(process.cwd(), 'public', 'terrain-chunk-surface.png');
    const buf = readFileSync(path);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf.readUInt32BE(16)).toBe(CHUNK_SURFACE_SIZE);
    expect(buf.readUInt32BE(20)).toBe(CHUNK_SURFACE_SIZE);
  });
});
