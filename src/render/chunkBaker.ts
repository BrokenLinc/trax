import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { cumulativeOffsetAt, prefixSum } from './bendMath.ts';

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
 *   Y_local = world.depth.sample(absRow, signedCol)
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

  // Bend window aligned to the chunk: bends[i] is the slope on
  // [rowStart + i − 1, rowStart + i]. Inside the chunk we integrate the
  // slopes bends[1..rowsPerChunk] to step from row rowStart up to rowEnd.
  // bends[0] is the slope at the chunk's leading edge (matches the previous
  // chunk's trailing slope), kept here so cumulativeOffsetAt can resolve a
  // possible queries one step behind the chunk start if a caller ever asks.
  const bends = new Float32Array(vertRows);
  for (let i = 0; i < vertRows; i++) {
    bends[i] = world.bend.sample(rowStart + i);
  }
  const prefix = prefixSum(bends);

  const positions = new Float32Array(vertRows * cols * 3);
  for (let r = 0; r < vertRows; r++) {
    const absRow = rowStart + r;
    const phiLocal = cumulativeOffsetAt(absRow, rowStart, bends, prefix);
    const z = -r * rowSpacing;
    const rowBase = r * cols * 3;
    for (let c = 0; c < cols; c++) {
      const signedCol = c - centreCol;
      const x = signedCol * colSpacing + phiLocal;
      const y = world.depth.sample(absRow, signedCol);
      const idx = rowBase + c * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
    }
  }

  const indices = buildChunkIndices(vertRows, cols);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // Normals are computed once at bake time; the MeshStandardMaterial's
  // flatShading still picks up curvature via fragment-shader derivatives,
  // but populating the attribute keeps lighting reasonable if a future
  // material switches flatShading off.
  geometry.computeVertexNormals();

  const phiLocalSpan = cumulativeOffsetAt(rowEnd, rowStart, bends, prefix);

  return { chunkIndex, rowStart, rowEnd, phiLocalSpan, bends, prefix, geometry };
}

/**
 * Two triangles per quad, matching the order used by the legacy
 * `terrainMesh` so flat-shading derivatives produce the same face
 * orientations as before.
 */
function buildChunkIndices(vertRows: number, cols: number): Uint32Array {
  const quads = (vertRows - 1) * (cols - 1);
  const out = new Uint32Array(quads * 6);
  let w = 0;
  for (let r = 0; r < vertRows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const cc = a + cols;
      const d = cc + 1;
      out[w++] = a;
      out[w++] = cc;
      out[w++] = b;
      out[w++] = b;
      out[w++] = cc;
      out[w++] = d;
    }
  }
  return out;
}
