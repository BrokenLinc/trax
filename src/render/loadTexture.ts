import * as THREE from 'three';

/**
 * Headless snapshots fire as soon as `window.__MODE7__.ready` is true.
 * Texture loads are async, so the inspector stays unready until every
 * map started through {@link loadColorTexture} has settled.
 */
let started = 0;
let finished = 0;
const waiters: Array<() => void> = [];

function beginTextureLoad(): void {
  started += 1;
}

function finishTextureLoad(): void {
  finished += 1;
  if (finished < started) return;
  const pending = waiters.splice(0);
  for (const resolve of pending) resolve();
}

/** Resolves once every texture requested so far has loaded or failed. */
export function whenTexturesReady(): Promise<void> {
  if (started === 0 || finished >= started) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

/**
 * Load a color map and count it toward {@link whenTexturesReady}.
 * `configure` runs immediately and again on load, so wrap/filter setup
 * applies even when the image arrives later. Guard `needsUpdate` on
 * `tex.image` inside `configure` — setting it before the image exists
 * makes the renderer warn and skip the upload.
 */
export function loadColorTexture(
  url: string,
  configure: (tex: THREE.Texture) => void,
): THREE.Texture {
  beginTextureLoad();
  const tex = new THREE.TextureLoader().load(
    url,
    (loaded) => {
      configure(loaded);
      finishTextureLoad();
    },
    undefined,
    (err: unknown) => {
      console.error(`[texture] failed to load ${url}`, err);
      finishTextureLoad();
    },
  );
  configure(tex);
  return tex;
}
