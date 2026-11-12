import * as THREE from 'three';

import type { World } from '../world/world.ts';
import { signedColFromWorldX } from './meshLattice.ts';
import { loadColorTexture } from './loadTexture.ts';

const RIDER_URL = '/sprites/rider.png';
const RIDER_HEIGHT = 1.82;
const RIDER_ASPECT = 0.72;
/** Fender height of the tail-light lens, metres above the tire contact. */
const TAIL_LENS_Y = 0.8;
/** World size of the glow card. The hot core is the middle of the texture. */
const TAIL_LENS_W = 0.52;
const TAIL_LENS_H = 0.26;

export interface PlayerMeshParams {
  /** Sprite height in metres. The card stands on the ground sample. */
  height: number;
}

export const DEFAULT_PLAYER_MESH: PlayerMeshParams = {
  height: RIDER_HEIGHT,
};

function configureRider(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (tex.image) tex.needsUpdate = true;
}

function contactBlobTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('player contact blob: no 2d context');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 58);
  gradient.addColorStop(0, 'rgba(36, 30, 24, 0.38)');
  gradient.addColorStop(0.4, 'rgba(36, 30, 24, 0.1)');
  gradient.addColorStop(1, 'rgba(36, 30, 24, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** White-hot core falling off to a soft red halo. Additive, so the edges fade. */
function tailLightTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('tail light: no 2d context');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(1.45, 0.7);
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 86);
  glow.addColorStop(0, 'rgba(255, 248, 230, 1)');
  glow.addColorStop(0.07, 'rgba(255, 86, 32, 1)');
  glow.addColorStop(0.2, 'rgba(255, 18, 8, 0.9)');
  glow.addColorStop(0.46, 'rgba(170, 0, 0, 0.28)');
  glow.addColorStop(1, 'rgba(120, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-200, -200, 400, 400);
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function imageAspect(tex: THREE.Texture, fallback: number): number {
  const image = tex.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height) return fallback;
  return image.width / image.height;
}

/**
 * Rear-view rider card. It stays at the world origin (the road moves) and
 * faces +Z. Roll is around Z only, so the plane normal never yaws toward
 * the camera. A flat contact blob stands in for a cast shadow, which on a
 * paper-thin card reads as a sheet of cardboard.
 */
export class PlayerMesh {
  readonly mesh: THREE.Group;
  private readonly card: THREE.Mesh;
  private readonly blob: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly texture: THREE.Texture;
  private readonly tailMap: THREE.Texture;
  private readonly cardMaterial: THREE.MeshLambertMaterial;
  private readonly blobMaterial: THREE.MeshBasicMaterial;
  private readonly tailMaterial: THREE.MeshBasicMaterial;
  private readonly params: PlayerMeshParams;

  constructor(params: PlayerMeshParams = DEFAULT_PLAYER_MESH) {
    this.params = params;
    this.texture = loadColorTexture(RIDER_URL, configureRider);
    this.cardMaterial = new THREE.MeshLambertMaterial({
      map: this.texture,
      alphaTest: 0.35,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.cardMaterial);
    this.card.castShadow = false;
    this.card.position.y = params.height / 2;
    this.card.frustumCulled = false;

    this.blobMaterial = new THREE.MeshBasicMaterial({
      map: contactBlobTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.7), this.blobMaterial);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.set(0, 0.05, 0.15);
    this.blob.renderOrder = 2;
    this.blob.frustumCulled = false;

    this.tailMap = tailLightTexture();
    this.tailMaterial = new THREE.MeshBasicMaterial({
      map: this.tailMap,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.tail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.tailMaterial);
    this.tail.visible = false;
    this.tail.renderOrder = 3;
    this.tail.frustumCulled = false;
    this.card.add(this.tail);

    this.mesh = new THREE.Group();
    this.mesh.add(this.card);
    this.mesh.add(this.blob);
    this.mesh.frustumCulled = false;
  }

  /** Lens only. The red cone lives on the scene light and follows the same switch. */
  setTailLight(on: boolean): void {
    this.tail.visible = on;
  }

  update(
    distance: number,
    world: World,
    lateralX: number,
    roadColSpacing: number,
    landscapeColSpacing: number,
    speed = 0,
    lateralSpeed = 0,
    altitude?: number,
    airborne = false,
  ): void {
    const col = signedColFromWorldX(lateralX, roadColSpacing, landscapeColSpacing);
    const groundY = world.depth.sampleBilinear(distance, col);
    this.mesh.position.set(0, groundY, 0);
    this.mesh.quaternion.identity();

    const aspect = imageAspect(this.texture, RIDER_ASPECT);
    const height = this.params.height;
    this.card.scale.set(height * aspect, height, 1);
    const cruise = Math.min(1, Math.abs(speed) / 10);
    const bob = airborne ? 0 : Math.sin(distance * 2.1) * 0.018 * cruise;
    const lift = altitude === undefined ? 0 : Math.max(0, altitude - groundY);
    this.card.position.y = height / 2 + bob + lift;
    const lean = THREE.MathUtils.clamp(-lateralSpeed * 0.0035, -0.16, 0.16);
    this.card.rotation.set(0, 0, lean);
    // Undo the card scale so the lens stays a fixed size on the fender.
    const width = height * aspect;
    this.tail.scale.set(TAIL_LENS_W / width, TAIL_LENS_H / height, 1);
    this.tail.position.set(0, (TAIL_LENS_Y - height / 2) / height, 0.04);
  }

  /** Optional paint multiplier. Night falloff comes from the scene lights. */
  setAlbedo(r: number, g: number, b: number): void {
    this.cardMaterial.color.setRGB(r, g, b);
    this.blobMaterial.color.setRGB(r, g, b);
  }

  dispose(): void {
    this.card.geometry.dispose();
    this.blob.geometry.dispose();
    this.tail.geometry.dispose();
    this.cardMaterial.dispose();
    this.blobMaterial.dispose();
    this.tailMaterial.dispose();
    this.texture.dispose();
    this.tailMap.dispose();
    const blobMap = this.blobMaterial.map;
    blobMap?.dispose();
  }
}
