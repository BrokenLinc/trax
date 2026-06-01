import { describe, expect, it } from 'vitest';
import { cumulativeOffsetAt } from '../src/render/bendMath.ts';
import { bakeChunk, type ChunkParams } from '../src/render/chunkBaker.ts';
import { worldXForSignedCol } from '../src/render/meshLattice.ts';
import { chunkLatticeUv, isAsphaltQuad } from '../src/render/terrainSurface.ts';
import { World } from '../src/world/world.ts';

const PARAMS: ChunkParams = {
  rowsPerChunk: 8,
  cols: 5,
  rowSpacing: 1.0,
  roadColSpacing: 0.6,
  landscapeColSpacing: 0.6,
};

function positions(geometry: ReturnType<typeof bakeChunk>['geometry']): Float32Array {
  return geometry.getAttribute('position').array as Float32Array;
}

function uvs(geometry: ReturnType<typeof bakeChunk>['geometry']): Float32Array {
  return geometry.getAttribute('uv').array as Float32Array;
}

function uvAt(geometry: ReturnType<typeof bakeChunk>['geometry'], idx: number): [number, number] {
  const arr = uvs(geometry);
  return [arr[idx * 2] ?? 0, arr[idx * 2 + 1] ?? 0];
}

function findVertexIndicesAt(
  geometry: ReturnType<typeof bakeChunk>['geometry'],
  x: number,
  y: number,
  z: number,
  tol = 1e-5,
): number[] {
  const arr = positions(geometry);
  const out: number[] = [];
  for (let i = 0; i < arr.length; i += 3) {
    if (
      Math.abs((arr[i] ?? 0) - x) < tol &&
      Math.abs((arr[i + 1] ?? 0) - y) < tol &&
      Math.abs((arr[i + 2] ?? 0) - z) < tol
    ) {
      out.push(i / 3);
    }
  }
  return out;
}

function logicalCorner(
  world: World,
  chunk: ReturnType<typeof bakeChunk>,
  params: ChunkParams,
  r: number,
  c: number,
): [number, number, number] {
  const cols = params.cols % 2 === 0 ? params.cols + 1 : params.cols;
  const centre = Math.floor(cols / 2);
  const signedCol = c - centre;
  const absRow = chunk.rowStart + r;
  const phi = cumulativeOffsetAt(absRow, chunk.rowStart, chunk.bends, chunk.prefix);
  const x = worldXForSignedCol(signedCol, params.roadColSpacing, params.landscapeColSpacing) + phi;
  const y = world.depth.sample(absRow, signedCol);
  const z = -r * params.rowSpacing;
  return [x, y, z];
}

/** Final mesh uses four independent corners per quad. */
function vertsPerChunk(rowsPerChunk: number, cols: number): number {
  const oddCols = cols % 2 === 0 ? cols + 1 : cols;
  return 4 * rowsPerChunk * (oddCols - 1);
}

/** Corner vertex indices for quad `(quadRow, quadCol)`. */
function quadCornerIndices(
  geometry: ReturnType<typeof bakeChunk>['geometry'],
  quadRow: number,
  quadCol: number,
  cols: number,
): number[] {
  const oddCols = cols % 2 === 0 ? cols + 1 : cols;
  const base = (quadRow * (oddCols - 1) + quadCol) * 6;
  const index = geometry.getIndex()?.array ?? [];
  return [
    ...new Set([
      index[base] ?? 0,
      index[base + 1] ?? 0,
      index[base + 2] ?? 0,
      index[base + 3] ?? 0,
      index[base + 4] ?? 0,
      index[base + 5] ?? 0,
    ]),
  ];
}

