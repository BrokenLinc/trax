import * as THREE from 'three';

import { MODE7_DEFAULTS } from '../mode7Defaults.ts';
import { World } from '../world/world.ts';

export interface ChaseCameraParams {
  /** World metres ahead along −Z for the look-at target. */
  aheadMeters: number;
  /** Metres above the ground depth sample at the aim row. */
  aimElevation: number;
  /** World-Y offset added after placing the eye on the player→aim line. */
  height: number;
  /** Metres behind the player along the player→aim line. */
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
 * Mirrors `DEFAULT_PLAYER_MESH.radius` in `playerMesh.ts`.
 */
export const SPHERE_CENTRE_OFFSET = 0.5;

export interface ChaseRigUpdate {
  playerGroundY: number;
  distance: number;
  world: World;
  rowSpacing: number;
}

export interface ChaseRig {
  eye: THREE.Vector3;
  aim: THREE.Vector3;
}

const _playerCentre = new THREE.Vector3();
const _aimCentre = new THREE.Vector3();
const _lineDir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _lookM = new THREE.Matrix4();

/**
 * Pure chase rig: eye behind the player on the line through the aim target,
 * with a world-Y height offset. Player and aim stay on X = 0.
 */
export function computeChaseRig(
  playerGroundY: number,
  distance: number,
  world: World,
  params: ChaseCameraParams,
  rowSpacing: number,
  out: ChaseRig = { eye: new THREE.Vector3(), aim: new THREE.Vector3() },
): ChaseRig {
  const py = Number.isFinite(playerGroundY) ? playerGroundY : 0;
  const ahead = Math.max(0, params.aheadMeters);
  const aimRow = distance + ahead / rowSpacing;
  const aimGroundY = world.depth.sampleBilinear(aimRow, 0);

  _playerCentre.set(0, py + SPHERE_CENTRE_OFFSET, 0);
  _aimCentre.set(0, aimGroundY + params.aimElevation, -ahead);
  out.aim.copy(_aimCentre);

  _lineDir.subVectors(_playerCentre, _aimCentre);
  if (_lineDir.lengthSq() < 1e-12) {
    _lineDir.set(0, 0, 1);
  } else {
    _lineDir.normalize();
  }
  out.eye
    .copy(_playerCentre)
    .addScaledVector(_lineDir, params.back)
    .addScaledVector(_up, params.height);
  return out;
}

/**
 * Chase camera: looks at a terrain-following aim point ahead of the player;
 * the eye sits behind the player on the line through both sphere centres.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private params: ChaseCameraParams;
  private readonly rig: ChaseRig = { eye: new THREE.Vector3(), aim: new THREE.Vector3() };

  constructor(aspect: number, initial?: ChaseCameraParams) {
    this.params = { ...MODE7_DEFAULTS.camera, ...initial };
    this.camera = new THREE.PerspectiveCamera(
      this.params.fov,
      aspect,
      this.params.near,
      this.params.far,
    );
    this.update({
      playerGroundY: 0,
      distance: 0,
      world: new World('camera-init'),
      rowSpacing: 4,
    });
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

  update(ctx: ChaseRigUpdate): void {
    const p = this.params;
    computeChaseRig(ctx.playerGroundY, ctx.distance, ctx.world, p, ctx.rowSpacing, this.rig);
    _eye.copy(this.rig.eye);
    _aim.copy(this.rig.aim);
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
 * with `Matrix4.lookAt + setFromRotationMatrix` versus `PerspectiveCamera.lookAt`.
 */
export function diagnosticChaseVersusThreeLookAtDeg(
  ctx: ChaseRigUpdate,
  params: ChaseCameraParams,
): number {
  const rig = computeChaseRig(ctx.playerGroundY, ctx.distance, ctx.world, params, ctx.rowSpacing);
  _eye.copy(rig.eye);
  _aim.copy(rig.aim);
  _lookM.lookAt(_eye, _aim, _up);
  _qFromLookMatrix.setFromRotationMatrix(_lookM);

  _comparePerspective.position.copy(_eye);
  _comparePerspective.up.copy(_up);
  _comparePerspective.lookAt(_aim);
  return THREE.MathUtils.radToDeg(_qFromLookMatrix.angleTo(_comparePerspective.quaternion));
}
