import * as THREE from 'three';

import { MODE7_DEFAULTS } from '../mode7Defaults.ts';

/** Shared scene fixtures: lights, fog, ambient. */
export interface SceneRig {
  scene: THREE.Scene;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  /** Dim fill from the opposite arc. Intensity stays 0 until the moon is up. */
  moon: THREE.DirectionalLight;
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

  // High ambient, modest warm sun from the upper right — the same direction
  // painted into the unlit sprites, so the terrain form-shades without
  // fighting the illustration.
  const ambient = new THREE.AmbientLight(0xd7dee6, 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d6, 0.58);
  sun.position.set(28, 42, 18);
  sun.castShadow = false;
  scene.add(sun);

  const moon = new THREE.DirectionalLight(0xb8c8f0, 0);
  moon.position.set(0, 30, -8);
  moon.castShadow = false;
  scene.add(moon);

  return { scene, ambient, sun, moon };
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

  /** The day cycle owns the haze colour. Near and far stay put. */
  setColor(color: number): void {
    this.params.color = color;
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
