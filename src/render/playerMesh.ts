import * as THREE from 'three';
import { signedColFromWorldX } from './meshLattice.ts';
import type { World } from '../world/world.ts';

export interface PlayerMeshParams {
  /** Sphere radius in world units. */
  radius: number;
}

export const DEFAULT_PLAYER_MESH: PlayerMeshParams = {
  // 1 world unit = 1 metre; the avatar is a 1 m diameter sphere. The chase
  // camera in `camera.ts` mirrors this value as `SPHERE_CENTRE_OFFSET` when
  // raising its look-at target onto the sphere's centre — keep them in sync.
  radius: 0.5,
};

/**
 * Visual avatar for the player. Since the player is pinned to the world
 * origin (the road moves underneath them), the sphere never moves in X or Z;
 * it only follows the terrain in Y.
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

  /** Place the sphere at the depth sample under the player's lateral offset. */
  update(
    distance: number,
    world: World,
    lateralX: number,
    roadColSpacing: number,
    landscapeColSpacing: number,
  ): void {
    const col = signedColFromWorldX(lateralX, roadColSpacing, landscapeColSpacing);
    const groundY = world.depth.sampleBilinear(distance, col);
    this.mesh.position.set(0, groundY + this.params.radius, 0);
    this.mesh.quaternion.identity();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
