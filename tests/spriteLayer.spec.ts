import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { SpriteAnchor } from '../src/render/spriteLayer.ts';
import { SpriteLayer } from '../src/render/spriteLayer.ts';
import { World } from '../src/world/world.ts';
import type { SceneryKind } from '../src/world/scenery.ts';

function fakeTexture(width: number, height: number): THREE.Texture {
  const tex = new THREE.Texture();
  tex.image = { width, height };
  return tex;
}

describe('SpriteLayer', () => {
  it('keeps every card facing world +Z', () => {
    const parent = new THREE.Group();
    const world = new World('mode7');
    const anchor: SpriteAnchor = {
      worldXAtRow: () => 3,
      getParams: () => ({
        rowSpacing: 4,
        roadColSpacing: 6,
        landscapeColSpacing: 50,
        rowsAhead: 24,
        rowsBehind: 4,
      }),
    };
    const kinds: SceneryKind[] = ['shrub', 'bloom', 'flowers', 'post', 'rock'];
    const textures = Object.fromEntries(
      kinds.map((kind) => [kind, fakeTexture(80, 160)]),
    ) as Record<SceneryKind, THREE.Texture>;
    const layer = new SpriteLayer(parent, world, anchor, textures);
    layer.update(12);

    const visible = layer.group.children.filter((child) => child.visible);
    expect(visible.length).toBeGreaterThan(0);
    for (const child of visible) {
      expect(child.rotation.x).toBeCloseTo(0, 5);
      expect(child.rotation.y).toBeCloseTo(0, 5);
      expect(child.quaternion.x).toBeCloseTo(0, 5);
      expect(child.quaternion.y).toBeCloseTo(0, 5);
      expect(child.position.z % 4).toBeCloseTo(0, 5);
    }
    layer.dispose();
  });
});
