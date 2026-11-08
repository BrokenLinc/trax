import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const RAW = resolve('assets/src');
const PUBLIC = resolve('public');

type Channels = 4;

async function rawImage(input: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function idx(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

/** 5-bit channels. The step is what makes a sprite read as 32-bit rather than a photo. */
function posterize(buf: Buffer | Uint8Array): void {
  const step = 255 / 31;
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3] ?? 0;
    if (a < 8) continue;
    for (let c = 0; c < 3; c++) {
      const v = buf[i + c] ?? 0;
      buf[i + c] = Math.round(Math.round(v / step) * step);
    }
  }
}

/** Drop a flat magenta screen and crop to the remaining opaque pixels. */
async function keyMagenta(
  input: string,
  output: string,
  height: number,
  style: 'pixel' | 'soft' = 'pixel',
): Promise<void> {
  const { data, width, height: h } = await rawImage(input);
  const buf = Buffer.from(data);
  const keyed = new Uint8Array(width * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(width, x, y);
      const r = buf[i] ?? 0;
      const g = buf[i + 1] ?? 0;
      const b = buf[i + 2] ?? 0;
      const mag = Math.min(r, b) - g;
      let alpha = 255;
      if (mag > 40) {
        alpha = 0;
      } else if (mag > 14) {
        const kill = Math.min(1, (mag - 14) / 30);
        alpha = Math.round(255 * (1 - kill));
        buf[i] = Math.round(r * (1 - kill) + g * kill);
        buf[i + 2] = Math.round(b * (1 - kill) + g * kill);
      } else if (mag > 3) {
        const kill = Math.min(1, (mag - 3) / 18);
        buf[i] = Math.round(r * (1 - kill * 0.85) + g * kill * 0.85);
        buf[i + 2] = Math.round(b * (1 - kill * 0.85) + g * kill * 0.85);
      }
      keyed[y * width + x] = alpha;
    }
  }
  const eroded = erodeAlpha(keyed, width, h);
  let minX = width;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = eroded[y * width + x] ?? 0;
      buf[idx(width, x, y) + 3] = alpha;
      if (alpha > 20) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error(`keyMagenta: nothing opaque in ${input}`);
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  if (style === 'pixel') posterize(buf);
  await mkdir(dirname(output), { recursive: true });
  await sharp(buf, { raw: { width, height: h, channels: 4 satisfies Channels } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .resize({ height, fit: 'inside', kernel: style === 'pixel' ? 'nearest' : 'lanczos3' })
    .png()
    .toFile(output);
  if (output.endsWith('horizon.png')) await fadeTop(output, 0.42);
  console.info(`[art] ${output}`);
}

/** Dissolve the top of a backdrop into the sky so the card has no rim. */
async function fadeTop(output: string, portion: number): Promise<void> {
  const { data, width, height } = await rawImage(output);
  const buf = Buffer.from(data);
  const band = Math.max(1, Math.floor(height * portion));
  for (let y = 0; y < band; y++) {
    const t = y / band;
    const mul = t * t;
    for (let x = 0; x < width; x++) {
      const i = idx(width, x, y) + 3;
      buf[i] = Math.round((buf[i] ?? 0) * mul);
    }
  }
  await sharp(buf, { raw: { width, height, channels: 4 satisfies Channels } })
    .png()
    .toFile(output);
}

function erodeAlpha(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let minA = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const a = src[(y + dy) * width + (x + dx)] ?? 0;
          if (a < minA) minA = a;
        }
      }
      out[y * width + x] = minA;
    }
  }
  return out;
}

function mixByte(a: number, b: number, t: number): number {
  return Math.round(a * (1 - t) + b * t);
}

