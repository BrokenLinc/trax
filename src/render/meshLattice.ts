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
