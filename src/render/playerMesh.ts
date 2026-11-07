import * as THREE from 'three';

import type { World } from '../world/world.ts';
import { signedColFromWorldX } from './meshLattice.ts';
import { loadColorTexture } from './loadTexture.ts';

const RIDER_URL = '/sprites/rider.png';
const RIDER_HEIGHT = 1.82;
const RIDER_ASPECT = 0.72;

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
  private readonly texture: THREE.Texture;
  private readonly cardMaterial: THREE.MeshBasicMaterial;
  private readonly blobMaterial: THREE.MeshBasicMaterial;
  private readonly params: PlayerMeshParams;

  constructor(params: PlayerMeshParams = DEFAULT_PLAYER_MESH) {
    this.params = params;
    this.texture = loadColorTexture(RIDER_URL, configureRider);
    this.cardMaterial = new THREE.MeshBasicMaterial({
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

    this.mesh = new THREE.Group();
    this.mesh.add(this.card);
    this.mesh.add(this.blob);
    this.mesh.frustumCulled = false;
  }

  update(
    distance: number,
    world: World,
    lateralX: number,
    roadColSpacing: number,
    landscapeColSpacing: number,
    speed = 0,
    lateralSpeed = 0,
  ): void {
    const col = signedColFromWorldX(lateralX, roadColSpacing, landscapeColSpacing);
    const groundY = world.depth.sampleBilinear(distance, col);
    this.mesh.position.set(0, groundY, 0);
    this.mesh.quaternion.identity();

    const aspect = imageAspect(this.texture, RIDER_ASPECT);
    const height = this.params.height;
    this.card.scale.set(height * aspect, height, 1);
    const cruise = Math.min(1, Math.abs(speed) / 10);
    const bob = Math.sin(distance * 2.1) * 0.018 * cruise;
    this.card.position.y = height / 2 + bob;
    const lean = THREE.MathUtils.clamp(-lateralSpeed * 0.0035, -0.16, 0.16);
    this.card.rotation.set(0, 0, lean);
  }

  dispose(): void {
    this.card.geometry.dispose();
    this.blob.geometry.dispose();
    this.cardMaterial.dispose();
    this.blobMaterial.dispose();
    this.texture.dispose();
    const blobMap = this.blobMaterial.map;
    blobMap?.dispose();
  }
}
