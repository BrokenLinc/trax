import * as THREE from 'three';
import type { World } from '../world/world.ts';

const AIM_SPHERE_RADIUS = 0.12;

/**
 * A small bundle of debug visuals: world axes at origin, a coloured
 * marker line tracing the road's centre offsets, and the chase-camera
 * look-ahead aim sphere.
 */
export class DebugDraw {
  readonly group = new THREE.Group();
  private readonly centreLine: THREE.Line;
  private readonly centreGeom: THREE.BufferGeometry;
  private readonly centreLen: number;
  private readonly aimSphere: THREE.Mesh;
  private visible = true;

  constructor(rowCount: number) {
    this.centreLen = rowCount;
    const positions = new Float32Array(rowCount * 3);
    this.centreGeom = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.centreGeom.setAttribute('position', attr);
    this.centreLine = new THREE.Line(
      this.centreGeom,
      new THREE.LineBasicMaterial({ color: 0xffd166 }),
    );
    this.centreLine.frustumCulled = false;
    this.group.add(this.centreLine);

    const axes = new THREE.AxesHelper(1.5);
    this.group.add(axes);

    this.aimSphere = new THREE.Mesh(
      new THREE.SphereGeometry(AIM_SPHERE_RADIUS, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0x66ccff,
        roughness: 0.5,
        metalness: 0.1,
      }),
    );
    this.aimSphere.frustumCulled = false;
    this.group.add(this.aimSphere);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.group.visible = on;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update the centre line so it traces the road's centre column at the
   * supplied per-row X offsets. Pass the same offsets the terrain mesh
   * just built; uses Y = 0.05 to float just above the surface.
   */
  updateCentreLine(offsets: ArrayLike<number>, rowSpacing: number, playerRow: number): void {
    const attr = this.centreGeom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const rows = Math.min(this.centreLen, offsets.length);
    const windowRowStart = Math.floor(playerRow) - (this.centreLen - rows);
    for (let i = 0; i < rows; i++) {
      const absRow = windowRowStart + i;
      arr[i * 3] = offsets[i] ?? 0;
      arr[i * 3 + 1] = 0.06;
      arr[i * 3 + 2] = -(absRow - playerRow) * rowSpacing;
    }
    attr.needsUpdate = true;
  }

  /**
   * Place the look-ahead aim sphere at the chase camera's look target.
   * Upright (no terrain tilt); hidden when debug visuals are off.
   */
  updateAimTarget(
    distance: number,
    world: World,
    aheadMeters: number,
    aimElevation: number,
    rowSpacing: number,
  ): void {
    const ahead = Math.max(0, aheadMeters);
    const row = distance + ahead / rowSpacing;
    const y = world.depth.sampleBilinear(row, 0) + aimElevation;
    this.aimSphere.position.set(0, y, -ahead);
    this.aimSphere.quaternion.identity();
  }
}
