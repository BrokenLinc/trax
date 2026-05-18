import * as THREE from 'three';

export interface WaterPlaneParams {
  /** Fixed sea level in scene space (metres). Below flattened road datum (~0). */
  y: number;
  /** Edge length of the square plane in world units. */
  size: number;
}

export const DEFAULT_WATER_PLANE: WaterPlaneParams = {
  y: -4,
  size: 512,
};

/**
 * Large horizontal water surface at a fixed scene Y. Attached to the scene
 * root (not worldRoot) so it does not scroll or shear with the road — valleys
 * dip into it while hills rise above.
 */
export class WaterPlane {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private params: WaterPlaneParams;

  constructor(params: WaterPlaneParams = DEFAULT_WATER_PLANE) {
    this.params = params;
    this.geometry = new THREE.PlaneGeometry(params.size, params.size);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x3a5a8a,
      roughness: 0.35,
      metalness: 0.1,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = params.y;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
  }

  getParams(): WaterPlaneParams {
    return this.params;
  }

  setParams(params: WaterPlaneParams): void {
    this.params = params;
    this.mesh.position.y = params.y;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
