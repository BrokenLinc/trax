import * as THREE from 'three';

import { MODE7_DEFAULTS } from '../mode7Defaults.ts';

export interface ChaseCameraParams {
  /** Height of the camera above the player. */
  height: number;
  /** Distance behind the player along +Z. */
  back: number;
  /** Field of view in degrees. */
  fov: number;
  near: number;
  far: number;
}

/** @see MODE7_DEFAULTS.camera in `src/mode7Defaults.ts` */
export const DEFAULT_CAMERA: ChaseCameraParams = MODE7_DEFAULTS.camera;

/**
 * Vertical offset from the ground sample to the player sphere's centre.
 * Mirrors `DEFAULT_PLAYER_MESH.radius` in `playerMesh.ts`; the chase camera
 * uses it to raise its look-at target onto the sphere rather than the road.
 */
const SPHERE_CENTRE_OFFSET = 0.5;

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _lookM = new THREE.Matrix4();

/**
 * The "chase" camera is a misnomer — the player stays at the world origin,
 * so the camera also stays put except for tracking the player's vertical
 * bob over terrain. Using a fixed-offset camera makes the road-moves /
 * player-stays metaphor literal.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private params: ChaseCameraParams;

  constructor(aspect: number, initial?: ChaseCameraParams) {
    this.params = { ...MODE7_DEFAULTS.camera, ...initial };
    this.camera = new THREE.PerspectiveCamera(
      this.params.fov,
      aspect,
      this.params.near,
      this.params.far,
    );
    this.update(0);
  }

  getParams(): ChaseCameraParams {
    return this.params;
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

  /**
   * Chase rig: eye behind the player on +Z, aim through the sphere centre at
   * world origin. The player stays at X = Z = 0; using a far-ahead look target
   * alone would miss that line and shift the avatar away from screen centre.
   */
  update(playerY: number): void {
    const p = this.params;
    const py = Number.isFinite(playerY) ? playerY : 0;
    const sphereCentreY = py + SPHERE_CENTRE_OFFSET;
    // Eye and aim stay on world X = 0 so there is no lateral yaw.
    _eye.set(0, py + p.height, p.back);
    _aim.set(0, sphereCentreY, 0);
    // Build orientation from Matrix4.lookAt — avoids Object3D.lookAt’s internal
    // world-matrix path (can interact badly with a camera that is not scene‑parented).
    _lookM.lookAt(_eye, _aim, _up);
    this.camera.quaternion.setFromRotationMatrix(_lookM);
    this.camera.position.copy(_eye);
    this.camera.up.copy(_up);
  }
}

/** Quaternion from `Matrix4.lookAt`, used by {@link ChaseCamera}. */
const _qFromLookMatrix = new THREE.Quaternion();
/** Perspective camera used only to compare `Matrix4.lookAt` vs `Object3D.lookAt`. */
const _comparePerspective = new THREE.PerspectiveCamera();

/**
 * Angular disagreement (degrees) between the chase-camera orientation built
 * with `Matrix4.lookAt + setFromRotationMatrix` versus `PerspectiveCamera.lookAt`,
 * given the same eye/aim/up. Useful for diagnosing look-path regressions.
 */
export function diagnosticChaseVersusThreeLookAtDeg(
  playerY: number,
  params: ChaseCameraParams,
): number {
  const py = Number.isFinite(playerY) ? playerY : 0;
  const sphereCentreY = py + SPHERE_CENTRE_OFFSET;
  _eye.set(0, py + params.height, params.back);
  _aim.set(0, sphereCentreY, 0);
  _lookM.lookAt(_eye, _aim, _up);
  _qFromLookMatrix.setFromRotationMatrix(_lookM);

  _comparePerspective.position.copy(_eye);
  _comparePerspective.up.copy(_up);
  _comparePerspective.lookAt(_aim);
  return THREE.MathUtils.radToDeg(_qFromLookMatrix.angleTo(_comparePerspective.quaternion));
}
