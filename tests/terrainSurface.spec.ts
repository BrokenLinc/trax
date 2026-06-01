import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asphaltSideForQuad,
  CHUNK_SURFACE_SIZE,
  chunkLatticeUv,
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

  it('maps quad corners to lattice UVs spanning 0–1 across the chunk', () => {
    const rowsPerChunk = 8;
    const cols = 5;
    expect(chunkLatticeUv(0, 0, 0, 0, rowsPerChunk, cols)).toEqual([0, 0]);
    expect(chunkLatticeUv(0, 0, 1, 0, rowsPerChunk, cols)).toEqual([0.25, 0]);
    expect(chunkLatticeUv(0, 0, 0, 1, rowsPerChunk, cols)).toEqual([0, 0.125]);
    expect(chunkLatticeUv(rowsPerChunk - 1, cols - 2, 1, 1, rowsPerChunk, cols)).toEqual([1, 1]);
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
