import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { prefixSum, rebuildOffsetsTangentAligned } from './bendMath.ts';

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
}

export const DEFAULT_TERRAIN: TerrainParams = {
  rowsAhead: 60,
  rowsBehind: 14,
  cols: 33,
  rowSpacing: 1.0,
  colSpacing: 0.6,
};

/**
 * The visible mesh is a fixed-topology (rows × cols) grid whose vertex
 * positions are repacked every frame from a sliding window of the world.
 * This avoids reallocating buffers and keeps the GPU upload predictable.
 *
 * Per-vertex coordinates:
 *   X = (col - centreCol) · colSpacing  +  rowOffset
 *   Y = world.depth.sample(absoluteRow, signedCol)
 *   Z = -(absoluteRow - playerRow) · rowSpacing       (forward = −Z)
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly wireMaterial: THREE.MeshBasicMaterial;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly bends: Float32Array;
  private readonly prefix: Float32Array;
  private readonly offsets: Float32Array;
  private params: TerrainParams;
  private centreCol: number;
  private rowCount: number;
  private wireframe = false;

  constructor(
    private world: World,
    params: TerrainParams = DEFAULT_TERRAIN,
  ) {
    this.params = sanitiseParams(params);
    this.rowCount = this.params.rowsAhead + this.params.rowsBehind + 1;
    this.centreCol = Math.floor(this.params.cols / 2);

    const vertCount = this.rowCount * this.params.cols;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const indices = buildIndices(this.rowCount, this.params.cols);

    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(positions, 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(normals, 3);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.MeshStandardMaterial({
      color: 0x8aa0d6,
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

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

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
    this.mesh.material = on ? this.wireMaterial : this.material;
  }

  isWireframe(): boolean {
    return this.wireframe;
  }

  setWorld(world: World): void {
    this.world = world;
  }

  /**
   * Rebuild the mesh's position and normal attributes for the current
   * `playerRow`. Cheap: O(rows · cols) per frame, no allocations.
   */
  update(playerRow: number): void {
    const { rowsBehind, cols, rowSpacing, colSpacing } = this.params;
    const windowRowStart = Math.floor(playerRow) - rowsBehind;
    // Refresh the bend window from the world (cheap, deterministic).
    for (let i = 0; i < this.rowCount; i++) {
      this.bends[i] = this.world.bend.sample(windowRowStart + i);
    }
    prefixSum(this.bends, this.prefix);
    // Tangent-aligned: the rendered road has zero offset AND zero local slope
    // at the player, so they never appear to sit on a tilted track. See
    // src/render/bendMath.ts for the math.
    rebuildOffsetsTangentAligned(
      windowRowStart,
      this.rowCount,
      playerRow,
      this.bends,
      this.prefix,
      this.offsets,
    );

    const positions = this.position.array as Float32Array;
    for (let r = 0; r < this.rowCount; r++) {
      const absRow = windowRowStart + r;
      const z = -(absRow - playerRow) * rowSpacing;
      const xOffset = this.offsets[r] ?? 0;
      const rowBase = r * cols * 3;
      for (let c = 0; c < cols; c++) {
        const signedCol = c - this.centreCol;
        const x = signedCol * colSpacing + xOffset;
        const y = this.world.depth.sample(absRow, signedCol);
        const idx = rowBase + c * 3;
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
      }
    }
    this.position.needsUpdate = true;
    // Flat shading: derive normals from the geometry's triangles.
    this.geometry.computeVertexNormals();
  }

  /** Returns the integer row of the window's first vertex row. */
  getWindowRowStart(playerRow: number): number {
    return Math.floor(playerRow) - this.params.rowsBehind;
  }

  /** Snapshot the current window (no recomputation) for introspection. */
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
    this.geometry.dispose();
    this.material.dispose();
    this.wireMaterial.dispose();
  }
}

export interface TerrainSnapshot {
  rowCount: number;
  cols: number;
  bends: number[];
  prefix: number[];
  offsets: number[];
}

function sanitiseParams(p: TerrainParams): TerrainParams {
  const cols = p.cols % 2 === 0 ? p.cols + 1 : p.cols;
  return { ...p, cols };
}

function buildIndices(rows: number, cols: number): Uint32Array {
  const quads = (rows - 1) * (cols - 1);
  const out = new Uint32Array(quads * 6);
  let w = 0;
  for (let r = 0; r < rows - 1; r++) {
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
