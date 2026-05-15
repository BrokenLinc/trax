import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { cumulativeOffsetAt } from './bendMath.ts';
import { bakeChunk, type BakedChunk } from './chunkBaker.ts';

export interface StreamerParams {
  rowsPerChunk: number;
  cols: number;
  rowSpacing: number;
  colSpacing: number;
  /** How many rows ahead of the player to keep loaded. */
  rowsAhead: number;
  /** How many rows behind the player to keep loaded. */
  rowsBehind: number;
}

/**
 * Hook that returns a freshly baked chunk for a given index. Defaults to
 * the procedural baker; future authored chunks (boss runs, biomes, set
 * pieces) plug in here by returning a hand-modeled `BakedChunk` for their
 * chunk indices and delegating to the procedural baker for the rest.
 */
export type ChunkBakeSource = (chunkIndex: number) => BakedChunk;

interface LoadedChunk {
  readonly baked: BakedChunk;
  readonly mesh: THREE.Mesh;
  phiAtStart: number;
}

export interface StreamerMaterials {
  main: THREE.Material;
  wireframe: THREE.Material;
}

/**
 * Owns the set of `BakedChunk` meshes parented under a `Group`. Each frame
 * the `update(playerRow)` call ensures chunks in `[playerRow − rowsBehind,
 * playerRow + rowsAhead]` are loaded and chunks outside that range are
 * evicted. Newly loaded chunks inherit `phiAtStart` from an existing
 * adjacent neighbour so the seam stays geometrically continuous. On a
 * "jump" (no overlap with existing chunks, e.g. after `setDistance` or
 * `reseed`) every chunk is evicted and the new first-loaded chunk
 * re-anchors at `phiAtStart = 0`.
 */
export class ChunkStreamer {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, LoadedChunk>();
  private bakeSource: ChunkBakeSource;
  private wireframe = false;

  constructor(
    private world: World,
    private params: StreamerParams,
    private materials: StreamerMaterials,
    bakeSource?: ChunkBakeSource,
  ) {
    this.bakeSource = bakeSource ?? this.defaultBakeSource();
  }

  /** Replace the procedural baker with a custom source (for authored chunks). */
  setBakeSource(source: ChunkBakeSource | null): void {
    this.bakeSource = source ?? this.defaultBakeSource();
    this.invalidate();
  }

  /** Hot-swap the underlying world (e.g. on reseed). Forces a full rebake. */
  setWorld(world: World): void {
    this.world = world;
    this.bakeSource = this.defaultBakeSource();
    this.invalidate();
  }

  /** Drop all loaded chunks. Next `update()` will rebake from scratch. */
  invalidate(): void {
    for (const idx of [...this.chunks.keys()]) this.disposeChunk(idx);
  }

  setWireframe(on: boolean): void {
    if (on === this.wireframe) return;
    this.wireframe = on;
    const mat = on ? this.materials.wireframe : this.materials.main;
    for (const chunk of this.chunks.values()) chunk.mesh.material = mat;
  }

  isWireframe(): boolean {
    return this.wireframe;
  }

  getParams(): StreamerParams {
    return this.params;
  }

  /**
   * Drive the streamer for one frame. After this call:
   *  - chunks in the desired row range are loaded;
   *  - `phiAtStart` values form a consistent chain across loaded chunks;
   *  - the player's containing chunk is guaranteed to be present.
   */
  update(playerRow: number): void {
    const { rowsPerChunk, rowsAhead, rowsBehind } = this.params;
    const minRow = playerRow - rowsBehind;
    const maxRow = playerRow + rowsAhead;
    const minChunk = Math.floor(minRow / rowsPerChunk);
    const maxChunk = Math.floor(maxRow / rowsPerChunk);

    // Detect a "jump": no overlap between currently loaded chunks and the
    // desired range. In that case wipe and start over so the new range
    // re-anchors cleanly at phiAtStart = 0.
    let overlap = false;
    for (const idx of this.chunks.keys()) {
      if (idx >= minChunk && idx <= maxChunk) {
        overlap = true;
        break;
      }
    }
    if (!overlap && this.chunks.size > 0) this.invalidate();

    // Evict anything outside the range. (No-op after a jump-wipe.)
    for (const idx of [...this.chunks.keys()]) {
      if (idx < minChunk || idx > maxChunk) this.disposeChunk(idx);
    }

    // If nothing is loaded, anchor on the chunk containing the player so the
    // matrix translation tracks the player's chunk directly.
    if (this.chunks.size === 0) {
      const anchor = clamp(Math.floor(playerRow / rowsPerChunk), minChunk, maxChunk);
      this.loadChunkAt(anchor, 0);
    }

    // Extend leftward from the current leftmost loaded chunk down to minChunk.
    let leftmost = Infinity;
    for (const idx of this.chunks.keys()) if (idx < leftmost) leftmost = idx;
    while (leftmost > minChunk) {
      const right = this.chunks.get(leftmost);
      if (!right) break;
      const idx = leftmost - 1;
      const baked = this.bakeSource(idx);
      const phiAtStart = right.phiAtStart - baked.phiLocalSpan;
      this.addLoaded(baked, phiAtStart);
      leftmost = idx;
    }

    // Extend rightward.
    let rightmost = -Infinity;
    for (const idx of this.chunks.keys()) if (idx > rightmost) rightmost = idx;
    while (rightmost < maxChunk) {
      const left = this.chunks.get(rightmost);
      if (!left) break;
      const idx = rightmost + 1;
      const baked = this.bakeSource(idx);
      const phiAtStart = left.phiAtStart + left.baked.phiLocalSpan;
      this.addLoaded(baked, phiAtStart);
      rightmost = idx;
    }
  }

