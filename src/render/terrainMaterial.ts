import * as THREE from 'three';

import { loadColorTexture } from './loadTexture.ts';

/** World metres per repeat of the forest-floor tile. */
export const GROUND_TILE_METRES = 13;

/**
 * Atlas sample stays fully in charge inside this distance from the
 * centreline (metres). Past {@link ROAD_BLEND_OUTER} the tiling ground
 * takes over, so distant hills are not a stretched edge texel.
 */
export const ROAD_BLEND_INNER = 6.8;
export const ROAD_BLEND_OUTER = 15;

const GROUND_URL = '/textures/ground-forest.png';

function mustReplace(source: string, token: string, replacement: string): string {
  if (!source.includes(token)) {
    throw new Error(`terrain shader is missing ${token}`);
  }
  return source.replace(token, replacement);
}

function configureGround(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  if (tex.image) tex.needsUpdate = true;
}

export function createGroundTexture(): THREE.Texture {
  return loadColorTexture(GROUND_URL, configureGround);
}

/**
 * Lit terrain: the chunk atlas (road and near shoulder) blended into a
 * world-metre tiling ground map. `groundUv.x` is road-local X in metres
 * and `groundUv.y` is absolute Z. Vertex colors carry the hill tint.
 */
export function createTerrainMaterial(
  roadMap: THREE.Texture,
  groundMap: THREE.Texture,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadMap,
    roughness: 0.92,
    metalness: 0,
    flatShading: false,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  material.customProgramCacheKey = () => 'mode7-terrain-ground-v11';
  material.onBeforeCompile = (shader) => {
    shader.uniforms['groundMap'] = { value: groundMap };
    shader.uniforms['groundTile'] = { value: GROUND_TILE_METRES };
    shader.uniforms['roadBlendInner'] = { value: ROAD_BLEND_INNER };
    shader.uniforms['roadBlendOuter'] = { value: ROAD_BLEND_OUTER };

    shader.vertexShader = mustReplace(
      shader.vertexShader,
      '#include <uv_pars_vertex>',
      `#include <uv_pars_vertex>
attribute vec2 groundUv;
varying vec2 vGroundUv;`,
    );
    shader.vertexShader = mustReplace(
      shader.vertexShader,
      '#include <uv_vertex>',
      `#include <uv_vertex>
vGroundUv = groundUv;`,
    );

    shader.fragmentShader = mustReplace(
      shader.fragmentShader,
      '#include <uv_pars_fragment>',
      `#include <uv_pars_fragment>
uniform sampler2D groundMap;
uniform float groundTile;
uniform float roadBlendInner;
uniform float roadBlendOuter;
varying vec2 vGroundUv;`,
    );
    shader.fragmentShader = mustReplace(
      shader.fragmentShader,
      '#include <map_fragment>',
      `vec4 roadTexel = texture2D(map, vMapUv);
vec2 groundWrapped = fract(vGroundUv / groundTile);
vec4 groundTexel = texture2D(groundMap, groundWrapped);
float roadKeep = 1.0 - smoothstep(roadBlendInner, roadBlendOuter, abs(vGroundUv.x));
vec4 sampledDiffuseColor = mix(groundTexel, roadTexel, roadKeep);
diffuseColor *= sampledDiffuseColor;`,
    );
  };

  return material;
}
