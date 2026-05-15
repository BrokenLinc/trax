import * as THREE from 'three';

export interface ChaseCameraParams {
  /** Height of the camera above the player. */
  height: number;
  /** Distance behind the player along +Z. */
  back: number;
  /** Tilt of the camera lookAt point in front of the player along -Z. */
  lookAhead: number;
  /** Field of view in degrees. */
  fov: number;
  near: number;
  far: number;
}

export const DEFAULT_CAMERA: ChaseCameraParams = {
  height: 2.4,
  back: 5.5,
  lookAhead: 8,
  fov: 60,
  near: 0.1,
  far: 200,
};

/**
 * The "chase" camera is a misnomer — the player stays at the world origin,
 * so the camera also stays put except for tracking the player's vertical
 * bob over terrain. Using a fixed-offset camera makes the road-moves /
 * player-stays metaphor literal.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3();

  constructor(
    aspect: number,
    private params: ChaseCameraParams = DEFAULT_CAMERA,
  ) {
    this.camera = new THREE.PerspectiveCamera(params.fov, aspect, params.near, params.far);
    this.update(0);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setParams(params: ChaseCameraParams): void {
    this.params = params;
    this.camera.fov = params.fov;
    this.camera.near = params.near;
    this.camera.far = params.far;
    this.camera.updateProjectionMatrix();
  }

  update(playerY: number): void {
    const p = this.params;
    this.camera.position.set(0, playerY + p.height, p.back);
    this.target.set(0, playerY + p.height * 0.4, -p.lookAhead);
    this.camera.lookAt(this.target);
  }
}
