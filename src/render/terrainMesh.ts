import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { prefixSum, rebuildOffsetsTangentAligned } from './bendMath.ts';
import { ChunkStreamer } from './chunkStreamer.ts';
import { createTerrainSurfaceTexture } from './terrainSurface.ts';
import { WorldFrame } from './worldFrame.ts';

export interface TerrainParams {
  /** How many integer rows visible ahead of the player. */
  rowsAhead: number;
  /** How many integer rows visible behind the player. */
  rowsBehind: number;
  /**
   * Number of columns across the road. Always odd so the road has a true
   * centre column at index `floor(cols/2)`.
   */
  cols: number;
  /** World units between adjacent rows (Z axis). */
  rowSpacing: number;
  /** World units between adjacent columns (X axis). */
  colSpacing: number;
  /**
   * Number of row-intervals per static chunk. A chunk holds
   * `rowsPerChunk + 1` rows of vertices and is baked once when it enters
   * the streamer's range. Smaller → more chunks loaded, less work per
   * chunk bake. Larger → fewer chunks, bigger one-time bakes on crossings.
   */
  rowsPerChunk: number;
}

export const DEFAULT_TERRAIN: TerrainParams = {
  rowsAhead: 60,
  rowsBehind: 14,
  cols: 33,
  // 1 world unit = 1 metre; quads are 4 m × 4 m. Mirrored by
  // DEFAULT_PLAYER_MESH.{rowSpacing, colSpacing} in playerMesh.ts —
  // the player's normal-estimate divides depth-map gradients by these.
  rowSpacing: 4.0,
  colSpacing: 4.0,
  rowsPerChunk: 32,
};

export interface TerrainSnapshot {
  rowCount: number;
  cols: number;
  bends: number[];
  prefix: number[];
  offsets: number[];
}

/**
 * The renderer-side facade over the static-chunk pipeline. It owns
 *
 *  · a `ChunkStreamer` that bakes/evicts static `BakedChunk` meshes,
 *  · a `WorldFrame` that rewrites the worldRoot matrix each frame, and
 *  · a small rolling bend window for the inspector / `debugDraw` centre
 *    line — the same surface the legacy CPU-rebuild renderer exposed.
 *
 * Per-frame cost: ~150 bend samples (for the debug window) + one
 * `Matrix4.multiplyMatrices`. The heavy depth-FBM sampling is amortised
 * across chunk bakes; rows that the player will revisit produce zero
 * extra work because the chunk's vertex buffer is already populated.
 */
export class TerrainMesh {
  /** Scene-graph attachment point. Added to the scene by `app.ts`. */
  readonly mesh: THREE.Group;
  private readonly worldFrame: WorldFrame;
  private readonly streamer: ChunkStreamer;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly surfaceTexture: THREE.DataTexture;
  private readonly wireMaterial: THREE.MeshBasicMaterial;
  private readonly bends: Float32Array;
  private readonly prefix: Float32Array;
  private readonly offsets: Float32Array;
  private params: TerrainParams;
  private rowCount: number;
  private windowRowStart = 0;
  private wireframe = false;
  private world: World;
  private readonly savedMatrix = new THREE.Matrix4();

  constructor(world: World, params: TerrainParams = DEFAULT_TERRAIN) {
    this.world = world;
    this.params = sanitiseParams(params);
    this.rowCount = this.params.rowsAhead + this.params.rowsBehind + 1;

    this.surfaceTexture = createTerrainSurfaceTexture();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.surfaceTexture,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fc7ff,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });

    this.streamer = new ChunkStreamer(
      world,
      {
        rowsPerChunk: this.params.rowsPerChunk,
        cols: this.params.cols,
        rowSpacing: this.params.rowSpacing,
        colSpacing: this.params.colSpacing,
        rowsAhead: this.params.rowsAhead,
        rowsBehind: this.params.rowsBehind,
      },
      { main: this.material, wireframe: this.wireMaterial },
    );
    this.worldFrame = new WorldFrame(this.streamer, {
      rowSpacing: this.params.rowSpacing,
    });
    this.mesh = this.worldFrame.worldRoot;

    this.bends = new Float32Array(this.rowCount);
    this.prefix = new Float32Array(this.rowCount + 1);
    this.offsets = new Float32Array(this.rowCount);
  }

  getParams(): TerrainParams {
    return this.params;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  setWireframe(on: boolean): void {
    if (on === this.wireframe) return;
    this.wireframe = on;
    this.streamer.setWireframe(on);
  }

  isWireframe(): boolean {
    return this.wireframe;
  }

  setWorld(world: World): void {
    this.world = world;
    this.streamer.setWorld(world);
  }

  /** Debug toggle: when on, the worldRoot matrix omits the X-from-Z shear. */
  setUnskewed(on: boolean): void {
    this.worldFrame.setUnskewed(on);
  }

  isUnskewed(): boolean {
    return this.worldFrame.isUnskewed();
  }

  /**
   * Temporarily switch the worldRoot matrix to its translate-only (unskewed)
   * form. Pair with `popUnskewedView()` after rendering. Used by the
   * top-down debug view so it can show the road's true world-space
   * curvature without disturbing the main render.
   */
  pushUnskewedView(playerRow: number): void {
    this.savedMatrix.copy(this.mesh.matrix);
    this.worldFrame.setUnskewed(true);
    this.worldFrame.refreshMatrix(playerRow);
  }

  popUnskewedView(): void {
    this.worldFrame.setUnskewed(false);
    this.mesh.matrix.copy(this.savedMatrix);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  /**
   * Drive one frame: streamer + matrix update, plus refresh the small bend
   * window that feeds `snapshot()` and the debug centre line. The bend
   * window is independent of the chunk geometry and is much cheaper to
   * rebuild than the legacy per-vertex pass.
   */
  update(playerRow: number): void {
    this.worldFrame.update(playerRow);
    this.windowRowStart = Math.floor(playerRow) - this.params.rowsBehind;
    for (let i = 0; i < this.rowCount; i++) {
      this.bends[i] = this.world.bend.sample(this.windowRowStart + i);
    }
    prefixSum(this.bends, this.prefix);
    rebuildOffsetsTangentAligned(
      this.windowRowStart,
      this.rowCount,
      playerRow,
      this.bends,
      this.prefix,
      this.offsets,
    );
  }

  getWindowRowStart(playerRow: number): number {
    return Math.floor(playerRow) - this.params.rowsBehind;
  }

  snapshot(): TerrainSnapshot {
    return {
      rowCount: this.rowCount,
      cols: this.params.cols,
      bends: Array.from(this.bends),
      prefix: Array.from(this.prefix),
      offsets: Array.from(this.offsets),
    };
  }

  dispose(): void {
    this.streamer.dispose();
    this.material.dispose();
    this.surfaceTexture.dispose();
    this.wireMaterial.dispose();
  }
}

function sanitiseParams(p: TerrainParams): TerrainParams {
  const cols = p.cols % 2 === 0 ? p.cols + 1 : p.cols;
  const rowsPerChunk = Math.max(1, Math.floor(p.rowsPerChunk));
  return { ...p, cols, rowsPerChunk };
}
