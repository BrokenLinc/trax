import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world.ts';
import {
  computeChaseRig,
  SPHERE_CENTRE_OFFSET,
  type ChaseCameraParams,
} from '../src/render/camera.ts';

const PARAMS: ChaseCameraParams = {
  aheadMeters: 24,
  aimElevation: 1.0,
  height: 2.6,
  back: 6.5,
  fov: 60,
  near: 0.1,
  far: 200,
};

const ROW_SPACING = 4;

describe('computeChaseRig', () => {
  it('places aim at −aheadMeters on Z with terrain elevation', () => {
    const world = new World('chaseSpec');
    const distance = 10;
    const { aim } = computeChaseRig(0, distance, world, PARAMS, ROW_SPACING);
    const expectedGround = world.depth.sampleBilinear(
      distance + PARAMS.aheadMeters / ROW_SPACING,
      0,
    );
    expect(aim.x).toBe(0);
    expect(aim.z).toBe(-PARAMS.aheadMeters);
    expect(aim.y).toBeCloseTo(expectedGround + PARAMS.aimElevation, 5);
  });

  it('places eye on the player→aim line, back metres behind the player when height is 0', () => {
    const world = new World('chaseSpec');
    const py = world.depth.sampleBilinear(5, 0);
    const params = { ...PARAMS, height: 0 };
    const { eye, aim } = computeChaseRig(py, 5, world, params, ROW_SPACING);
    const playerCentre = { x: 0, y: py + SPHERE_CENTRE_OFFSET, z: 0 };
    const toEye = {
      x: eye.x - playerCentre.x,
      y: eye.y - playerCentre.y,
      z: eye.z - playerCentre.z,
    };
    const toAim = {
      x: aim.x - playerCentre.x,
      y: aim.y - playerCentre.y,
      z: aim.z - playerCentre.z,
    };
    const cross = toEye.y * toAim.z - toEye.z * toAim.y;
    const cross2 = toEye.z * toAim.x - toEye.x * toAim.z;
    const cross3 = toEye.x * toAim.y - toEye.y * toAim.x;
    const crossLen = Math.hypot(cross, cross2, cross3);
    expect(crossLen).toBeLessThan(1e-4);
    const distAlong = Math.hypot(toEye.x, toEye.y, toEye.z);
    expect(distAlong).toBeCloseTo(params.back, 4);
  });

  it('adds world-Y height offset after placing on the line', () => {
    const world = new World('chaseSpec');
    const base = computeChaseRig(0, 0, world, { ...PARAMS, height: 0 }, ROW_SPACING);
    const raised = computeChaseRig(0, 0, world, PARAMS, ROW_SPACING);
    expect(raised.eye.y - base.eye.y).toBeCloseTo(PARAMS.height, 5);
    expect(raised.eye.x).toBeCloseTo(base.eye.x, 5);
    expect(raised.eye.z).toBeCloseTo(base.eye.z, 5);
  });

  it('collapses aim onto the player row when aheadMeters is 0', () => {
    const world = new World('chaseSpec');
    const { eye, aim } = computeChaseRig(0, 0, world, { ...PARAMS, aheadMeters: 0 }, ROW_SPACING);
    expect(aim.z).toBeCloseTo(0, 10);
    expect(eye.x).toBeCloseTo(0, 10);
    expect(eye.z).toBeCloseTo(0, 10);
  });
});
