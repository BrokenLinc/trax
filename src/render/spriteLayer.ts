import * as THREE from 'three';

import type { World } from '../world/world.ts';
import {
  sceneryInRange,
  type SceneryHeight,
  type SceneryInstance,
  type SceneryKind,
} from '../world/scenery.ts';
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
const CARD_CAP = 420;

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

function cutoutMaterial(map: THREE.Texture, tint: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
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
  private readonly variants: Record<SceneryKind, THREE.MeshLambertMaterial[]>;
  private readonly authoredTint = new WeakMap<THREE.MeshLambertMaterial, number>();
  private readonly textures: Record<SceneryKind, THREE.Texture>;
  private readonly pool: THREE.Mesh[] = [];
  private live: LiveSprite[] = [];
  private builtSeed = '';
  private builtStart = Number.NaN;
  private builtEnd = Number.NaN;
  private builtToken: readonly SceneryInstance[] | null = null;
  private readonly ownsTextures: boolean;

  constructor(
    parent: THREE.Object3D,
    world: World,
    private readonly anchor: SpriteAnchor,
    textures?: Partial<Record<SceneryKind, THREE.Texture>>,
  ) {
    this.world = world;
    this.ownsTextures = textures === undefined;
    this.group.frustumCulled = false;
    parent.add(this.group);

    const kinds: SceneryKind[] = ['broadleaf', 'pine', 'shrub', 'post', 'rock'];
    const maps = {} as Record<SceneryKind, THREE.Texture>;
    const variants = {} as Record<SceneryKind, THREE.MeshLambertMaterial[]>;
    for (const kind of kinds) {
      const tex = textures?.[kind] ?? loadColorTexture(SPRITE_URL[kind], configureCutout);
      maps[kind] = tex;
      variants[kind] = TINTS.map((tint) => {
        const mat = cutoutMaterial(tex, tint);
        this.authoredTint.set(mat, tint);
        return mat;
      });
    }
    this.textures = maps;
    this.variants = variants;
  }

  private aspectOf(kind: SceneryKind): number {
    return imageAspect(this.textures[kind], FALLBACK_ASPECT[kind]);
  }

  setWorld(world: World): void {
    this.world = world;
    this.builtSeed = '';
  }

  /** Multiply each card's authored tint. The day cycle leaves this at the paint. */
  setAlbedo(r: number, g: number, b: number): void {
    const scale = new THREE.Color(r, g, b);
    for (const list of Object.values(this.variants)) {
      for (const mat of list) {
        const tint = this.authoredTint.get(mat);
        if (tint === undefined) continue;
        mat.color.setHex(tint).multiply(scale);
      }
    }
  }

  /**
   * `provided` is the card list for this window. The same array reference
   * means the window has not changed. Omit it and the layer queries the
   * ecology itself.
   */
  update(playerRow: number, provided?: readonly SceneryInstance[]): void {
    const params = this.anchor.getParams();
    const start = Math.floor(playerRow) - Math.min(params.rowsBehind, SCENERY_ROWS_BEHIND);
    const end = Math.floor(playerRow) + Math.min(params.rowsAhead, SCENERY_ROWS_AHEAD);
    const seed = this.world.getSeed();
    const token = provided ?? null;
    if (
      seed !== this.builtSeed ||
      start !== this.builtStart ||
      end !== this.builtEnd ||
      token !== this.builtToken
    ) {
      const height = depthHeight(this.world, params.roadColSpacing, params.landscapeColSpacing);
      const queried = provided ?? sceneryInRange(seed, start, end, height);
      const instances = capInstances(queried, playerRow);
      this.rebuild(instances);
      this.builtSeed = seed;
      this.builtStart = start;
      this.builtEnd = end;
      this.builtToken = token;
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
    if (this.ownsTextures) {
      for (const tex of Object.values(this.textures)) tex.dispose();
    }
    this.group.removeFromParent();
  }

  private rebuild(instances: readonly SceneryInstance[]): void {
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
  }

  private place(rowSpacing: number, roadColSpacing: number, landscapeColSpacing: number): void {
    for (const { mesh, inst } of this.live) {
      const centreX = this.anchor.worldXAtRow(inst.row);
      if (centreX === null) {
        mesh.visible = false;
        continue;
      }
      const posed = sceneryPlacement(
        inst,
        centreX,
        this.world,
        rowSpacing,
        roadColSpacing,
        landscapeColSpacing,
        this.aspectOf(inst.kind),
      );
      mesh.visible = true;
      mesh.position.set(posed.x, posed.y, posed.z);
      mesh.scale.set(posed.flip ? -posed.width : posed.width, posed.height, 1);
      mesh.rotation.set(0, 0, 0);
      mesh.quaternion.identity();
    }
  }
}

function depthHeight(
  world: World,
  roadColSpacing: number,
  landscapeColSpacing: number,
): SceneryHeight {
  return {
    at(row, localX) {
      const col = signedColFromWorldX(localX, roadColSpacing, landscapeColSpacing);
      const c0 = Math.floor(col);
      const along = col - c0;
      const y0 = world.depth.sample(row, c0);
      const y1 = world.depth.sample(row, c0 + 1);
      return y0 + (y1 - y0) * along;
    },
  };
}

function capInstances(instances: readonly SceneryInstance[], playerRow: number): SceneryInstance[] {
  if (instances.length <= CARD_CAP) return instances.slice();
  return instances
    .map((inst, index) => ({
      inst,
      index,
      dist: Math.abs(inst.row - playerRow) + Math.abs(inst.localX) * 0.015,
    }))
    .sort((a, b) => a.dist - b.dist || a.index - b.index)
    .slice(0, CARD_CAP)
    .map((entry) => entry.inst);
}

export interface SceneryPlacement {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  flip: boolean;
}

/**
 * Card pose in the world-root frame. Height is the lattice lerp, so a
 * tree on a falling shoulder sits on the slope instead of the road.
 */
export function sceneryPlacement(
  inst: SceneryInstance,
  centreX: number,
  world: World,
  rowSpacing: number,
  roadColSpacing: number,
  landscapeColSpacing: number,
  aspect: number,
): SceneryPlacement {
  const col = signedColFromWorldX(inst.localX, roadColSpacing, landscapeColSpacing);
  const c0 = Math.floor(col);
  const along = col - c0;
  const y0 = world.depth.sample(inst.row, c0);
  const y1 = world.depth.sample(inst.row, c0 + 1);
  const groundY = y0 + (y1 - y0) * along;
  const height = inst.height;
  const width = height * aspect;
  return {
    x: centreX + inst.localX,
    y: groundY + height * 0.5 - SINK[inst.kind],
    z: -inst.row * rowSpacing,
    width,
    height,
    flip: inst.flip,
  };
}