  /**
   * World-space X of the player's row, in the same anchor frame as the
   * currently loaded chunks. Returns 0 if the player's chunk isn't loaded
   * yet (caller should always `update()` first).
   */
  getPlayerWorldX(playerRow: number): number {
    const chunk = this.getChunkContaining(playerRow);
    if (!chunk) return 0;
    const phiLocal = cumulativeOffsetAt(
      playerRow,
      chunk.baked.rowStart,
      chunk.baked.bends,
      chunk.baked.prefix,
    );
    return chunk.phiAtStart + phiLocal;
  }

  /**
   * Lerp-smoothed local tangent slope at the player's fractional row. Pulls
   * the two relevant bend samples directly from the world so the result is
   * correct even when the player straddles a chunk seam (where one of the
   * samples may live in the neighbouring chunk's bend window).
   */
  getPlayerTangentSlope(playerRow: number): number {
    const lo = Math.floor(playerRow);
    const frac = playerRow - lo;
    const s1 = this.world.bend.sample(lo + 1);
    const s2 = this.world.bend.sample(lo + 2);
    return (1 - frac) * s1 + frac * s2;
  }

  /** The chunk that contains `playerRow`, or `undefined` if none. */
  getChunkContaining(playerRow: number): LoadedChunk | undefined {
    const idx = Math.floor(playerRow / this.params.rowsPerChunk);
    return this.chunks.get(idx);
  }

  /**
   * Inspector-friendly snapshot of the loaded chunks. Geometry intentionally
   * omitted; pull it from `group.children` if you need it.
   */
  getLoadedChunks(): ReadonlyArray<{
    chunkIndex: number;
    rowStart: number;
    rowEnd: number;
    phiAtStart: number;
  }> {
    return [...this.chunks.values()]
      .map((c) => ({
        chunkIndex: c.baked.chunkIndex,
        rowStart: c.baked.rowStart,
        rowEnd: c.baked.rowEnd,
        phiAtStart: c.phiAtStart,
      }))
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  dispose(): void {
    this.invalidate();
  }

  // ---- internals ---------------------------------------------------------

  private defaultBakeSource(): ChunkBakeSource {
    const chunkParams = {
      rowsPerChunk: this.params.rowsPerChunk,
      cols: this.params.cols,
      rowSpacing: this.params.rowSpacing,
      colSpacing: this.params.colSpacing,
    };
    return (idx) => bakeChunk(this.world, idx, chunkParams);
  }

  private loadChunkAt(chunkIndex: number, phiAtStart: number): void {
    const baked = this.bakeSource(chunkIndex);
    this.addLoaded(baked, phiAtStart);
  }

  private addLoaded(baked: BakedChunk, phiAtStart: number): void {
    const material = this.wireframe ? this.materials.wireframe : this.materials.main;
    const mesh = new THREE.Mesh(baked.geometry, material);
    mesh.frustumCulled = false;
    mesh.position.set(phiAtStart, 0, -baked.rowStart * this.params.rowSpacing);
    this.group.add(mesh);
    this.chunks.set(baked.chunkIndex, { baked, mesh, phiAtStart });
  }

  private disposeChunk(idx: number): void {
    const chunk = this.chunks.get(idx);
    if (!chunk) return;
    this.group.remove(chunk.mesh);
    chunk.baked.geometry.dispose();
    this.chunks.delete(idx);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
