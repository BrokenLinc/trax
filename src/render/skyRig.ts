import * as THREE from 'three';

import type { DayNightSample } from './dayNight.ts';
import { loadColorTexture } from './loadTexture.ts';

const SKY_URL = '/sprites/sky.png';
const CLOUD_A_URL = '/sprites/cloud-a.png';
const CLOUD_B_URL = '/sprites/cloud-b.png';
const HORIZON_URL = '/sprites/horizon.png';
const MOON_URL = '/sprites/moon.png';

/** World size of the moon card. Half the old generated disc. */
const MOON_SIZE = 39;

interface CloudSlot {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  altitude: number;
}

/** Share of the road swing. 0 locks a cloud in place, 1 follows the bend. */
export interface SkyCloudParallax {
  near: number;
  far: number;
}

/** Closest and farthest cloud cards. The one between them is a blend of these. */
const CLOUD_NEAR_Z = 230;
const CLOUD_FAR_Z = 380;

const DEFAULT_CLOUD_PARALLAX: SkyCloudParallax = {
  near: 0.45,
  far: 0.65,
};

function configureBackdrop(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (tex.image) tex.needsUpdate = true;
}

/**
 * Daytime backdrop. The cards face world +Z and only copy the camera's Y,
 * so a climb keeps the sky in frame without billboarding.
 * A corner passes in `swing`, the road's sideways offset ahead of the
 * player. Each cloud takes a share of that swing, blended from `near` at
 * the closest card to `far` at the farthest. Fog is off: the terrain fog
 * already fades the hills into this horizon.
 */
export class SkyRig {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly horizon: THREE.Mesh;
  private readonly stars: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly clouds: CloudSlot[];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly cloudParallax: SkyCloudParallax = { ...DEFAULT_CLOUD_PARALLAX };

  constructor() {
    const skyTex = loadColorTexture(SKY_URL, configureBackdrop);
    const cloudA = loadColorTexture(CLOUD_A_URL, configureBackdrop);
    const cloudB = loadColorTexture(CLOUD_B_URL, configureBackdrop);
    const horizonTex = loadColorTexture(HORIZON_URL, configureBackdrop);
    const moonTex = loadColorTexture(MOON_URL, configureBackdrop);
    this.textures.push(skyTex, cloudA, cloudB, horizonTex, moonTex);

    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(skyMat);
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1100), skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    const horizonMat = new THREE.MeshBasicMaterial({
      map: horizonTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(horizonMat);
    this.horizon = new THREE.Mesh(new THREE.PlaneGeometry(2400, 420), horizonMat);
    this.horizon.renderOrder = -80;
    this.horizon.frustumCulled = false;
    this.group.add(this.horizon);

    const starMat = new THREE.MeshBasicMaterial({
      map: createStarTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0,
    });
    this.materials.push(starMat);
    this.textures.push(starMat.map as THREE.Texture);
    this.stars = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1100), starMat);
    this.stars.renderOrder = -90;
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.group.add(this.stars);

