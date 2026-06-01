import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { cumulativeOffsetAt, prefixSum } from './bendMath.ts';
import { worldXForSignedCol } from './meshLattice.ts';
import { chunkLatticeUv } from './terrainSurface.ts';

export interface ChunkParams {
  /** Number of row-intervals per chunk (each chunk owns `rowsPerChunk + 1` rows of vertices). */
  rowsPerChunk: number;
  /** Number of columns across the road. Always odd so there's a centre column. */
  cols: number;
  /** World units between adjacent rows on the Z axis. */
  rowSpacing: number;
  /** Column spacing on X for the road band (signedCol −1, 0, +1). */
  roadColSpacing: number;
  /** Column spacing on X from signedCol ±1 outward. */
  landscapeColSpacing: number;
}

/**
 * A static, world-space mesh segment baked from procedural samples. The
 * geometry is expressed in the chunk's local frame:
 *
 *   X_local = worldXForSignedCol(signedCol, roadColSpacing, landscapeColSpacing)
 *             + (Φ(absRow) − Φ(rowStart))
 *   Y_local = world.depth.sample(absRow, signedCol) — asphalt cols share col-0 height
 *   Z_local = −(absRow − rowStart) · rowSpacing
 *
 * Chunks neighbour seamlessly: chunk N's last vertex row (row `rowEnd`) is
 * positionally identical to chunk N+1's first vertex row, so a streamer can
 * slot them edge-to-edge without a visible seam.
 */
export interface BakedChunk {
  chunkIndex: number;
  /** Inclusive absolute row of the chunk's first vertex row. */
  rowStart: number;
  /** Inclusive absolute row of the chunk's last vertex row (= rowStart + rowsPerChunk). */
  rowEnd: number;
  /** Cumulative bend offset Φ(rowEnd) − Φ(rowStart) accumulated within this chunk. */
  phiLocalSpan: number;
  /**
   * Bends sampled across the chunk's row range. `bends[i]` is the slope on
   * `[rowStart + i − 1, rowStart + i]`, in the bend-math convention. Used by
   * the streamer to compute the player's world-space X and tangent slope
   * without re-sampling the world each frame.
   */
  bends: Float32Array;
  /** Exclusive prefix sum of `bends`. */
  prefix: Float32Array;
  geometry: THREE.BufferGeometry;
}

interface RowVerts {
  /** Vertex index on the left face of column `c` (toward lower `c`). */
  left: number[];
  /** Vertex index on the right face of column `c` (toward higher `c`). */
  right: number[];
}

interface ScratchCorner {
  x: number;
  y: number;
  z: number;
}

/**
 * Bake one chunk's geometry from the procedural world. Pure: same
 * `(world.seed, world.params, chunkIndex, params)` always produces the
 * same vertex positions and normals. The streamer composes chunks by
 * placing each one at its computed `phiAtStart` along X and at
 * `−rowStart · rowSpacing` along Z; the per-frame skew matrix on the
 * world root finishes the job.
 */
