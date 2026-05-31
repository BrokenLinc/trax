/**
 * Bend math — the heart of the renderer.
 *
 * Given a 1D array `bends[]` of per-row signed slopes and a fractional
 * `playerRow`, compute the per-row sideways X offset of every row in a
 * sliding window. The player's row has offset zero; rows ahead curve out
 * by the cumulative sum of bends; rows behind curve out by the cumulative
 * sum subtracted. As the player advances between rows, the entire offset
 * profile slides smoothly so there is no discontinuity at row crossings.
 *
 * Discrete behaviour (player exactly on row `p`):
 *   ahead:   bends = [b_{p+1}, b_{p+2}, b_{p+3}]  →  offsets = [b_{p+1}, b_{p+1}+b_{p+2}, ...]
 *   behind:  bends = [b_p,     b_{p-1}, b_{p-2}]  →  offsets = [-b_p,    -b_p-b_{p-1},   ...]
 *
 * Continuous semantics: treat `bend[i]` as the constant slope on the
 * interval [i-1, i], and define
 *
 *   offset(row) = ∫ from playerRow to row of slope(t) dt
 *
 * Closed-form with an exclusive prefix sum `P` (P[0]=0, P[i]=Σ bends[0..i-1]):
 *
 *   offset(row) = P[row+1] - P[playerLo+1] - frac · bends[playerLo+1]
 *
 * where `playerLo = floor(playerRow)` and `frac = playerRow - playerLo`.
 *
 * The whole module is pure and Three.js-free so unit tests run in milliseconds.
 */

/** Exclusive prefix sum: out[0] = 0, out[i] = bends[0]+…+bends[i-1]. */
export function prefixSum(bends: ArrayLike<number>, out?: Float32Array): Float32Array {
  const n = bends.length;
  const buf = out && out.length >= n + 1 ? out : new Float32Array(n + 1);
  buf[0] = 0;
  for (let i = 0; i < n; i++) buf[i + 1] = (buf[i] ?? 0) + (bends[i] ?? 0);
  return buf;
}

/**
 * Sideways X offset for a single absolute row, given a window of bends
 * starting at absolute row `windowRowStart` and its prefix sum.
 *
 * Rows outside the window clamp to the window edge (no NaNs, no crashes);
 * the renderer should keep the player comfortably inside the window so this
 * clamping never kicks in for visible rows.
 */
export function rowOffset(
  row: number,
  playerRow: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
  prefix: Float32Array,
): number {
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const localPlayer = lo - windowRowStart;
  const localRow = row - windowRowStart;
  const slopeIdx = localPlayer + 1;
  const slope = slopeIdx >= 0 && slopeIdx < bends.length ? (bends[slopeIdx] ?? 0) : 0;
  const a = readPrefixClamped(prefix, localRow + 1);
  const b = readPrefixClamped(prefix, localPlayer + 1);
  return a - b - frac * slope;
}

/**
 * Bulk version: fill `out[0..rowCount-1]` with the X offset of each row in
 * the window. Equivalent to calling `rowOffset` for every row but does the
 * shared work (slope, base prefix value) once.
 */
export function rebuildOffsets(
  windowRowStart: number,
  rowCount: number,
  playerRow: number,
  bends: ArrayLike<number>,
  prefix: Float32Array,
  out: Float32Array,
): void {
  if (out.length < rowCount) {
    throw new RangeError(`rebuildOffsets: out length ${out.length} < rowCount ${rowCount}`);
  }
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const localPlayer = lo - windowRowStart;
  const slopeIdx = localPlayer + 1;
  const slope = slopeIdx >= 0 && slopeIdx < bends.length ? (bends[slopeIdx] ?? 0) : 0;
  const base = readPrefixClamped(prefix, localPlayer + 1);
  for (let i = 0; i < rowCount; i++) {
    const a = readPrefixClamped(prefix, i + 1);
    out[i] = a - base - frac * slope;
  }
}

/**
 * Cumulative bend integral from `windowRowStart` to (possibly fractional)
 * `row`. With `bends[i]` the slope on `[windowRowStart + i − 1, windowRowStart + i)`
 * and `prefix` its exclusive prefix sum:
 *
 *   Φ(windowRowStart)               = 0
 *   Φ(windowRowStart + k)           = prefix[k + 1] − prefix[1]    (= bends[1] + … + bends[k])
 *   Φ(windowRowStart + k + frac)    = prefix[k + 1] − prefix[1] + frac · bends[k + 1]
 *
 * This is the natural "Φ relative to the window start" reading; both the
 * chunk baker and the per-frame skew matrix use it as their world-X anchor.
 * Differences `cumulativeOffsetAt(rowA, …) − cumulativeOffsetAt(rowB, …)`
 * agree with `rowOffset(rowA, rowB, …)` for free.
 */
export function cumulativeOffsetAt(
  row: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
  prefix: Float32Array,
): number {
  const lo = Math.floor(row);
  const frac = row - lo;
  const local = lo - windowRowStart;
  const base = readPrefixClamped(prefix, 1);
  const slope = bendAt(bends, local + 1);
  return readPrefixClamped(prefix, local + 1) - base + frac * slope;
}

/**
 * Lerp-smoothed local tangent slope at the player's fractional row. This
 * is the `s` used by `rebuildOffsetsTangentAligned` and by the world-space
 * renderer's per-frame skew matrix. The smoothing keeps the rendered road
 * continuous as the player crosses integer row boundaries.
 *
 *   s = (1 − frac) · bends[lo + 1] + frac · bends[lo + 2]
 */
