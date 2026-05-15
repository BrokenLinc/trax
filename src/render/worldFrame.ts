import * as THREE from 'three';
import type { ChunkStreamer } from './chunkStreamer.ts';

export interface WorldFrameParams {
  rowSpacing: number;
}

/**
 * The per-frame coordinate transform that puts the player at the world
 * origin and "unbends" the road's local tangent. Mathematically:
 *
 *   M = Shear_xz(s / rowSpacing)  ·  Translate(−playerWorldX, 0, −playerZ)
 *
 * where `s` is the lerp-smoothed tangent slope at the player's fractional
 * row (see `bendMath.ts`), `playerWorldX = Φ(playerRow)` in the streamer's
 * anchor frame, and `playerZ = −playerRow · rowSpacing`. Apply this matrix
 * to any world-space point and you get the visible Mode-7 view — same
 * picture the legacy per-vertex CPU pass produced, just expressed as a
 * single `Matrix4` on the scene root.
 *
 * The unskewed toggle is a debug affordance: it sets the shear factor to
 * zero so the top-down view can show the road's true world-space curve.
 */
export class WorldFrame {
  readonly worldRoot = new THREE.Group();
  private readonly tmpTranslate = new THREE.Matrix4();
  private readonly tmpShear = new THREE.Matrix4();
  private unskewed = false;

  constructor(
    private readonly streamer: ChunkStreamer,
    private readonly params: WorldFrameParams,
  ) {
    this.worldRoot.matrixAutoUpdate = false;
    this.worldRoot.add(this.streamer.group);
  }

  /**
   * Push the streamer one frame forward and rewrite `worldRoot.matrix`.
   * Order: streamer first (so the chunk that contains the player is
   * guaranteed present and `getPlayerWorldX` is valid), then matrix.
   */
  update(playerRow: number): void {
    this.streamer.update(playerRow);
    this.refreshMatrix(playerRow);
  }

  /**
   * Recompose `worldRoot.matrix` for the current `unskewed` flag without
   * driving the streamer. Used by the top-down debug view when toggling
   * between world-space and skewed presentations.
   */
  refreshMatrix(playerRow: number): void {
    const playerWorldX = this.streamer.getPlayerWorldX(playerRow);
    const playerZ = -playerRow * this.params.rowSpacing;
    const s = this.unskewed ? 0 : this.streamer.getPlayerTangentSlope(playerRow);
    this.tmpTranslate.makeTranslation(-playerWorldX, 0, -playerZ);
    this.tmpShear.makeShear(0, 0, 0, 0, s / this.params.rowSpacing, 0);
    this.worldRoot.matrix.multiplyMatrices(this.tmpShear, this.tmpTranslate);
    this.worldRoot.matrixWorldNeedsUpdate = true;
  }

  /** Debug toggle for the bird's-eye view: disables the X-from-Z shear. */
  setUnskewed(on: boolean): void {
    this.unskewed = on;
  }

  isUnskewed(): boolean {
    return this.unskewed;
  }
}