export function bakeChunk(world: World, chunkIndex: number, params: ChunkParams): BakedChunk {
  const { rowsPerChunk, cols: rawCols, rowSpacing, roadColSpacing, landscapeColSpacing } = params;
  if (rowsPerChunk <= 0) {
    throw new RangeError(`bakeChunk: rowsPerChunk must be > 0, got ${rowsPerChunk}`);
  }
  if (rawCols <= 0) {
    throw new RangeError(`bakeChunk: cols must be > 0, got ${rawCols}`);
  }
  const cols = rawCols % 2 === 0 ? rawCols + 1 : rawCols;
  const centreCol = Math.floor(cols / 2);
  const rowStart = chunkIndex * rowsPerChunk;
  const rowEnd = rowStart + rowsPerChunk;
  const vertRows = rowsPerChunk + 1;

  const bends = new Float32Array(vertRows);
  for (let i = 0; i < vertRows; i++) {
    bends[i] = world.bend.sample(rowStart + i);
  }
  const prefix = prefixSum(bends);

  const scratchPositions: number[] = [];
  const rowVtx: RowVerts[] = [];

  for (let r = 0; r < vertRows; r++) {
    const absRow = rowStart + r;
    const phiLocal = cumulativeOffsetAt(absRow, rowStart, bends, prefix);
    const z = -r * rowSpacing;
    const left: number[] = new Array<number>(cols).fill(-1);
    const right: number[] = new Array<number>(cols).fill(-1);

    for (let c = 0; c < cols; c++) {
      const signedCol = c - centreCol;
      const x = worldXForSignedCol(signedCol, roadColSpacing, landscapeColSpacing) + phiLocal;
      const y = world.depth.sample(absRow, signedCol);

      if (c === centreCol - 1) {
        left[c] = pushScratchVertex(scratchPositions, x, y, z);
        right[c] = pushScratchVertex(scratchPositions, x, y, z);
      } else if (c === centreCol) {
        left[c] = pushScratchVertex(scratchPositions, x, y, z);
        right[c] = pushScratchVertex(scratchPositions, x, y, z);
      } else if (c === centreCol + 1) {
        left[c] = pushScratchVertex(scratchPositions, x, y, z);
        right[c] = pushScratchVertex(scratchPositions, x, y, z);
      } else {
        const idx = pushScratchVertex(scratchPositions, x, y, z);
        left[c] = idx;
        right[c] = idx;
      }
    }

    rowVtx.push({ left, right });
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < vertRows - 1; r++) {
    const rowLo = rowVtx[r];
    const rowHi = rowVtx[r + 1];
    if (!rowLo || !rowHi) continue;
    for (let c = 0; c < cols - 1; c++) {
      const ia = rowLo.right[c] ?? 0;
      const ib = rowLo.left[c + 1] ?? 0;
      const ic = rowHi.right[c] ?? 0;
      const id = rowHi.left[c + 1] ?? 0;
      const ca = readScratchCorner(scratchPositions, ia);
      const cb = readScratchCorner(scratchPositions, ib);
      const cc = readScratchCorner(scratchPositions, ic);
      const cd = readScratchCorner(scratchPositions, id);
      const uv2a = chunkLatticeUv(r, c, 0, 0, rowsPerChunk, cols);
      const uv2b = chunkLatticeUv(r, c, 1, 0, rowsPerChunk, cols);
      const uv2c = chunkLatticeUv(r, c, 0, 1, rowsPerChunk, cols);
      const uv2d = chunkLatticeUv(r, c, 1, 1, rowsPerChunk, cols);
      const a = emitCorner(positions, uvs, ca, uv2a);
      const b = emitCorner(positions, uvs, cb, uv2b);
      const ccIdx = emitCorner(positions, uvs, cc, uv2c);
      const d = emitCorner(positions, uvs, cd, uv2d);
      indices.push(a, ccIdx, b, b, ccIdx, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const phiLocalSpan = cumulativeOffsetAt(rowEnd, rowStart, bends, prefix);

  return { chunkIndex, rowStart, rowEnd, phiLocalSpan, bends, prefix, geometry };
}

function pushScratchVertex(positions: number[], x: number, y: number, z: number): number {
  const idx = positions.length / 3;
  positions.push(x, y, z);
  return idx;
}

function readScratchCorner(positions: number[], idx: number): ScratchCorner {
  const i = idx * 3;
  return {
    x: positions[i] ?? 0,
    y: positions[i + 1] ?? 0,
    z: positions[i + 2] ?? 0,
  };
}

function emitCorner(
  positions: number[],
  uvs: number[],
  corner: ScratchCorner,
  uv: [number, number],
): number {
  const idx = positions.length / 3;
  positions.push(corner.x, corner.y, corner.z);
  uvs.push(uv[0], uv[1]);
  return idx;
}
