import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { cumulativeOffsetAt, prefixSum } from './bendMath.ts';
import { uvForSurface, type SurfaceKind } from './terrainSurface.ts';

export interface ChunkParams {
  /** Number of row-intervals per chunk (each chunk owns `rowsPerChunk + 1` rows of vertices). */
  rowsPerChunk: number;
  /** Number of columns across the road. Always odd so there's a centre column. */
  cols: number;
  /** World units between adjacent rows on the Z axis. */
  rowSpacing: number;
  /** World units between adjacent columns on the X axis. */
  colSpacing: number;
}

/**
 * A static, world-space mesh segment baked from procedural samples. The
 * geometry is expressed in the chunk's local frame:
 *
 *   X_local = signedCol · colSpacing + (Φ(absRow) − Φ(rowStart))
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

/**
 * Bake one chunk's geometry from the procedural world. Pure: same
 * `(world.seed, world.params, chunkIndex, params)` always produces the
 * same vertex positions and normals. The streamer composes chunks by
 * placing each one at its computed `phiAtStart` along X and at
 * `−rowStart · rowSpacing` along Z; the per-frame skew matrix on the
 * world root finishes the job.
 */
export function bakeChunk(world: World, chunkIndex: number, params: ChunkParams): BakedChunk {
  const { rowsPerChunk, cols: rawCols, rowSpacing, colSpacing } = params;
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

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rowVtx: RowVerts[] = [];

  for (let r = 0; r < vertRows; r++) {
    const absRow = rowStart + r;
    const phiLocal = cumulativeOffsetAt(absRow, rowStart, bends, prefix);
    const z = -r * rowSpacing;
    const left: number[] = new Array<number>(cols).fill(-1);
    const right: number[] = new Array<number>(cols).fill(-1);

    for (let c = 0; c < cols; c++) {
      const signedCol = c - centreCol;
      const x = signedCol * colSpacing + phiLocal;
      const y = world.depth.sample(absRow, signedCol);
      const side = signedCol < 0 ? 'left' : 'right';

      if (c === centreCol - 1) {
        left[c] = pushVertex(positions, uvs, x, y, z, 'shoulder', 'left');
        right[c] = pushVertex(positions, uvs, x, y, z, 'asphalt', 'left');
      } else if (c === centreCol) {
        left[c] = pushVertex(positions, uvs, x, y, z, 'asphalt', 'left');
        right[c] = pushVertex(positions, uvs, x, y, z, 'asphalt', 'right');
      } else if (c === centreCol + 1) {
        left[c] = pushVertex(positions, uvs, x, y, z, 'asphalt', 'right');
        right[c] = pushVertex(positions, uvs, x, y, z, 'shoulder', 'right');
      } else {
        const idx = pushVertex(positions, uvs, x, y, z, 'shoulder', side);
        left[c] = idx;
        right[c] = idx;
      }
    }

    rowVtx.push({ left, right });
  }

  for (let r = 0; r < vertRows - 1; r++) {
    const rowLo = rowVtx[r];
    const rowHi = rowVtx[r + 1];
    if (!rowLo || !rowHi) continue;
    for (let c = 0; c < cols - 1; c++) {
      const a = rowLo.right[c] ?? 0;
      const b = rowLo.left[c + 1] ?? 0;
      const cc = rowHi.right[c] ?? 0;
      const d = rowHi.left[c + 1] ?? 0;
      // Same winding as the legacy grid builder for flat-shading parity.
      indices.push(a, cc, b, b, cc, d);
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

function pushVertex(
  positions: number[],
  uvs: number[],
  x: number,
  y: number,
  z: number,
  surface: SurfaceKind,
  side: 'left' | 'right',
): number {
  const idx = positions.length / 3;
  positions.push(x, y, z);
  const [u, v] = uvForSurface(surface, side);
  uvs.push(u, v);
  return idx;
}
