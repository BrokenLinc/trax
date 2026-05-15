import * as THREE from 'three';

const VIEWPORT_SIZE = 260;
const VIEWPORT_MARGIN = 14;
/** Half-extent of the view in world units; the view is square. */
const WORLD_HALF = 30;
/** How far ahead of the player to centre the view (negative Z = forward). */
const VIEW_OFFSET_Z = -15;
/** Camera height above the player; set well above any plausible terrain. */
const CAMERA_HEIGHT = 80;

/**
 * A bird's-eye debug view of the same scene, rendered as a square overlay
 * in the bottom-right corner. Uses the renderer's scissor/viewport to draw
 * a second camera into a sub-rectangle of the same canvas — no second
 * canvas, no render target.
 *
 * The orthographic camera's `up` is set to `(0, 0, -1)` so world `-Z`
 * (forward) appears as "up" in the view. The view is shifted forward by
 * `VIEW_OFFSET_Z` so most of what you see is the road ahead, with the
 * player anchored slightly below centre.
 */
export class TopDownView {
  readonly camera: THREE.OrthographicCamera;
  private readonly border: HTMLDivElement | null;
  private readonly label: HTMLDivElement | null;
  private visible = true;

  constructor(parent: HTMLElement | null) {
    this.camera = new THREE.OrthographicCamera(
      -WORLD_HALF,
      WORLD_HALF,
      WORLD_HALF,
      -WORLD_HALF,
      0.1,
      400,
    );
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, CAMERA_HEIGHT, VIEW_OFFSET_Z);
    this.camera.lookAt(0, 0, VIEW_OFFSET_Z);

    if (parent) {
      this.border = makeBorder();
      this.label = makeLabel();
      parent.appendChild(this.border);
      parent.appendChild(this.label);
    } else {
      this.border = null;
      this.label = null;
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (this.border) this.border.style.display = v ? 'block' : 'none';
    if (this.label) this.label.style.display = v ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Track the player's vertical bob so the camera stays well above terrain. */
  update(playerY: number): void {
    this.camera.position.set(0, playerY + CAMERA_HEIGHT, VIEW_OFFSET_Z);
    this.camera.lookAt(0, playerY, VIEW_OFFSET_Z);
  }

  /**
   * Draw the scene from the top-down camera into a corner viewport.
   * Call AFTER the main `renderer.render(scene, mainCamera)` so the overlay
   * sits on top.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.visible) return;
    const canvas = renderer.domElement;
    const dpr = renderer.getPixelRatio();
    const wp = VIEWPORT_SIZE * dpr;
    const hp = VIEWPORT_SIZE * dpr;
    // WebGL viewport origin is bottom-left of the drawing buffer; CSS pixels × DPR.
    const x = (canvas.clientWidth - VIEWPORT_SIZE - VIEWPORT_MARGIN) * dpr;
    const y = VIEWPORT_MARGIN * dpr;

    // The main scene's fog kills any view from 80 units up — disable it
    // for the second render so the bird's-eye actually shows the mesh.
    const savedFog = scene.fog;
    scene.fog = null;
    // With scissor enabled, three.js's internal clear only affects the
    // overlay region — the main scene we just rendered stays intact.
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, wp, hp);
    renderer.setViewport(x, y, wp, hp);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    scene.fog = savedFog;
  }

  destroy(): void {
    this.border?.remove();
    this.label?.remove();
  }
}

function makeBorder(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    bottom: `${VIEWPORT_MARGIN - 1}px`,
    right: `${VIEWPORT_MARGIN - 1}px`,
    width: `${VIEWPORT_SIZE + 2}px`,
    height: `${VIEWPORT_SIZE + 2}px`,
    border: '1px solid rgba(150, 170, 220, 0.35)',
    borderRadius: '4px',
    pointerEvents: 'none',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.4) inset',
    zIndex: '5',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

function makeLabel(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    bottom: `${VIEWPORT_MARGIN + VIEWPORT_SIZE + 4}px`,
    right: `${VIEWPORT_MARGIN}px`,
    font: '10px ui-monospace, monospace',
    color: 'rgba(216, 224, 255, 0.7)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    pointerEvents: 'none',
    zIndex: '5',
  } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = `top-down · ${WORLD_HALF * 2}\u00d7${WORLD_HALF * 2}`;
  return el;
}