describe('bakeChunk — geometry parity', () => {
  it('places vertices at worldXForSignedCol + Φ_local, Y = depth(row, col), Z = −r·rowSpacing', () => {
    const world = new World('chunkBakerSpec');
    const chunk = bakeChunk(world, 0, PARAMS);
    const cols = PARAMS.cols % 2 === 0 ? PARAMS.cols + 1 : PARAMS.cols;

    for (let r = 0; r <= PARAMS.rowsPerChunk; r++) {
      for (let c = 0; c < cols; c++) {
        const [expectedX, expectedY, expectedZ] = logicalCorner(world, chunk, PARAMS, r, c);
        const hits = findVertexIndicesAt(chunk.geometry, expectedX, expectedY, expectedZ);
        expect(hits.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses road vs landscape column spacing for X when they differ', () => {
    const world = new World('splitSpacing');
    const params: ChunkParams = {
      ...PARAMS,
      roadColSpacing: 1,
      landscapeColSpacing: 3,
    };
    const chunk = bakeChunk(world, 0, params);
    const cols = params.cols % 2 === 0 ? params.cols + 1 : params.cols;
    const centre = Math.floor(cols / 2);
    const signedCol = cols - 1 - centre;
    const [x] = logicalCorner(world, chunk, params, 0, cols - 1);
    expect(x - cumulativeOffsetAt(chunk.rowStart, chunk.rowStart, chunk.bends, chunk.prefix)).toBe(
      worldXForSignedCol(signedCol, 1, 3),
    );
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
    const cols = PARAMS.cols % 2 === 0 ? PARAMS.cols + 1 : PARAMS.cols;
    const centre = Math.floor(cols / 2);
    const phiAtStartN = 0;
    const phiAtStartNext = phiAtStartN + chunkN.phiLocalSpan;
    const [xLast, yLast] = logicalCorner(world, chunkN, PARAMS, PARAMS.rowsPerChunk, centre);
    const [xFirst, yFirst] = logicalCorner(world, chunkNext, PARAMS, 0, centre);
    expect(phiAtStartN + xLast).toBeCloseTo(phiAtStartNext + xFirst, 5);
    expect(yLast).toBeCloseTo(yFirst, 5);
  });

  it('chunk N last row and chunk N+1 first row have the same world-Z when chunks sit at −rowStart·rowSpacing', () => {
    const world = new World('seamSpec');
    const chunkN = bakeChunk(world, 0, PARAMS);
    const chunkNext = bakeChunk(world, 1, PARAMS);
    const [xLast, yLast, zLast] = logicalCorner(world, chunkN, PARAMS, PARAMS.rowsPerChunk, 0);
    const [xFirst, yFirst, zFirst] = logicalCorner(world, chunkNext, PARAMS, 0, 0);
    void xLast;
    void yLast;
    void xFirst;
    void yFirst;
    const zN = -chunkN.rowStart * PARAMS.rowSpacing;
    const zNext = -chunkNext.rowStart * PARAMS.rowSpacing;
    expect(zN + zLast).toBeCloseTo(zNext + zFirst, 5);
  });
});

describe('bakeChunk — determinism', () => {
  it('two bakes with the same (seed, chunkIndex, params) match bit-for-bit (modulo float)', () => {
    const w1 = new World('det');
    const w2 = new World('det');
    const a = bakeChunk(w1, 3, PARAMS);
    const b = bakeChunk(w2, 3, PARAMS);
    const aArr = positions(a.geometry);
    const bArr = positions(b.geometry);
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
    const aArr = positions(a.geometry);
    const bArr = positions(b.geometry);
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
    const cols = 5;
    const arr = positions(chunk.geometry);
    expect(arr.length).toBe(vertsPerChunk(PARAMS.rowsPerChunk, cols) * 3);
  });
});

describe('bakeChunk — chunk-fill lattice UVs', () => {
  it('exposes uv attribute with one entry per vertex and no color attribute', () => {
    const world = new World('uvSpec');
    const chunk = bakeChunk(world, 0, PARAMS);
    const vertCount = vertsPerChunk(PARAMS.rowsPerChunk, PARAMS.cols);
    expect(uvs(chunk.geometry).length).toBe(vertCount * 2);
    expect(chunk.geometry.getAttribute('color')).toBeUndefined();
  });

  it('spans lattice UVs across each quad', () => {
    const world = new World('uvSpan');
    const chunk = bakeChunk(world, 0, PARAMS);
    const verts = quadCornerIndices(chunk.geometry, 0, 0, PARAMS.cols);
    expect(verts.length).toBe(4);
    const uValues = verts.map((idx) => uvAt(chunk.geometry, idx)[0]);
    const vValues = verts.map((idx) => uvAt(chunk.geometry, idx)[1]);
    expect(Math.min(...uValues)).toBeCloseTo(0, 6);
    expect(Math.max(...uValues)).toBeCloseTo(0.25, 6);
    expect(Math.min(...vValues)).toBeCloseTo(0, 6);
    expect(Math.max(...vValues)).toBeCloseTo(1 / PARAMS.rowsPerChunk, 6);
  });

  it('assigns chunkLatticeUv at road quad corners', () => {
    const world = new World('uvSpec');
    const params = { ...PARAMS, cols: 33 };
    const chunk = bakeChunk(world, 0, params);
    const cols = 33;
    const centre = Math.floor(cols / 2);
    const c = centre - 1;
    expect(isAsphaltQuad(c, centre)).toBe(true);
    const expected = chunkLatticeUv(0, c, 0, 0, params.rowsPerChunk, cols);
    const [x, y, z] = logicalCorner(world, chunk, params, 0, c);
    const hits = findVertexIndicesAt(chunk.geometry, x, y, z);
    const matched = hits.some((idx) => {
      const [u, v] = uvAt(chunk.geometry, idx);
      return Math.abs(u - expected[0]) < 1e-6 && Math.abs(v - expected[1]) < 1e-6;
    });
    expect(matched).toBe(true);
  });

  it('maps chunk seam rows to v=1 on chunk N and v=0 on chunk N+1', () => {
    const world = new World('uvSeam');
    const chunkN = bakeChunk(world, 0, PARAMS);
    const chunkNext = bakeChunk(world, 1, PARAMS);
    const lastRow = PARAMS.rowsPerChunk;
    const col = 0;
    const [xLast, yLast, zLast] = logicalCorner(world, chunkN, PARAMS, lastRow, col);
    const [xFirst, yFirst, zFirst] = logicalCorner(world, chunkNext, PARAMS, 0, col);
    const lastHits = findVertexIndicesAt(chunkN.geometry, xLast, yLast, zLast);
    const firstHits = findVertexIndicesAt(chunkNext.geometry, xFirst, yFirst, zFirst);
    const lastV = lastHits.map((idx) => uvAt(chunkN.geometry, idx)[1]);
    const firstV = firstHits.map((idx) => uvAt(chunkNext.geometry, idx)[1]);
    expect(lastV.some((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    expect(firstV.some((v) => Math.abs(v - 0) < 1e-6)).toBe(true);
  });
});