export function tangentSlopeAt(
  playerRow: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
): number {
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const local = lo - windowRowStart;
  const s1 = bendAt(bends, local + 1);
  const s2 = bendAt(bends, local + 2);
  return (1 - frac) * s1 + frac * s2;
}

/**
 * Lerp-smoothed local first difference of tangent slope at the player's
 * fractional row. Zero when bends are constant; used for player drift.
 *
 *   Δs = (1 − frac) · (bends[lo + 2] − bends[lo + 1]) + frac · (bends[lo + 3] − bends[lo + 2])
 */
export function tangentSlopeChangeAt(
  playerRow: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
): number {
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const local = lo - windowRowStart;
  const d1 = bendAt(bends, local + 2) - bendAt(bends, local + 1);
  const d2 = bendAt(bends, local + 3) - bendAt(bends, local + 2);
  return (1 - frac) * d1 + frac * d2;
}

/**
 * "Tangent-aligned" presentation of the cumulative offsets. Subtracts a
 * tangent line at the player's position so the rendered road has BOTH zero
 * offset AND zero local slope at the player — the player never appears to
 * sit on a tilted track even when the underlying bend field is curving.
 *
 *   visible(row) = offset(row) − s(playerRow) · (row − playerRow)
 *
 * The tangent slope `s` is lerp-smoothed across the player's current
 * interval so the result is continuous at integer-row crossings:
 *
 *   s(playerRow) = (1 − frac) · bends[lo+1] + frac · bends[lo+2]
 *
 * Properties:
 *   · visible(playerRow) = 0 for all playerRow.
 *   · d/d(row) visible(playerRow) = 0 exactly at integer playerRow; tiny
 *     residual `frac · (bends[lo+1] − bends[lo+2])` between integers,
 *     bounded by the bend field's local first difference.
 *   · Continuous in playerRow at row crossings (the lerp-smoothed `s`
 *     and the cumulative offset both agree at frac→1− and frac=0+).
 *   · A constant-bend ramp renders as flat (every row's offset is zero),
 *     because a uniform tilt in a non-rotating frame is what you'd cancel.
 */
export function rowOffsetTangentAligned(
  row: number,
  playerRow: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
  prefix: Float32Array,
): number {
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const localPlayer = lo - windowRowStart;
  const s1 = bendAt(bends, localPlayer + 1);
  const s2 = bendAt(bends, localPlayer + 2);
  const s = (1 - frac) * s1 + frac * s2;
  const a = readPrefixClamped(prefix, row - windowRowStart + 1);
  const b = readPrefixClamped(prefix, localPlayer + 1);
  const cumulative = a - b - frac * s1;
  return cumulative - s * (row - playerRow);
}

/**
 * Bulk version of `rowOffsetTangentAligned`. Hoists the per-frame constants
 * (`s`, `s1`, `base`, `playerRow`) out of the loop so the inner pass is one
 * prefix lookup, one subtraction, and one fused multiply-add per row.
 */
export function rebuildOffsetsTangentAligned(
  windowRowStart: number,
  rowCount: number,
  playerRow: number,
  bends: ArrayLike<number>,
  prefix: Float32Array,
  out: Float32Array,
): void {
  if (out.length < rowCount) {
    throw new RangeError(
      `rebuildOffsetsTangentAligned: out length ${out.length} < rowCount ${rowCount}`,
    );
  }
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const localPlayer = lo - windowRowStart;
  const s1 = bendAt(bends, localPlayer + 1);
  const s2 = bendAt(bends, localPlayer + 2);
  const s = (1 - frac) * s1 + frac * s2;
  const base = readPrefixClamped(prefix, localPlayer + 1);
  const cumulativeShift = base + frac * s1;
  for (let i = 0; i < rowCount; i++) {
    const a = readPrefixClamped(prefix, i + 1);
    const absRow = windowRowStart + i;
    out[i] = a - cumulativeShift - s * (absRow - playerRow);
  }
}

/**
 * Reference implementation used by tests: O(rowCount) per call, no prefix
 * sum. Should agree with `rowOffset` to within float precision for every
 * input. If they ever diverge, one of them is wrong.
 */
export function rowOffsetReference(
  row: number,
  playerRow: number,
  windowRowStart: number,
  bends: ArrayLike<number>,
): number {
  const lo = Math.floor(playerRow);
  const frac = playerRow - lo;
  const localPlayer = lo - windowRowStart;
  const slopeIdx = localPlayer + 1;
  const slope = slopeIdx >= 0 && slopeIdx < bends.length ? (bends[slopeIdx] ?? 0) : 0;
  let s = -frac * slope;
  if (row > lo) {
    for (let r = lo + 1; r <= row; r++) {
      const i = r - windowRowStart;
      if (i >= 0 && i < bends.length) s += bends[i] ?? 0;
    }
  } else if (row < lo) {
    for (let r = lo; r > row; r--) {
      const i = r - windowRowStart;
      if (i >= 0 && i < bends.length) s -= bends[i] ?? 0;
    }
  }
  return s;
}

function readPrefixClamped(prefix: Float32Array, idx: number): number {
  if (idx <= 0) return prefix[0] ?? 0;
  if (idx >= prefix.length) return prefix[prefix.length - 1] ?? 0;
  return prefix[idx] ?? 0;
}

function bendAt(bends: ArrayLike<number>, idx: number): number {
  if (idx < 0 || idx >= bends.length) return 0;
  return bends[idx] ?? 0;
}
