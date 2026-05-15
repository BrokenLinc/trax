import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world.ts';
import { bakeChunk, type ChunkParams } from '../src/render/chunkBaker.ts';

const PARAMS: ChunkParams = {
  rowsPerChunk: 8,
  cols: 5,
  rowSpacing: 1.0,
  colSpacing: 0.6,
};

function vertex(
  geometry: ReturnType<typeof bakeChunk>['geometry'],
  idx: number,
): [number, number, number] {
  const arr = geometry.getAttribute('position').array as Float32Array;
  return [arr[idx * 3] ?? 0, arr[idx * 3 + 1] ?? 0, arr[idx * 3 + 2] ?? 0];
}

describe('bakeChunk — geometry parity', () => {
  it('places vertices at the formula X = signedCol·colSpacing + Φ_local, Y = depth(row, col), Z = −r·rowSpacing', () => {
    const world = new World('chunkBakerSpec');
    const chunk = bakeChunk(world, 0, PARAMS);
    const cols = PARAMS.cols % 2 === 0 ? PARAMS.cols + 1 : PARAMS.cols;
    const centre = Math.floor(cols / 2);

    // Walk the chunk row by row, integrating bends locally just like the
    // baker should, and compare to the baked vertex positions.
    let phi = 0;
    for (let r = 0; r <= PARAMS.rowsPerChunk; r++) {
      const absRow = chunk.rowStart + r;
      const z = -r * PARAMS.rowSpacing;
      for (let c = 0; c < cols; c++) {
        const signedCol = c - centre;
        const expectedX = signedCol * PARAMS.colSpacing + phi;
        const expectedY = world.depth.sample(absRow, signedCol);
        const idx = r * cols + c;
        const [x, y, zv] = vertex(chunk.geometry, idx);
        expect(x).toBeCloseTo(expectedX, 5);
        expect(y).toBeCloseTo(expectedY, 5);
        expect(zv).toBeCloseTo(z, 5);
      }
      // Step phi by the slope into the next row, matching the bend window's
      // bends[r+1] interpretation.
      if (r < PARAMS.rowsPerChunk) {
        phi += world.bend.sample(absRow + 1);
      }
    }
  });

  it('reports phiLocalSpan equal to the sum of in-chunk slopes', () => {
    const world = new World('chunkBakerSpec');
    const chunk = bakeChunk(world, 0, PARAMS);
    let expected = 0;
    for (let r = 1; r <= PARAMS.rowsPerChunk; r++) {
      expected += world.bend.sample(chunk.rowStart + r);
    }
    expect(chunk.phiLocalSpan).toBeCloseTo(expected, 5);
  });

  it('rowStart equals chunkIndex · rowsPerChunk and rowEnd is the inclusive last row', () => {
    const world = new World('chunkBakerSpec');
    const chunkA = bakeChunk(world, -3, PARAMS);
    expect(chunkA.rowStart).toBe(-3 * PARAMS.rowsPerChunk);
    expect(chunkA.rowEnd).toBe(chunkA.rowStart + PARAMS.rowsPerChunk);
    const chunkB = bakeChunk(world, 17, PARAMS);
    expect(chunkB.rowStart).toBe(17 * PARAMS.rowsPerChunk);
    expect(chunkB.rowEnd).toBe(chunkB.rowStart + PARAMS.rowsPerChunk);
  });
});

describe('bakeChunk — seam continuity', () => {
  it('chunk N+1 first row aligns with chunk N last row when placed by phiAtStart', () => {
    const world = new World('seamSpec');
    const chunkN = bakeChunk(world, 0, PARAMS);
    const chunkNext = bakeChunk(world, 1, PARAMS);
    const cols = PARAMS.cols;
    // World-space X of chunk N's last row, centre col:
    const phiAtStartN = 0;
    const phiAtStartNext = phiAtStartN + chunkN.phiLocalSpan;
    const lastRowIdx = PARAMS.rowsPerChunk * cols + Math.floor(cols / 2);
    const firstRowIdx = 0 * cols + Math.floor(cols / 2);
    const [xLastLocal, yLast] = vertex(chunkN.geometry, lastRowIdx);
    const [xFirstLocal, yFirst] = vertex(chunkNext.geometry, firstRowIdx);
    expect(phiAtStartN + xLastLocal).toBeCloseTo(phiAtStartNext + xFirstLocal, 5);
    // Y is sampled from depth at the same (absRow, col), so it must agree exactly.
    expect(yLast).toBeCloseTo(yFirst, 5);
  });

  it('chunk N last row and chunk N+1 first row have the same world-Z when chunks sit at −rowStart·rowSpacing', () => {
    const world = new World('seamSpec');
    const chunkN = bakeChunk(world, 0, PARAMS);
    const chunkNext = bakeChunk(world, 1, PARAMS);
    const cols = PARAMS.cols;
    const lastRowIdx = PARAMS.rowsPerChunk * cols;
    const firstRowIdx = 0;
    const [, , zLastLocal] = vertex(chunkN.geometry, lastRowIdx);
    const [, , zFirstLocal] = vertex(chunkNext.geometry, firstRowIdx);
    const zN = -chunkN.rowStart * PARAMS.rowSpacing;
    const zNext = -chunkNext.rowStart * PARAMS.rowSpacing;
    expect(zN + zLastLocal).toBeCloseTo(zNext + zFirstLocal, 5);
  });
});

describe('bakeChunk — determinism', () => {
  it('two bakes with the same (seed, chunkIndex, params) match bit-for-bit (modulo float)', () => {
    const w1 = new World('det');
    const w2 = new World('det');
    const a = bakeChunk(w1, 3, PARAMS);
    const b = bakeChunk(w2, 3, PARAMS);
    const aArr = a.geometry.getAttribute('position').array as Float32Array;
    const bArr = b.geometry.getAttribute('position').array as Float32Array;
    expect(aArr.length).toBe(bArr.length);
    for (let i = 0; i < aArr.length; i++) {
      expect(aArr[i]).toBeCloseTo(bArr[i] ?? 0, 6);
    }
  });

  it('different seeds produce different chunks', () => {
    const w1 = new World('seedA');
    const w2 = new World('seedB');
    const a = bakeChunk(w1, 3, PARAMS);
    const b = bakeChunk(w2, 3, PARAMS);
    const aArr = a.geometry.getAttribute('position').array as Float32Array;
    const bArr = b.geometry.getAttribute('position').array as Float32Array;
    let anyDiff = false;
    for (let i = 0; i < aArr.length; i++) {
      if (Math.abs((aArr[i] ?? 0) - (bArr[i] ?? 0)) > 1e-6) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });
});

describe('bakeChunk — guard rails', () => {
  it('throws on non-positive rowsPerChunk', () => {
    const world = new World('guards');
    expect(() => bakeChunk(world, 0, { ...PARAMS, rowsPerChunk: 0 })).toThrow(/rowsPerChunk/);
  });

  it('throws on non-positive cols', () => {
    const world = new World('guards');
    expect(() => bakeChunk(world, 0, { ...PARAMS, cols: 0 })).toThrow(/cols/);
  });

  it('rounds even cols up to the next odd so there is a centre column', () => {
    const world = new World('guards');
    const chunk = bakeChunk(world, 0, { ...PARAMS, cols: 4 });
    // 4 -> 5 → 5 × (rowsPerChunk+1) vertices, 3 floats each.
    const arr = chunk.geometry.getAttribute('position').array as Float32Array;
    expect(arr.length).toBe(5 * (PARAMS.rowsPerChunk + 1) * 3);
  });
});
