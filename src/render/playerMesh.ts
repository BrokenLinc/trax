import * as THREE from 'three';
import type { World } from '../world/world.ts';

export interface PlayerMeshParams {
  /** Sphere radius in world units. */
  radius: number;
  /**
   * World-unit length of one row along the Z axis. Must match the terrain's
   * `rowSpacing` so the row-direction depth gradient resolves to a real
   * world-space slope. The shared default (1.0) is kept in sync with
   * `DEFAULT_TERRAIN.rowSpacing` in `terrainMesh.ts`.
   */
  rowSpacing: number;
  /** Column spacing along the X axis; mirrors `DEFAULT_TERRAIN.colSpacing`. */
  colSpacing: number;
  /**
   * Half-step used by the central-difference normal estimate. Fractional rows
   * stay well inside the depth map's bilinear cell, so 0.5 is a good balance
   * between locality and noise suppression.
   */
  normalStep: number;
}

export const DEFAULT_PLAYER_MESH: PlayerMeshParams = {
  // 1 world unit = 1 metre; the avatar is a 1 m diameter sphere. The chase
  // camera in `camera.ts` mirrors this value as `SPHERE_CENTRE_OFFSET` when
  // raising its look-at target onto the sphere's centre — keep them in sync.
  radius: 0.5,
  // Mirrors DEFAULT_TERRAIN.{rowSpacing, colSpacing} in terrainMesh.ts; the
  // normal estimate in `update()` uses these as the divisors that turn the
  // depth-map's lattice gradients into real world-space slopes.
  rowSpacing: 4.0,
  colSpacing: 4.0,
  normalStep: 0.5,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Visual avatar for the player. Since the player is pinned to the world
 * origin (the road moves underneath them), the sphere never moves in X or Z;
 * it only follows the terrain in Y and tilts to match the local surface
 * normal sampled from the depth map at `(distance, 0)`.
 *
 * Attached directly to the scene, not to `worldRoot` — the worldFrame matrix
 * is for the terrain and any sprites that live in the world frame; the
 * player is already at the origin in the rendering frame.
 */
export class PlayerMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly params: PlayerMeshParams;
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(params: PlayerMeshParams = DEFAULT_PLAYER_MESH) {
    this.params = params;
    this.geometry = new THREE.SphereGeometry(params.radius, 24, 16);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffb84d,
      roughness: 0.55,
      metalness: 0.15,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.matrixAutoUpdate = true;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /**
   * Place and orient the sphere for the current frame.
   *
   * Sample the depth map at the player's row/column (centre column is 0),
   * sit the sphere `radius` above that height, and rotate WORLD_UP onto the
   * local surface normal so the sphere "leans" with the terrain.
   */
  update(distance: number, world: World): void {
    const p = this.params;
    const centreY = world.depth.sampleBilinear(distance, 0);
    // World origin: the avatar never strays in X or Z (the road moves instead).
    this.mesh.position.set(0, centreY + p.radius, 0);

    const h = p.normalStep;
    const dRow =
      (world.depth.sampleBilinear(distance + h, 0) - world.depth.sampleBilinear(distance - h, 0)) /
      (2 * h);
    const dCol =
      (world.depth.sampleBilinear(distance, h) - world.depth.sampleBilinear(distance, -h)) /
      (2 * h);
    // Lattice gradients → world-space slopes. worldX = col · colSpacing,
    // worldZ = -row · rowSpacing, so ∂Y/∂worldZ = -dRow / rowSpacing.
    const slopeX = dCol / p.colSpacing;
    const slopeZ = -dRow / p.rowSpacing;
    this.tmpNormal.set(-slopeX, 1, -slopeZ).normalize();
    this.tmpQuat.setFromUnitVectors(WORLD_UP, this.tmpNormal);
    this.mesh.quaternion.copy(this.tmpQuat);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
