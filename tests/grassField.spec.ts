import { describe, expect, it } from 'vitest';
import { bakeChunk, type ChunkParams } from '../src/render/chunkBaker.ts';
import {
  GRASS_CLEARANCE_M,
  bakeGrassGeometry,
  createGrassTuftTexture,
  grassKeepChance,
  grassPlacements,
  type GrassGround,
} from '../src/render/grassField.ts';
import { World } from '../src/world/world.ts';
import { VALLEY_DROP_M } from '../src/world/scenery.ts';

const PARAMS: ChunkParams = {
  rowsPerChunk: 16,
  cols: 65,
  rowSpacing: 4,
  roadColSpacing: 6,
  landscapeColSpacing: 50,
};

function flat(y: number): GrassGround {
  return { at: () => y, roadAt: () => 0 };
}

describe('grass tufts', () => {
  it('draws several opaque blades on a transparent card', () => {
    const tex = createGrassTuftTexture();
    const data = tex.image.data as Uint8Array;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) opaque += 1;
    expect(opaque).toBeGreaterThan(80);
    expect(opaque).toBeLessThan(data.length / 8);
    tex.dispose();
  });

  it('keeps a valley denser than a ridge', () => {
    expect(grassKeepChance(-VALLEY_DROP_M - 1, 0)).toBeGreaterThan(grassKeepChance(12, 0));
  });

  it('stays outside the dirt shoulder', () => {
    const tufts = grassPlacements({
      seed: 'mode7',
      rowStart: 0,
      rowEnd: 16,
      rowSpacing: 4,
      roadColSpacing: 6,
      landscapeColSpacing: 50,
      maxX: 200,
      ground: flat(0),
    });
    expect(tufts.length).toBeGreaterThan(20);
    for (const tuft of tufts) {
      expect(Math.abs(tuft.localX)).toBeGreaterThanOrEqual(GRASS_CLEARANCE_M);
    }
  });

  it('scatters fewer tufts on a ridge than on a valley floor', () => {
    const shared = {
      seed: 'mode7',
      rowStart: 40,
      rowEnd: 56,
      rowSpacing: 4,
      roadColSpacing: 6,
      landscapeColSpacing: 50,
      maxX: 200,
    };
    const valley = grassPlacements({ ...shared, ground: flat(-(VALLEY_DROP_M + 4)) });
    const ridge = grassPlacements({ ...shared, ground: flat(14) });
    expect(valley.length).toBeGreaterThan(ridge.length * 2);
  });

  it('bakes +Z quads whose roots sit on the depth sample', () => {
    const world = new World('mode7');
    const chunk = bakeChunk(world, 2, PARAMS);
    const geometry = bakeGrassGeometry(world, chunk, PARAMS);
    expect(geometry).not.toBeNull();
    const position = geometry?.getAttribute('position');
    expect(position).toBeDefined();
    const count = position?.count ?? 0;
    expect(count % 4).toBe(0);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 4) {
      const z0 = position?.getZ(i) ?? 0;
      const z1 = position?.getZ(i + 1) ?? 1;
      const z2 = position?.getZ(i + 2) ?? 1;
      expect(z0).toBeCloseTo(z1, 5);
      expect(z0).toBeCloseTo(z2, 5);
    }
    geometry?.dispose();
  });
});
