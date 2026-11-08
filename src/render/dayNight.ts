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
 */
export interface DayNightSample {
  time: number;
  /** Sun elevation, 1 overhead, 0 on the horizon, negative at night. */
  sunElevation: number;
  sky: DayColor;
  fog: DayColor;
  cloud: DayColor;
  /** White at noon. Tints unlit trees and the rider so they go dark at night. */
  albedo: DayColor;
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
  fog: DayColor;
  cloud: DayColor;
  albedo: DayColor;
}

const MIDNIGHT: Omit<Stop, 't'> = {
  sky: rgb(0.04, 0.06, 0.16),
  fog: rgb(0.06, 0.08, 0.16),
  cloud: rgb(0.16, 0.18, 0.32),
  albedo: rgb(0.2, 0.22, 0.32),
};

const STOPS: readonly Stop[] = [
  { t: 0, ...MIDNIGHT },
  {
    t: 0.18,
    sky: rgb(0.09, 0.1, 0.3),
    fog: rgb(0.1, 0.12, 0.28),
    cloud: rgb(0.26, 0.24, 0.46),
    albedo: rgb(0.32, 0.3, 0.46),
  },
  {
    t: 0.25,
    sky: rgb(1, 0.38, 0.22),
    fog: rgb(0.98, 0.52, 0.32),
    cloud: rgb(1, 0.58, 0.4),
    albedo: rgb(1, 0.78, 0.62),
  },
  {
    t: 0.33,
    sky: rgb(0.75, 0.86, 1),
    fog: rgb(0.7, 0.78, 0.86),
    cloud: rgb(1, 0.94, 0.88),
    albedo: rgb(1, 0.97, 0.92),
  },
  {
    t: 0.5,
    sky: rgb(1, 1, 1),
    fog: hexColor(NOON_FOG),
    cloud: rgb(1, 1, 1),
    albedo: rgb(1, 1, 1),
  },
  {
    t: 0.67,
    sky: rgb(1, 0.86, 0.62),
    fog: rgb(0.86, 0.68, 0.5),
    cloud: rgb(1, 0.82, 0.62),
    albedo: rgb(1, 0.94, 0.84),
  },
  {
    t: 0.75,
    sky: rgb(1, 0.28, 0.48),
    fog: rgb(0.92, 0.36, 0.46),
    cloud: rgb(1, 0.42, 0.55),
    albedo: rgb(1, 0.7, 0.64),
  },
  {
    t: 0.84,
    sky: rgb(0.32, 0.14, 0.48),
    fog: rgb(0.24, 0.14, 0.36),
    cloud: rgb(0.48, 0.28, 0.58),
    albedo: rgb(0.42, 0.34, 0.52),
  },
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
  const day = smoothstep(-0.15, 0.55, elevation);
  const moon = elevation < 0 ? smoothstep(0, 0.55, -elevation) : 0;
  const sunIntensity = up <= 0 ? 0 : 0.42 + 0.16 * Math.min(1, up / 0.35);
  return {
    time: t,
    sunElevation: elevation,
    sky: painted.sky,
    fog: painted.fog,
    cloud: painted.cloud,
    albedo: painted.albedo,
    horizon: lerpColor(painted.fog, rgb(1, 1, 1), day),
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
      color: lerpColor(rgb(1, 0.42, 0.16), hexColor(0xfff1d6), Math.min(1, up)),
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
      color: lerpColor(rgb(0.1, 0.13, 0.26), hexColor(0xd7dee6), day),
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
    fog: lerpColor(a.fog, b.fog, u),
    cloud: lerpColor(a.cloud, b.cloud, u),
    albedo: lerpColor(a.albedo, b.albedo, u),
  };
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
