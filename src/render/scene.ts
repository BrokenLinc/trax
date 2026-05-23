import * as THREE from 'three';

import { MODE7_DEFAULTS } from '../mode7Defaults.ts';

/** Shared scene fixtures: lights, fog, ambient. */
export interface SceneRig {
  scene: THREE.Scene;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
}

export interface SceneFogParams {
  /** Fog colour as 0xRRGGBB (also applied to `scene.background`). */
  color: number;
  near: number;
  far: number;
}

/** @see MODE7_DEFAULTS.fog in `src/mode7Defaults.ts` */
export const DEFAULT_SCENE_FOG: SceneFogParams = MODE7_DEFAULTS.fog;

export function createScene(): SceneRig {
  const scene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0x6a7aa8, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5d6, 1.1);
  sun.position.set(4, 8, 6);
  // The player is pinned to the world origin (the road moves underneath),
  // so the shadow camera can be statically centred on (0, 0, 0) — no
  // per-frame frustum updates. A 10 m × 10 m × 19 m box around the light's
  // view of the origin comfortably contains the 1 m sphere caster.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0005;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  return { scene, ambient, sun };
}

/**
 * Linear fog + matching background colour. Kept going through the
 * top-down inset temporarily disables `scene.fog` but leaves this wrapper
 * intact for restore.
 */
export class SceneFog {
  private params: SceneFogParams;

  constructor(
    private readonly scene: THREE.Scene,
    params: SceneFogParams = DEFAULT_SCENE_FOG,
  ) {
    this.params = { ...params };
    this.apply();
  }

  getParams(): SceneFogParams {
    return this.params;
  }

  setParams(params: SceneFogParams): void {
    this.params = params;
    this.apply();
  }

  private apply(): void {
    const { color, near, far } = this.params;
    this.scene.background = new THREE.Color(color);
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.color.setHex(color);
      fog.near = near;
      fog.far = far;
    } else {
      this.scene.fog = new THREE.Fog(color, near, far);
    }
  }
}
