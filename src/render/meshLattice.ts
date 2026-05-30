/**
 * World-space X for a depth-map column index, measured from the road centre
 * (signedCol 0). Road spacing applies on segments −1↔0 and 0↔+1; landscape
 * spacing applies from ±1 outward.
 */
export function worldXForSignedCol(
  signedCol: number,
  roadColSpacing: number,
  landscapeColSpacing: number,
): number {
  if (signedCol === 0) return 0;
  const sign = Math.sign(signedCol);
  const abs = Math.abs(signedCol);
  if (abs === 1) return sign * roadColSpacing;
  return sign * (roadColSpacing + (abs - 1) * landscapeColSpacing);
}

/** Inverse of `worldXForSignedCol` for depth sampling at a lateral world offset. */
export function signedColFromWorldX(
  worldX: number,
  roadColSpacing: number,
  landscapeColSpacing: number,
): number {
  if (worldX === 0) return 0;
  const sign = Math.sign(worldX);
  const abs = Math.abs(worldX);
  if (abs <= roadColSpacing) return (sign * abs) / roadColSpacing;
  return sign * (1 + (abs - roadColSpacing) / landscapeColSpacing);
}

export interface MeshLateralBounds {
  minX: number;
  maxX: number;
}

/** World-space X limits of the outermost baked mesh columns. */
export function meshLateralBounds(
  cols: number,
  roadColSpacing: number,
  landscapeColSpacing: number,
): MeshLateralBounds {
  const oddCols = cols % 2 === 0 ? cols + 1 : cols;
  const half = Math.floor(oddCols / 2);
  return {
    minX: worldXForSignedCol(-half, roadColSpacing, landscapeColSpacing),
    maxX: worldXForSignedCol(half, roadColSpacing, landscapeColSpacing),
  };
}
