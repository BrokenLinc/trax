---
name: mode7-bend-math
description: Authoritative definition of the per-row bend offset math used by the mode7b renderer, with worked numeric examples. Use when editing src/render/bendMath.ts, when reviewing a change to road shape, or when reasoning about why an offset has a particular value.
---

# mode7b — bend math

## Concept

The road's shape comes from a 1D array of signed slopes `bends[]`, indexed by
integer row. Every row in the visible window is shifted sideways (in X) by a
signed offset that depends on the player's fractional row position
`playerRow`. The player's own row has offset 0.

Treat `bends[i]` as the **constant slope on the half-open interval `[i-1, i)`**
in row-space. The X offset of any row `r` is the signed integral of slope
between `playerRow` and `r`.

## Closed-form

Let `lo = floor(playerRow)`, `frac = playerRow - lo`, and `P` be the exclusive
prefix sum of `bends` (so `P[0] = 0`, `P[i] = bends[0] + … + bends[i-1]`):

```
offset(row) = P[row+1] - P[lo+1] - frac * bends[lo+1]
```

This is what `rowOffset` in `src/render/bendMath.ts` computes, and what
`rebuildOffsets` does in bulk for the whole window.

## Worked examples

Indexing convention in the examples: window starts at row `0`, so
`bends[i]` is the slope into row `i`.

### Example 1 — player exactly on row 0

`playerRow = 0`, `frac = 0`, so `offset(row) = P[row+1] - P[1] - 0`.

With every visible bend equal to `1` (forward and backward):

| row | offset |
| --: | -----: |
|   0 |      0 |
|   1 |      1 |
|   2 |      2 |
|   3 |      3 |
|  -1 |     -1 |
|  -2 |     -2 |
|  -3 |     -3 |

Note the asymmetry: stepping forward from row 0 to row 1 crosses interval
`[0, 1)` whose slope is `bend@row1`. Stepping backward from row 0 to row -1
crosses interval `[-1, 0)` whose slope is `bend@row0`. The bend at the
player's own row therefore contributes to the first backward step but not
the first forward step — a property of the "slope on `[i-1, i)`"
interpretation. The asymmetry test in `tests/bendMath.spec.ts` pins this.

### Example 2 — player between rows

`playerRow = 0.4`, `lo = 0`, `frac = 0.4`. With `bends[1] = 2`:

```
offset(0) = P[1] - P[1] - 0.4 * 2 = -0.8
offset(1) = P[2] - P[1] - 0.8     = (1·2) - 0 - 0.8 = 1.2
```

So as the player crosses from row 0 to row 1, the offset of row 1 smoothly
interpolates from `bends[1]` (when `frac=0`) down to `0` (when `frac=1`),
which is exactly what the player should see: their current row is always at
offset 0.

### Example 3 — continuity at row crossings

For any `row` and any small `ε > 0`, `offset(row, lo+1-ε) ≈ offset(row, lo+1+ε)`.
The test `is continuous across an integer row crossing` in
`tests/bendMath.spec.ts` enforces this. If you ever write a formula that
doesn't satisfy continuity, the road will visibly snap when the player
crosses a row boundary.

## Tangent-aligned presentation (what gets rendered)

The cumulative offsets above describe the world's true shape. The renderer
draws a different layer on top: the **tangent-aligned** presentation, which
subtracts a tangent line at the player so the rendered road has BOTH zero
offset AND zero local slope at the player's position. Mental model:
"unwrap" the road so it always extends straight ahead from where the
player sits.

```
visible(row) = offset(row) − s(playerRow) · (row − playerRow)
```

For continuity across integer-row crossings, `s` is lerp-smoothed across
the player's current interval:

```
s(playerRow) = (1 − frac) · bends[lo+1] + frac · bends[lo+2]
```

Implemented as `rowOffsetTangentAligned` and `rebuildOffsetsTangentAligned`
in `src/render/bendMath.ts`. The terrain mesh always uses the bulk variant.

### Example 4 — constant bend ramp renders as flat

If every visible bend equals the same constant `c`, then `s = c` for every
playerRow and the cumulative offsets are exactly cancelled by the tangent
subtraction. Every row's `visible(row) = 0`. Physically: a uniform tilt is
just a rotation of the world, and in a non-rotating frame the right thing
to do is render it as flat. The test `collapses a constant-bend ramp to
flat` pins this.

### Example 5 — bump in the distance

Bends are `0` everywhere except a single `+1` at the slope into row 5.
With `playerRow = 0`, the local tangent at the player is `0` (since
`bends[1] = bends[2] = 0`), so `visible(row) = offset(row)` and the bump
shows up undisturbed at row 5+. As the player drives forward and `lo+1`
catches up to the bump's row, the local tangent absorbs the slope: when
`lo+1 = 5`, `s = bends[5] = 1`, so the bump's contribution is subtracted
and the road locally appears straight ahead. Once the player is past, `s`
returns to 0 and the bump re-emerges as cumulative offset behind them.

## When editing

1. Update the math in `src/render/bendMath.ts`.
2. Run `pnpm test --run tests/bendMath.spec.ts` to confirm the discrete
   examples and the continuity invariant still hold.
3. Capture a visual diff:
   ```bash
   pnpm snapshot --seed mode7 --distance 0
   pnpm snapshot --seed mode7 --distance 120
   ```
4. Run the full gate: `pnpm verify`.
