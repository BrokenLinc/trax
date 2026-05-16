import * as THREE from 'three';

/** Shared scene fixtures: lights, fog, ambient. */
export interface SceneRig {
  scene: THREE.Scene;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d18);
  scene.fog = new THREE.Fog(0x0a0d18, 18, 70);

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
