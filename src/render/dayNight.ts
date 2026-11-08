/** One full day, in seconds. The ride starts at noon. */
export const DEFAULT_DAY_LENGTH_SECONDS = 240;

/** `t = 0` midnight, `0.25` sunrise, `0.5` noon, `0.75` sunset. */
export const NOON = 0.5;

/** The hazy mountain band the noon fog was tuned to. */
export const NOON_FOG = 0x91a1ba;

export interface DayColor {
  r: number;
  g: number;
  b: number;
}

export interface DayLight {
  x: number;
  y: number;
  z: number;
  color: DayColor;
  intensity: number;
}

/**
 * One instant of the cycle. Colors are 0–1 multipliers or fog channels.
 * `star` and `moon` are opacities. Sun elevation is in the light's Y.
 *
 * Sky and clouds take the saturated stops. The sun and ambient take that
 * hue as a gel, so the foreground shifts with the sky. Fog is the noon
 * mountain haze multiplied by the same tint as the mountain card, which
 * keeps the hills fading into the painted range instead of a flat wash.
 */
export interface DayNightSample {
  time: number;
  /** Sun elevation, 1 overhead, 0 on the horizon, negative at night. */
  sunElevation: number;
  sky: DayColor;
  fog: DayColor;
  cloud: DayColor;
  /** Mountain card. White at noon so the painted range is unchanged. */
  horizon: DayColor;
  star: number;
  moon: number;
  /** Across-track position of the moon, -1 to 1, and its height 0–1. */
  moonAcross: number;
  moonUp: number;
  sun: DayLight;
  moonLight: DayLight;
  ambient: { color: DayColor; intensity: number };
}

interface Stop {
  t: number;
  sky: DayColor;
  cloud: DayColor;
}

/** Noon sun and ambient. The cycle multiplies these by the sky gel. */
const NOON_SUN = 0xfff1d6;
const NOON_AMBIENT = 0xd7dee6;

/**
 * Mountain-card multiply once the sun is gone. Dark enough that the painted
 * range doesn't glow, blue enough that the night fog still meets it.
 */
const NIGHT_MOUNTAIN = rgb(0.12, 0.14, 0.25);

const MIDNIGHT: Omit<Stop, 't'> = {
  sky: rgb(0.04, 0.06, 0.16),
  cloud: rgb(0.16, 0.18, 0.32),
};

const STOPS: readonly Stop[] = [
  { t: 0, ...MIDNIGHT },
  { t: 0.18, sky: rgb(0.09, 0.1, 0.3), cloud: rgb(0.26, 0.24, 0.46) },
  { t: 0.25, sky: rgb(1, 0.38, 0.22), cloud: rgb(1, 0.58, 0.4) },
  { t: 0.33, sky: rgb(0.75, 0.86, 1), cloud: rgb(1, 0.94, 0.88) },
  { t: 0.5, sky: rgb(1, 1, 1), cloud: rgb(1, 1, 1) },
  { t: 0.67, sky: rgb(1, 0.86, 0.62), cloud: rgb(1, 0.82, 0.62) },
  { t: 0.75, sky: rgb(1, 0.28, 0.48), cloud: rgb(1, 0.42, 0.55) },
  { t: 0.84, sky: rgb(0.32, 0.14, 0.48), cloud: rgb(0.48, 0.28, 0.58) },
  { t: 1, ...MIDNIGHT },
];

export function wrapDayTime(time: number): number {
  const x = time % 1;
  return x < 0 ? x + 1 : x;
}

export function sampleDayNight(time: number): DayNightSample {
  const t = wrapDayTime(time);
  const phase = (t - 0.25) * Math.PI * 2;
  const elevation = Math.sin(phase);
  const across = Math.cos(phase);
  const up = Math.max(0, elevation);
  const painted = blendStops(t);
  const skyBright = Math.max(painted.sky.r, painted.sky.g, painted.sky.b);
  // Follow the sky, not the sun's elevation, so a bright sunset still lights the road.
  const day = smoothstep(0.18, 0.72, skyBright);
  const moon = elevation < 0 ? smoothstep(0, 0.55, -elevation) : 0;
  const sunIntensity = up <= 0 ? 0 : 0.42 + 0.16 * Math.min(1, up / 0.35);
  const lightGel = skyLightTint(painted.sky, 0.85);
  const mountainGel = skyLightTint(painted.sky, 0.4);
  const mountainsLit = smoothstep(-0.45, 0.12, elevation);
  const horizon = lerpColor(NIGHT_MOUNTAIN, mountainGel, mountainsLit);
  return {
    time: t,
    sunElevation: elevation,
    sky: painted.sky,
    fog: multiplyColor(hexColor(NOON_FOG), horizon),
    cloud: painted.cloud,
    horizon,
    // Off while the sun is up. Full only once it is well below the horizon.
    star: smoothstep(0.02, -0.5, elevation),
    moon,
    moonAcross: -across,
    moonUp: Math.max(0, -elevation),
    sun: {
      // A low sun stays high enough in Y that the hills still catch orange light.
      x: across * 22,
      y: up * 40 + (up > 0 ? 8 : -4),
      z: 12,
      color: multiplyColor(hexColor(NOON_SUN), lightGel),
      intensity: sunIntensity,
    },
    moonLight: {
      x: -across * 30,
      y: Math.max(0, -elevation) * 36 + 4,
      z: -8,
      color: rgb(0.72, 0.8, 0.98),
      intensity: moon * 0.16,
    },
    ambient: {
      color: multiplyColor(hexColor(NOON_AMBIENT), lightGel),
      intensity: 0.16 + 0.74 * day,
    },
  };
}

export function colorHex(color: DayColor): number {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return (r << 16) | (g << 8) | b;
}

function blendStops(t: number): Stop {
  let hi = 1;
  while (hi < STOPS.length - 1 && (STOPS[hi]?.t ?? 1) < t) hi += 1;
  const b = STOPS[hi] ?? STOPS[STOPS.length - 1];
  const a = STOPS[hi - 1] ?? b;
  if (!a || !b) throw new Error('dayNight: empty stops');
  const span = b.t - a.t;
  const u = span <= 0 ? 0 : (t - a.t) / span;
  return {
    t,
    sky: lerpColor(a.sky, b.sky, u),
    cloud: lerpColor(a.cloud, b.cloud, u),
  };
}

/** Sky hue lifted to a bright gel. `amount` is how fully the hue replaces white. */
function skyLightTint(sky: DayColor, amount: number): DayColor {
  const max = Math.max(sky.r, sky.g, sky.b);
  if (max <= 1e-4) return rgb(1, 1, 1);
  const hue = rgb(sky.r / max, sky.g / max, sky.b / max);
  const min = Math.min(sky.r, sky.g, sky.b);
  const sat = (max - min) / max;
  return lerpColor(rgb(1, 1, 1), hue, sat * amount);
}

function multiplyColor(a: DayColor, b: DayColor): DayColor {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b };
}

function lerpColor(a: DayColor, b: DayColor, u: number): DayColor {
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
  };
}

function rgb(r: number, g: number, b: number): DayColor {
  return { r, g, b };
}

function hexColor(hex: number): DayColor {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
