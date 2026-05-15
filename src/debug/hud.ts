/**
 * Tiny HUD overlay rendered as DOM (cheaper and more accessible than
 * drawing into the canvas). Updated each frame with `update(model)`.
 */
export interface HudModel {
  fps: number;
  seed: string;
  distance: number;
  speed: number;
  playerY: number;
  rowFloor: number;
  rowFrac: number;
  bendAtPlayer: number;
  paused: boolean;
  headless: boolean;
}

export class Hud {
  private readonly el: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute',
      top: '8px',
      left: '8px',
      padding: '8px 10px',
      background: 'rgba(5, 6, 10, 0.55)',
      backdropFilter: 'blur(6px)',
      border: '1px solid rgba(150, 170, 220, 0.18)',
      borderRadius: '6px',
      font: '12px ui-monospace, monospace',
      color: '#dbe5ff',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      lineHeight: '1.45',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  update(m: HudModel): void {
    this.el.textContent = [
      `fps        ${m.fps.toFixed(0).padStart(4)}${m.paused ? '  [paused]' : ''}${m.headless ? '  [headless]' : ''}`,
      `seed       ${m.seed}`,
      `distance   ${m.distance.toFixed(2)}`,
      `speed      ${m.speed.toFixed(2)}`,
      `player Y   ${m.playerY.toFixed(3)}`,
      `row        ${m.rowFloor} + ${m.rowFrac.toFixed(3)}`,
      `bend@row   ${m.bendAtPlayer.toFixed(3)}`,
      ``,
      `[W/↑] forward  [S/↓] reverse  [Shift] boost`,
      `[Space] pause  [R] reseed  [G] wireframe  [V] top-down`,
    ].join('\n');
  }

  destroy(): void {
    this.el.remove();
  }
}
