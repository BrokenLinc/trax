# How mode7b works

This is a Mode‑7–style tech demo: the road and hills move; the observer does not. Everything below is what the code actually implements.

## Stationary observer, moving road

- The **player** is fixed at the world origin: **X = 0, Z = 0**. They never translate in X or Z.
- **Forward** is world **−Z**; **up** is **+Y**.
- The only gameplay coordinate that changes is **`distance`**: a continuous “row index” along the infinite procedural road. In code, **`distance` is `playerRow`** — the same number the bend math and mesh use.

So when you drive forward, the **terrain mesh and sampling window slide in Z** so that the row under the player always maps to the origin. The chase camera stays in a fixed pose except for **bobbing with terrain height** at the player’s column.

## Two independent procedural channels

The world is not one texture; it is **two samplers** with a shared seed.

1. **Depth map (2D)** — `world.depth.sample(absoluteRow, signedColumn)`  
   Gives **vertex height Y**. It is simplex-based noise with parameters for frequency, amplitude, octaves, and optional **road flattening** near column 0 (centre strip). Rows and columns are **integer indices** in world space; the mesh only ever asks for discrete `(row, col)` samples (no bilinear over “world XZ” for the grid itself, though helpers may interpolate for the player’s Y).

2. **Bend field (1D)** — `world.bend.sample(absoluteRow)`  
   Gives a **signed slope** for the interval **between** that row and the next. Those values are **not** drawn directly; they are **integrated sideways** to position each row in X (see below).

Reseeding swaps both channels under the same API object so `(seed, distance)` fully reproduces a frame.

## The mesh: one window, rebuilt every frame

The visible geometry is a **fixed grid** (rows × columns of vertices). Each frame:

- The **window** of absolute row indices is chosen so the player sits inside it (`rowsBehind` / `rowsAhead` in `TerrainMesh`).
- For each vertex row **r** at absolute row `absRow` and column **c**:
  - **Z** = `−(absRow − playerRow) · rowSpacing` — so the player’s row lands at **Z = 0** and forward rows go toward **negative Z**.
  - **X** = `(c − centreCol) · colSpacing` **plus** the row’s **bend offset** (after tangent alignment).
  - **Y** = depth sample at `(absRow, c − centreCol)`.

The mesh object’s **position stays at (0,0,0)**; **only vertex positions** change. There is **no rotation** of the terrain or player to fake the curve.

## Bend semantics: cumulative sideways drift

**`bend[i]`** is the **constant slope on the segment between row _i − 1_ and row _i_** (see `bendMath.ts` for exact indexing against the prefix sum). Going **from the player’s row toward another row**, the **raw** sideways offset is the **integral of slope** along that interval — implemented with an exclusive prefix sum over the window plus a fractional piece when `playerRow` is not an integer.

Intuition:

- **Ahead of the player**, offsets accumulate the bends you cross.
- **Behind**, they accumulate negatively.
- At the **player’s continuous row**, offset is **zero** by construction.

That is the “road moves through curvature” behaviour in **cumulative X translation** only.

## Why it still looked wrong: tangent-aligned rendering

Cumulative offset guarantees **zero lateral shift at the player**, but **not** zero **tilt**. If the road is bending, the row **just ahead** is already offset; **without an extra correction** the centre strip can look **diagonal under the observer** (sitting on a visually angled track).

The renderer therefore does **not** use raw cumulative offsets for the mesh. It uses **tangent-aligned** offsets:

\[
\text{visible}(\text{row}) = \text{cumulativeOffset}(\text{row}) - s(\text{playerRow}) \cdot (\text{row} - \text{playerRow})
\]

where \(s\) is the **local slope at the player** derived from the bend field (lerped across the fractional interval so row crossings stay smooth). That **subtracts a straight line** through the player with the same slope as the road there: **no mesh rotation**, only per-vertex X. Effects:

- At the player: **offset and local slope of the polyline are zero** in screen terms — the track **straightens** under your wheels; curvature shows up **farther** along the strip.
- A **constant** bend everywhere becomes **visually flat** (a uniform tilt is removed; you only see **changes** in bend).

Exact formulas, indexing, and tests: **`src/render/bendMath.ts`** and **`tests/bendMath.spec.ts`**.

## Summary diagram (mental model)

```
World space rows ----->  …  row-1   row0   row1   row2  …
                              |      |      |      |
Depth map                    Y      Y      Y      Y     ← height per (row, col)
Bend field                   ·      b₁     b₂     b₃    ← slope per segment

Mesh row r at absRow:  Z = f(playerRow, absRow)   X = colSpacing·(c−centre) + tangentAlignedOffset(r)
Player at origin:      sample depth at (playerRow, 0) for bob; camera follows Y only.
```

## Debug and introspection

- **Top-down inset** — second orthographic pass (scissored viewport) over the same scene; useful to see bend geometry the chase camera hides.
- **`window.__MODE7__`** — deterministic `tick`, `dumpMesh`, `dumpWorld`, `screenshot` for scripts under `scripts/`.

For agent workflows and the verify gate, see **`AGENTS.md`**.