/** Pull opposite edges toward each other so a tile does not show a seam. */
async function seamless(
  input: string,
  output: string,
  axes: 'v' | 'both',
  size: number,
  pixelStep = 160,
): Promise<void> {
  const { data, width, height } = await rawImage(input);
  const buf = Buffer.from(data);
  const blend = Math.min(56, Math.floor(Math.min(width, height) / 4));

  const pix = (x: number, y: number): [number, number, number, number] => {
    const i = idx(width, x, y);
    return [buf[i] ?? 0, buf[i + 1] ?? 0, buf[i + 2] ?? 0, buf[i + 3] ?? 255];
  };
  const set = (x: number, y: number, c: [number, number, number, number]): void => {
    const i = idx(width, x, y);
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = c[3];
  };
  const mix = (
    a: [number, number, number, number],
    b: [number, number, number, number],
    t: number,
  ): [number, number, number, number] => [
    mixByte(a[0], b[0], t),
    mixByte(a[1], b[1], t),
    mixByte(a[2], b[2], t),
    mixByte(a[3], b[3], t),
  ];

  if (axes === 'v' || axes === 'both') {
    for (let y = 0; y < blend; y++) {
      const wgt = 0.5 * (1 - y / blend);
      for (let x = 0; x < width; x++) {
        const top = pix(x, y);
        const bot = pix(x, height - 1 - y);
        set(x, y, mix(top, bot, wgt));
        set(x, height - 1 - y, mix(bot, top, wgt));
      }
    }
  }
  if (axes === 'both') {
    for (let x = 0; x < blend; x++) {
      const wgt = 0.5 * (1 - x / blend);
      for (let y = 0; y < height; y++) {
        const left = pix(x, y);
        const right = pix(width - 1 - x, y);
        set(x, y, mix(left, right, wgt));
        set(width - 1 - x, y, mix(right, left, wgt));
      }
    }
  }

  const small = pixelStep;
  const shrunk = await sharp(buf, { raw: { width, height, channels: 4 } })
    .resize(small, small, { fit: 'fill', kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  posterize(shrunk);
  await mkdir(dirname(output), { recursive: true });
  await sharp(shrunk, { raw: { width: small, height: small, channels: 4 } })
    .resize(size, size, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toFile(output);
  console.info(`[art] ${output}`);
}

async function skyCopy(input: string, output: string): Promise<void> {
  const { data, width, height } = await rawImage(input);
  let r = 0;
  let g = 0;
  let b = 0;
  const rows = Math.min(8, height);
  let n = 0;
  for (let y = height - rows; y < height; y++) {
    for (let x = 0; x < width; x += 8) {
      const i = idx(width, x, y);
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n += 1;
    }
  }
  const hex = [r, g, b]
    .map((v) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  console.info(`[art] sky bottom ~ #${hex}`);
  await mkdir(dirname(output), { recursive: true });
  await sharp(input).png().toFile(output);
  console.info(`[art] ${output}`);
}

async function main(): Promise<void> {
  await seamless(
    resolve(RAW, 'road-atlas.jpg'),
    resolve(PUBLIC, 'terrain-chunk-surface.png'),
    'v',
    1024,
    320,
  );
  await seamless(
    resolve(RAW, 'ground-forest.jpg'),
    resolve(PUBLIC, 'textures/ground-forest.png'),
    'both',
    1024,
  );
  await skyCopy(resolve(RAW, 'sky-gradient.jpg'), resolve(PUBLIC, 'sprites/sky.png'));

  const cutouts: Array<[string, string, number, 'pixel' | 'soft']> = [
    ['rider-raw.jpg', 'sprites/rider.png', 80, 'pixel'],
    ['tree-broadleaf-raw.jpg', 'sprites/tree-broadleaf.png', 112, 'pixel'],
    ['tree-pine-raw.jpg', 'sprites/tree-pine.png', 112, 'pixel'],
    ['shrub-raw.jpg', 'sprites/shrub.png', 48, 'pixel'],
    ['post-raw.jpg', 'sprites/post.png', 48, 'pixel'],
    ['rock-raw.jpg', 'sprites/rock.png', 48, 'pixel'],
    ['cloud-a-raw.jpg', 'sprites/cloud-a.png', 640, 'soft'],
    ['cloud-b-raw.jpg', 'sprites/cloud-b.png', 640, 'soft'],
    ['horizon-raw.jpg', 'sprites/horizon.png', 360, 'soft'],
  ];
  for (const [src, dest, height, style] of cutouts) {
    await keyMagenta(resolve(RAW, src), resolve(PUBLIC, dest), height, style);
  }
  await logMountainFog(resolve(PUBLIC, 'sprites/horizon.png'));
}

/**
 * Mean colour of the opaque middle of the horizon card: below the faded
 * sky, above the dark tree line. That is the fog colour. Paste it into
 * `MODE7_DEFAULTS.fog.color` when this backdrop changes.
 */
async function logMountainFog(file: string): Promise<void> {
  const { data, width, height } = await rawImage(file);
  const y0 = Math.floor(height * 0.45);
  const y1 = Math.floor(height * 0.7);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < width; x += 4) {
      const i = idx(width, x, y);
      if ((data[i + 3] ?? 0) < 200) continue;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n += 1;
    }
  }
  if (n === 0) {
    console.info('[art] mountain fog ~ (no opaque pixels)');
    return;
  }
  const hex = [r, g, b]
    .map((v) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  console.info(`[art] mountain fog ~ #${hex}  → MODE7_DEFAULTS.fog.color`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
