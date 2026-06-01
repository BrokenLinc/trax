import * as THREE from 'three';

/** Shoulder fill (default terrain). */
export const SHOULDER_RGB = { r: 0x8a, g: 0xa0, b: 0xd6 } as const;
/** Central road strip. */
export const ASPHALT_RGB = { r: 0x5a, g: 0x5c, b: 0x62 } as const;

/** Chunk-fill surface image resolution (`public/terrain-chunk-surface.png`). */
export const CHUNK_SURFACE_SIZE = 1024;

const CHUNK_SURFACE_URL = '/terrain-chunk-surface.png';

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
 * UV for a quad corner in chunk lattice space. Maps the full chunk surface image
 * once (0–1) with road centred on the column grid; warps with bent quads.
 */
export function chunkLatticeUv(
  quadRow: number,
  quadCol: number,
  cornerDu: 0 | 1,
  cornerDv: 0 | 1,
  rowsPerChunk: number,
  cols: number,
): [number, number] {
  const quadCols = cols - 1;
  return [(quadCol + cornerDu) / quadCols, (quadRow + cornerDv) / rowsPerChunk];
}

function applyChunkSurfaceSettings(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Shared chunk-fill surface map from `public/terrain-chunk-surface.png`. */
export function createChunkSurfaceTexture(onLoad?: () => void): THREE.Texture {
  const tex = new THREE.TextureLoader().load(
    CHUNK_SURFACE_URL,
    (loaded) => {
      applyChunkSurfaceSettings(loaded);
      onLoad?.();
    },
    undefined,
    (err) => {
      console.error('[terrainSurface] failed to load chunk surface PNG', err);
    },
  );
  return applyChunkSurfaceSettings(tex);
}
