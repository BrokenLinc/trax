import * as THREE from 'three';

/** Shoulder fill (default terrain). */
export const SHOULDER_RGB = { r: 0x8a, g: 0xa0, b: 0xd6 } as const;
/** Central road strip. */
export const ASPHALT_RGB = { r: 0x5a, g: 0x5c, b: 0x62 } as const;

/** Atlas width: shoulder | road | road | shoulder, centred on the odd column grid. */
export const SURFACE_ATLAS_WIDTH = 4;

export type SurfaceKind = 'asphalt' | 'shoulder';

/** True for the two road quads flanking the centre column line (`centreCol`). */
export function isAsphaltQuad(c: number, centreCol: number): boolean {
  return c === centreCol - 1 || c === centreCol;
}

/** Road texel used by asphalt quad `c` (west → left, east → right). */
export function asphaltSideForQuad(c: number, centreCol: number): 'left' | 'right' {
  if (c === centreCol - 1) return 'left';
  if (c === centreCol) return 'right';
  throw new RangeError(`asphaltSideForQuad: c=${c} is not a road quad for centreCol=${centreCol}`);
}

/**
 * UV at texel centre for the 4×1 atlas. `side` picks the left/right shoulder
 * or the left/right road texel so the strip stays centred on `centreCol`.
 */
export function uvForSurface(kind: SurfaceKind, side: 'left' | 'right' = 'left'): [number, number] {
  const w = SURFACE_ATLAS_WIDTH;
  const u =
    kind === 'shoulder'
      ? side === 'left'
        ? 0.5 / w
        : 3.5 / w
      : side === 'left'
        ? 1.5 / w
        : 2.5 / w;
  return [u, 0.5];
}

/** Nearest-filtered strip atlas; swap pixels or replace with a loaded PNG later. */
export function createTerrainSurfaceTexture(): THREE.DataTexture {
  const pixel = (rgb: { readonly r: number; readonly g: number; readonly b: number }) =>
    [rgb.r, rgb.g, rgb.b, 255] as const;
  const data = new Uint8Array([
    ...pixel(SHOULDER_RGB),
    ...pixel(ASPHALT_RGB),
    ...pixel(ASPHALT_RGB),
    ...pixel(SHOULDER_RGB),
  ]);
  const tex = new THREE.DataTexture(data, SURFACE_ATLAS_WIDTH, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
