import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  FOREST_HEIGHT,
  FOREST_HUE,
  FOREST_KINDS,
  FOREST_MIN_M,
  bakeForestGeometries,
  createForestMaterial,
  forestKeepChance,
  forestPlacements,
  type ForestKind,
} from '../src/render/forestField.ts';

const trees = forestPlacements({
  seed: 'mode7',
  rowStart: 0,
  rowEnd: 64,
  rowSpacing: 4,
  maxX: 280,
});

function ofKind(kind: ForestKind) {
  return trees.filter((tree) => tree.kind === kind);
}

describe('forest field', () => {
  it('covers inside the old tree line and well past it', () => {
    expect(trees.length).toBeGreaterThan(80);
    expect(trees.some((tree) => Math.abs(tree.localX) < 34)).toBe(true);
    expect(trees.some((tree) => Math.abs(tree.localX) > 120)).toBe(true);
    for (const tree of trees) {
      expect(Math.abs(tree.localX)).toBeGreaterThanOrEqual(FOREST_MIN_M);
    }
  });

  it('plants a valley floor at the same rate as a slope', () => {
    expect(forestKeepChance(90)).toBe(forestKeepChance(200));
    const valleyY = -20;
    const geos = bakeForestGeometries(
      trees,
      { at: () => valleyY },
      {
        rowStart: 0,
        bends: [],
        prefix: new Float32Array(80),
        rowSpacing: 4,
      },
    );
    let quads = 0;
    for (const geo of Object.values(geos)) {
      const position = geo?.getAttribute('position');
      if (!position) continue;
      quads += position.count / 4;
      expect(position.getY(0)).toBeLessThan(valleyY);
      for (let i = 0; i < position.count; i += 4) {
        const z = position.getZ(i);
        expect(position.getZ(i + 1)).toBeCloseTo(z, 5);
        expect(position.getZ(i + 2)).toBeCloseTo(z, 5);
      }
    }
    expect(quads).toBe(trees.length);
    for (const geo of Object.values(geos)) geo?.dispose();
  });

  it('gives trees in one stand different hues', () => {
    for (const kind of FOREST_KINDS) {
      const stand = ofKind(kind);
      expect(stand.length).toBeGreaterThan(1);
      const hues = stand.map((tree) => tree.hue);
      const min = Math.min(...hues);
      const max = Math.max(...hues);
      expect(max).toBeGreaterThan(min);
      expect(min).toBeGreaterThanOrEqual(FOREST_HUE[kind].min - 1e-6);
      expect(max).toBeLessThanOrEqual(FOREST_HUE[kind].max + 1e-6);
    }
    const pines = ofKind('pine').map((tree) => tree.hue);
    expect(Math.max(...pines) - Math.min(...pines)).toBeGreaterThan(8);
    expect(Math.min(...pines)).toBeLessThan(-40);
  });

  it('leans each tree within five degrees', () => {
    expect(trees.some((tree) => tree.tilt < -1)).toBe(true);
    expect(trees.some((tree) => tree.tilt > 1)).toBe(true);
    for (const tree of trees) {
      expect(Math.abs(tree.tilt)).toBeLessThanOrEqual(5);
    }
  });

  it('keeps heights in the larger ranges', () => {
    for (const tree of trees) {
      const limits = FOREST_HEIGHT[tree.kind];
      expect(tree.height).toBeGreaterThanOrEqual(limits.min);
      expect(tree.height).toBeLessThanOrEqual(limits.max);
    }
  });

  it('hue-rotates on a Lambert cutout', () => {
    const material = createForestMaterial(new THREE.DataTexture(new Uint8Array(4), 1, 1));
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.alphaTest).toBeCloseTo(0.58);
    expect(material.toneMapped).toBe(false);
    expect(material.customProgramCacheKey()).toBe('mode7-forest-hue-v3');
    expect(typeof material.onBeforeCompile).toBe('function');
    material.map?.dispose();
    material.dispose();
  });
});
