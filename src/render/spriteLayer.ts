import * as THREE from 'three';

import type { World } from '../world/world.ts';
import { sceneryInRange, type SceneryInstance, type SceneryKind } from '../world/scenery.ts';
import { signedColFromWorldX } from './meshLattice.ts';
import { loadColorTexture } from './loadTexture.ts';

const SPRITE_URL: Record<SceneryKind, string> = {
  broadleaf: '/sprites/tree-broadleaf.png',
  pine: '/sprites/tree-pine.png',
  shrub: '/sprites/shrub.png',
  post: '/sprites/post.png',
  rock: '/sprites/rock.png',
};

/** Fallback aspect (width / height) used until the image has loaded. */
const FALLBACK_ASPECT: Record<SceneryKind, number> = {
  broadleaf: 0.85,
  pine: 0.62,
  shrub: 1.15,
  post: 0.28,
  rock: 1.15,
};

/** Past the fog the cards are a full-fog fill cost, so the window stops here. */
const SCENERY_ROWS_AHEAD = 120;
const SCENERY_ROWS_BEHIND = 18;

const SINK: Record<SceneryKind, number> = {
  broadleaf: 1.1,
  pine: 0.85,
  shrub: 0.15,
  post: 0.04,
  rock: 0.08,
};

export interface SpriteAnchor {
  worldXAtRow(row: number): number | null;
  getParams(): {
    rowSpacing: number;
    roadColSpacing: number;
    landscapeColSpacing: number;
    rowsAhead: number;
    rowsBehind: number;
  };
}

interface LiveSprite {
  mesh: THREE.Mesh;
  inst: SceneryInstance;
}

function configureCutout(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (tex.image) tex.needsUpdate = true;
}

/** Near-white shifts so a repeated cutout does not read as one stamp. */
const TINTS = [0xffffff, 0xf4efe6, 0xd7e4d8, 0xe8d8c4] as const;

function tintIndex(row: number, localX: number): number {
  const n = row * 17 + Math.round(localX * 3);
  return ((n % TINTS.length) + TINTS.length) % TINTS.length;
}

function cutoutMaterial(map: THREE.Texture, tint: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    alphaTest: 0.58,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: true,
    color: tint,
  });
}

function imageAspect(tex: THREE.Texture, fallback: number): number {
  const image = tex.image as { width?: number; height?: number } | undefined;
  const w = image?.width;
  const h = image?.height;
  if (!w || !h) return fallback;
  return w / h;
}

/**
 * Z-facing scenery cards parented to the world root, so they scroll and
 * shear with the road and never turn toward the camera.
 */
export class SpriteLayer {
  readonly group = new THREE.Group();
  private world: World;
  private readonly variants: Record<SceneryKind, THREE.MeshBasicMaterial[]>;
  private readonly textures: Record<SceneryKind, THREE.Texture>;
  private readonly pool: THREE.Mesh[] = [];
  private live: LiveSprite[] = [];
  private builtSeed = '';
  private builtStart = Number.NaN;
  private builtEnd = Number.NaN;

  constructor(
    parent: THREE.Object3D,
    world: World,
    private readonly anchor: SpriteAnchor,
    textures?: Partial<Record<SceneryKind, THREE.Texture>>,
  ) {
    this.world = world;
    this.group.frustumCulled = false;
    parent.add(this.group);

    const kinds: SceneryKind[] = ['broadleaf', 'pine', 'shrub', 'post', 'rock'];
    const maps = {} as Record<SceneryKind, THREE.Texture>;
    const variants = {} as Record<SceneryKind, THREE.MeshBasicMaterial[]>;
    for (const kind of kinds) {
      const tex = textures?.[kind] ?? loadColorTexture(SPRITE_URL[kind], configureCutout);
      maps[kind] = tex;
      variants[kind] = TINTS.map((tint) => cutoutMaterial(tex, tint));
    }
    this.textures = maps;
    this.variants = variants;
  }

  setWorld(world: World): void {
    this.world = world;
    this.builtSeed = '';
  }

  update(playerRow: number): void {
    const params = this.anchor.getParams();
    const start = Math.floor(playerRow) - Math.min(params.rowsBehind, SCENERY_ROWS_BEHIND);
    const end = Math.floor(playerRow) + Math.min(params.rowsAhead, SCENERY_ROWS_AHEAD);
    const seed = this.world.getSeed();
    if (seed !== this.builtSeed || start !== this.builtStart || end !== this.builtEnd) {
      this.rebuild(seed, start, end);
    }
    this.place(params.rowSpacing, params.roadColSpacing, params.landscapeColSpacing);
  }

  dispose(): void {
    for (const mesh of this.pool) {
      mesh.geometry.dispose();
    }
    this.pool.length = 0;
    this.live = [];
    for (const list of Object.values(this.variants)) {
      for (const mat of list) mat.dispose();
    }
    for (const tex of Object.values(this.textures)) tex.dispose();
    this.group.removeFromParent();
  }

  private rebuild(seed: string, start: number, end: number): void {
    const instances = sceneryInRange(seed, start, end);
    while (this.pool.length < instances.length) {
      const fallback = this.variants.broadleaf[0];
      if (!fallback) throw new Error('sprite materials missing');
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fallback);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = true;
      this.group.add(mesh);
      this.pool.push(mesh);
    }
    this.live = instances.map((inst, i) => {
      const mesh = this.pool[i];
      if (!mesh) throw new Error('sprite pool underflow');
      const tinted =
        this.variants[inst.kind][tintIndex(inst.row, inst.localX)] ?? this.variants[inst.kind][0];
      if (!tinted) throw new Error('sprite materials missing');
      mesh.material = tinted;
      mesh.visible = true;
      return { mesh, inst };
    });
    for (let i = instances.length; i < this.pool.length; i++) {
      const mesh = this.pool[i];
      if (mesh) mesh.visible = false;
    }
    this.builtSeed = seed;
    this.builtStart = start;
    this.builtEnd = end;
  }

  private place(rowSpacing: number, roadColSpacing: number, landscapeColSpacing: number): void {
    for (const { mesh, inst } of this.live) {
      const centreX = this.anchor.worldXAtRow(inst.row);
      if (centreX === null) {
        mesh.visible = false;
        continue;
      }
      const col = signedColFromWorldX(inst.localX, roadColSpacing, landscapeColSpacing);
      const c0 = Math.floor(col);
      const along = col - c0;
      // The mesh only stores height on integer columns and interpolates.
      // Sampling the fractional column directly sits on the road datum, so
      // a tree on a falling shoulder floats.
      const y0 = this.world.depth.sample(inst.row, c0);
      const y1 = this.world.depth.sample(inst.row, c0 + 1);
      const groundY = y0 + (y1 - y0) * along;
      const aspect = imageAspect(this.textures[inst.kind], FALLBACK_ASPECT[inst.kind]);
      const height = inst.height;
      const width = height * aspect;
      mesh.visible = true;
      mesh.position.set(
        centreX + inst.localX,
        groundY + height * 0.5 - SINK[inst.kind],
        -inst.row * rowSpacing,
      );
      mesh.scale.set(inst.flip ? -width : width, height, 1);
      mesh.rotation.set(0, 0, 0);
      mesh.quaternion.identity();
    }
  }
}
