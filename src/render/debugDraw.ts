import * as THREE from 'three';

/**
 * A small bundle of debug visuals: world axes at origin and a coloured
 * marker line tracing the road's centre offsets so curves are obvious
 * even on a flat-shaded mesh.
 */
export class DebugDraw {
  readonly group = new THREE.Group();
  private readonly centreLine: THREE.Line;
  private readonly centreGeom: THREE.BufferGeometry;
  private readonly centreLen: number;
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
}
