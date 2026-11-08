import * as THREE from 'three';

import { loadColorTexture } from './loadTexture.ts';

const SKY_URL = '/sprites/sky.png';
const CLOUD_A_URL = '/sprites/cloud-a.png';
const CLOUD_B_URL = '/sprites/cloud-b.png';
const HORIZON_URL = '/sprites/horizon.png';

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
  private readonly clouds: CloudSlot[];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly cloudParallax: SkyCloudParallax = { ...DEFAULT_CLOUD_PARALLAX };

  constructor() {
    const skyTex = loadColorTexture(SKY_URL, configureBackdrop);
    const cloudA = loadColorTexture(CLOUD_A_URL, configureBackdrop);
    const cloudB = loadColorTexture(CLOUD_B_URL, configureBackdrop);
    const horizonTex = loadColorTexture(HORIZON_URL, configureBackdrop);
    this.textures.push(skyTex, cloudA, cloudB, horizonTex);

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
   * ahead of the player. Rotation stays identity.
   */
  update(cameraY: number, swing: number): void {
    const skyX = swing * 1.3;
    const horizonX = swing * 1.3;
    this.sky.position.set(skyX, cameraY + 70, -820);
    this.sky.quaternion.identity();
    this.sky.rotation.set(0, 0, 0);
    this.horizon.position.set(horizonX, cameraY + 8, -740);
    this.horizon.quaternion.identity();
    this.horizon.rotation.set(0, 0, 0);
    const span = CLOUD_FAR_Z - CLOUD_NEAR_Z;
    for (const cloud of this.clouds) {
      const depth = THREE.MathUtils.clamp((-cloud.z - CLOUD_NEAR_Z) / span, 0, 1);
      const share = THREE.MathUtils.lerp(this.cloudParallax.near, this.cloudParallax.far, depth);
      cloud.mesh.position.set(cloud.x + swing * share, cameraY + cloud.altitude, cloud.z);
      cloud.mesh.quaternion.identity();
      cloud.mesh.rotation.set(0, 0, 0);
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.horizon.geometry.dispose();
    for (const cloud of this.clouds) cloud.mesh.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.group.removeFromParent();
  }
}
