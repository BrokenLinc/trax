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
  scene.add(sun);

  return { scene, ambient, sun };
}
