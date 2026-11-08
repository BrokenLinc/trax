import * as THREE from 'three';

import type { World } from '../world/world.ts';
import {
  HUE_STOPS,
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
  cedar: '/sprites/tree-cedar.png',
  maple: '/sprites/tree-maple.png',
  birch: '/sprites/tree-birch.png',
  shrub: '/sprites/shrub.png',
  bloom: '/sprites/shrub-flower.png',
  flowers: '/sprites/flowers.png',
  post: '/sprites/post.png',
  rock: '/sprites/rock.png',
};

/** Fallback aspect (width / height) used until the image has loaded. */
const FALLBACK_ASPECT: Record<SceneryKind, number> = {
  broadleaf: 0.85,
  pine: 0.62,
  cedar: 0.44,
  maple: 0.63,
  birch: 0.38,
  shrub: 1.15,
  bloom: 1.2,
  flowers: 1.54,
  post: 0.28,
  rock: 1.15,
};

/** Past the fog the cards are a full-fog fill cost, so the window stops here. */
const SCENERY_ROWS_AHEAD = 120;
const SCENERY_ROWS_BEHIND = 18;
const CARD_CAP = 700;

const SINK: Record<SceneryKind, number> = {
  broadleaf: 1.1,
  pine: 0.85,
  cedar: 0.9,
  maple: 1.05,
  birch: 0.7,
  shrub: 0.15,
  bloom: 0.12,
  flowers: 0.06,
  post: 0.04,
  rock: 0.08,
};

/** Degrees of hue rotation per stop. Lengths match `HUE_STOPS`. */
const HUE_DEGREES: Record<SceneryKind, readonly number[]> = {
  broadleaf: [-10, 0, 12],
  pine: [-12, 0, 14],
  cedar: [-8, 0, 16],
  maple: [0, -28, -62, -105],
  birch: [-6, 0, 8],
  shrub: [-18, 0, 16],
  bloom: [-8, 0, 8],
  flowers: [-6, 0, 6],
  post: [0],
  rock: [0],
};

const KINDS = Object.keys(SPRITE_URL) as SceneryKind[];

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

let placeholder: THREE.DataTexture | undefined;

function fallbackWhite(): THREE.Texture {
  if (placeholder) return placeholder;
  placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  placeholder.needsUpdate = true;
  configureCutout(placeholder);
  return placeholder;
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

function isDrawable(image: unknown): image is CanvasImageSource {
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return true;
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return true;
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) return true;
  return false;
}

/** One rotated copy. Returns the source when the image is not drawable yet. */
function bakeHue(source: THREE.Texture, degrees: number): THREE.Texture {
  const image = source.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height || !isDrawable(source.image)) return source;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.imageSmoothingEnabled = false;
  ctx.filter = `hue-rotate(${degrees}deg)`;
  ctx.drawImage(source.image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  configureCutout(tex);
  return tex;
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
  private readonly hueTextures: THREE.Texture[] = [];
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

    const maps = {} as Record<SceneryKind, THREE.Texture>;
    const variants = {} as Record<SceneryKind, THREE.MeshLambertMaterial[]>;
    for (const kind of KINDS) {
      const degrees = HUE_DEGREES[kind];
      if (degrees.length !== HUE_STOPS[kind]) {
        throw new Error(`hue stops for ${kind} do not match`);
      }
      const mats = degrees.map(() => {
        const mat = cutoutMaterial(fallbackWhite(), 0xffffff);
        this.authoredTint.set(mat, 0xffffff);
        return mat;
      });
      const apply = (loaded: THREE.Texture): void => {
        configureCutout(loaded);
        degrees.forEach((deg, i) => {
          const mat = mats[i];
          if (!mat) return;
          const map = this.hueMap(loaded, deg);
          mat.map = map;
          mat.needsUpdate = true;
        });
      };
      const provided = textures?.[kind];
      const tex = provided ?? loadColorTexture(SPRITE_URL[kind], apply);
      if (provided) apply(provided);
      maps[kind] = tex;
      variants[kind] = mats;
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
    for (const tex of this.hueTextures) tex.dispose();
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
      const stops = this.variants[inst.kind];
      const hue = ((inst.hue % stops.length) + stops.length) % stops.length;
      const tinted = stops[hue] ?? stops[0];
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

  /** A hue-rotated copy of a loaded card. Degree 0 keeps the source map. */
  private hueMap(source: THREE.Texture, degrees: number): THREE.Texture {
    if (degrees === 0) return source;
    const baked = bakeHue(source, degrees);
    if (baked !== source) this.hueTextures.push(baked);
    return baked;
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
