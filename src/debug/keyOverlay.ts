/**
 * A strip of keycaps for the view toggles. Latched keys stay pressed while
 * that mode is on. Reseed is momentary.
 */

export interface KeyOverlayModel {
  wireframe: boolean;
  topdown: boolean;
  devOverlays: boolean;
  paused: boolean;
  /** True when the chase camera faces straight down −Z. */
  cameraLevel: boolean;
  headlight: boolean;
}

export interface KeyOverlayActions {
  onWireframe: () => void;
  onTopdown: () => void;
  onDevOverlays: () => void;
  onReseed: () => void;
  onPause: () => void;
  onCamera: () => void;
  onHeadlight: () => void;
}

interface KeySpec {
  id: keyof KeyOverlayModel | 'reseed';
  cap: string;
  label: string;
  wide?: boolean;
  action: keyof KeyOverlayActions;
}

const KEYS: readonly KeySpec[] = [
  { id: 'wireframe', cap: 'G', label: 'Wireframe', action: 'onWireframe' },
  { id: 'topdown', cap: 'V', label: 'Top-down view', action: 'onTopdown' },
  { id: 'devOverlays', cap: '`', label: 'Dev overlays', action: 'onDevOverlays' },
  { id: 'reseed', cap: 'R', label: 'Reseed', action: 'onReseed' },
  { id: 'paused', cap: 'Space', label: 'Pause', wide: true, action: 'onPause' },
  { id: 'cameraLevel', cap: 'C', label: 'Camera mode', action: 'onCamera' },
  { id: 'headlight', cap: 'H', label: 'Headlight', action: 'onHeadlight' },
];

const STYLE_ID = 'mode7-key-overlay-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .mode7-keys {
      position: absolute;
      left: 14px;
      bottom: 14px;
      right: 292px;
      z-index: 12;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      align-items: center;
      pointer-events: none;
      font-family: ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Menlo, monospace;
    }
    .mode7-key {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: #e7eefc;
      cursor: pointer;
      pointer-events: auto;
    }
    .mode7-key kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-width: 34px;
      height: 34px;
      padding: 0 8px;
      border-radius: 7px;
      background: linear-gradient(#323a4e, #1c2333);
      border: 1px solid #6d7b98;
      border-bottom-width: 4px;
      border-bottom-color: #0c1018;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
      color: #f7f9ff;
      font: 600 13px/1 ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Menlo, monospace;
      text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
    }
    .mode7-key.is-wide kbd {
      min-width: 72px;
      padding: 0 12px;
      font-size: 11px;
      letter-spacing: 0.04em;
    }
    .mode7-key.is-on kbd,
    .mode7-key.is-held kbd {
      transform: translateY(3px);
      border-bottom-width: 1px;
      border-color: #d5e2ff;
      background: linear-gradient(#8ea4cc, #4c6288);
      color: #fff;
    }
    .mode7-key span {
      font-size: 12px;
      letter-spacing: 0.01em;
      color: rgba(231, 238, 252, 0.88);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

export class KeyOverlay {
  private readonly root: HTMLDivElement;
  private readonly keys = new Map<KeySpec['id'], HTMLButtonElement>();

  constructor(
    parent: HTMLElement,
    private readonly actions: KeyOverlayActions,
  ) {
    ensureStyle();
    this.root = document.createElement('div');
    this.root.className = 'mode7-keys';
    for (const spec of KEYS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = spec.wide ? 'mode7-key is-wide' : 'mode7-key';
      button.dataset['key'] = spec.id;
      const cap = document.createElement('kbd');
      cap.textContent = spec.cap;
      const label = document.createElement('span');
      label.textContent = spec.label;
      button.append(cap, label);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('pointerdown', () => button.classList.add('is-held'));
      const release = (): void => button.classList.remove('is-held');
      button.addEventListener('pointerup', release);
      button.addEventListener('pointerleave', release);
      button.addEventListener('click', () => this.actions[spec.action]());
      this.root.appendChild(button);
      this.keys.set(spec.id, button);
    }
    parent.appendChild(this.root);
  }

  update(model: KeyOverlayModel): void {
    for (const spec of KEYS) {
      const button = this.keys.get(spec.id);
      if (!button || spec.id === 'reseed') continue;
      button.classList.toggle('is-on', model[spec.id]);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