    const moonMat = new THREE.MeshBasicMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0,
    });
    this.materials.push(moonMat);
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(MOON_SIZE, MOON_SIZE), moonMat);
    this.moon.renderOrder = -75;
    this.moon.frustumCulled = false;
    this.moon.visible = false;
    // Child of the horizon card, so a bend slides the moon with the mountains.
    this.horizon.add(this.moon);

    const layout: Array<{
      tex: THREE.Texture;
      x: number;
      z: number;
      altitude: number;
      w: number;
      h: number;
    }> = [
      { tex: cloudA, x: -200, z: -280, altitude: 108, w: 220, h: 78 },
      { tex: cloudB, x: 150, z: -230, altitude: 126, w: 240, h: 84 },
      { tex: cloudA, x: -20, z: -380, altitude: 92, w: 260, h: 90 },
    ];

    this.clouds = layout.map((slot) => {
      const mat = new THREE.MeshBasicMaterial({
        map: slot.tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        side: THREE.FrontSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(slot.w, slot.h), mat);
      mesh.renderOrder = -50;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, x: slot.x, z: slot.z, altitude: slot.altitude };
    });
  }

  /** Live object. Mutate it, or pass it back through `setCloudParallax`. */
  getCloudParallax(): SkyCloudParallax {
    return this.cloudParallax;
  }

  setCloudParallax(parallax: SkyCloudParallax): void {
    this.cloudParallax.near = parallax.near;
    this.cloudParallax.far = parallax.far;
  }

  /**
   * `cameraY` is the chase eye height. `swing` is metres of road offset
   * ahead of the player. `day` tints the cards and fades the stars and moon.
   * Rotation stays identity.
   */
  update(cameraY: number, swing: number, day: DayNightSample): void {
    const skyX = swing * 1.3;
    const horizonX = swing * 1.3;
    this.sky.position.set(skyX, cameraY + 70, -820);
    this.sky.quaternion.identity();
    this.sky.rotation.set(0, 0, 0);
    paint(this.sky, day.sky);
    this.horizon.position.set(horizonX, cameraY + 8, -740);
    this.horizon.quaternion.identity();
    this.horizon.rotation.set(0, 0, 0);
    paint(this.horizon, day.horizon);
    this.stars.position.set(skyX, cameraY + 78, -800);
    this.stars.quaternion.identity();
    this.stars.rotation.set(0, 0, 0);
    const starMat = this.stars.material;
    if (starMat instanceof THREE.MeshBasicMaterial) {
      starMat.opacity = day.star;
      this.stars.visible = day.star > 0.02;
    }
    // Local to the horizon card: same swing, sitting up in the sky in front of it.
    this.moon.position.set(day.moonAcross * 460, 28 + day.moonUp * 210, 20);
    this.moon.quaternion.identity();
    this.moon.rotation.set(0, 0, 0);
    const moonMat = this.moon.material;
    if (moonMat instanceof THREE.MeshBasicMaterial) {
      moonMat.opacity = day.moon;
      // Parked. The fill light still stands in for it.
      this.moon.visible = false;
    }
    const span = CLOUD_FAR_Z - CLOUD_NEAR_Z;
    for (const cloud of this.clouds) {
      const depth = THREE.MathUtils.clamp((-cloud.z - CLOUD_NEAR_Z) / span, 0, 1);
      const share = THREE.MathUtils.lerp(this.cloudParallax.near, this.cloudParallax.far, depth);
      cloud.mesh.position.set(cloud.x + swing * share, cameraY + cloud.altitude, cloud.z);
      cloud.mesh.quaternion.identity();
      cloud.mesh.rotation.set(0, 0, 0);
      paint(cloud.mesh, day.cloud);
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.horizon.geometry.dispose();
    this.stars.geometry.dispose();
    this.moon.geometry.dispose();
    for (const cloud of this.clouds) cloud.mesh.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.group.removeFromParent();
  }
}

function paint(mesh: THREE.Mesh, color: { r: number; g: number; b: number }): void {
  const mat = mesh.material;
  if (mat instanceof THREE.MeshBasicMaterial) mat.color.setRGB(color.r, color.g, color.b);
}

/** Pinpoints on a clear night. The card is huge, so each star is one texel plus a faint halo. */
function createStarTexture(): THREE.DataTexture {
  const w = 2048;
  const h = 1024;
  const data = new Uint8Array(w * h * 4);
  let n = 0x12345678;
  const rand = (): number => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
  const plot = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    const prev = data[p + 3] ?? 0;
    if (a < prev) return;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = a;
  };
  for (let i = 0; i < 2400; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const roll = rand();
    const bright = roll > 0.96 ? 255 : roll > 0.7 ? 235 : 190;
    const warm = rand();
    const r = warm > 0.92 ? 255 : warm < 0.07 ? 176 : bright;
    const b = warm < 0.07 ? 255 : bright;
    plot(x, y, r, bright, b, 255);
    if (roll > 0.86) {
      const halo = roll > 0.96 ? 150 : 70;
      plot(x - 1, y, r, bright, b, halo);
      plot(x + 1, y, r, bright, b, halo);
      plot(x, y - 1, r, bright, b, halo);
      plot(x, y + 1, r, bright, b, halo);
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
