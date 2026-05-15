---
name: mode7-introspect
description: Use the headless snapshot/introspect/perf scripts to verify rendering changes in mode7b without a human in the loop. Use when modifying anything in src/render/, src/world/, or src/app.ts; when validating that a refactor didn't change behaviour; or when investigating a perf regression.
---

# mode7b — headless introspection

Three scripts let an agent verify the renderer's behaviour deterministically.
All three boot the production build via `pnpm preview`, drive a Playwright
Chromium with `?headless=1` (which disables `requestAnimationFrame` and steps
only via `window.__MODE7__.tick()`), and tear down on exit.

> **Build freshness.** The runtime always rebuilds `dist/` before serving,
> so any source edit you make is reflected in the next snapshot. If you see
> a snapshot that contradicts the source you just wrote, suspect a stale
> browser cache or a non-source data dependency — not a stale build.

## Workflows

### 1. "Did my visual change do what I think?"

```bash
# Before
pnpm snapshot --seed mode7 --distance 0   --out artifacts/before-d0.png
pnpm snapshot --seed mode7 --distance 120 --out artifacts/before-d120.png

# Make your change, then:
pnpm snapshot --seed mode7 --distance 0   --out artifacts/after-d0.png
pnpm snapshot --seed mode7 --distance 120 --out artifacts/after-d120.png
```

Each `.png` is paired with a `.json` containing the full state, mesh, and
world dump, so you can diff geometry as well as pixels.

### 2. "Why is this row at this offset?"

```bash
pnpm introspect --seed mode7 --distance 42.5 --ahead 16 --behind 4
```

The output JSON includes `mesh.bends`, `mesh.prefix`, `mesh.offsets`, and
`mesh.windowRowStart`. From those you can reconstruct any `offset(row)` by
hand using the formula in the `mode7-bend-math` skill.

### 3. "Did my change regress perf?"

```bash
pnpm perf --frames 600          # baseline before your change
# … make change …
pnpm perf --frames 600          # compare meanMs / p95Ms / effectiveFps
```

Per-tick wall time is what changes when you alter the inner loop. It does
not include rAF/vsync, so it isn't a real-world FPS — it's a stable
comparator across edits.

## Inspector reference

`window.__MODE7__` (typed as `Mode7Inspector` in
`src/debug/inspector.ts`) is the entire surface you can call from
`page.evaluate`. Methods you'll actually use from a script:

- `getState()` → seed, distance, speed, playerY, fps, paused, headless
- `setSeed(s)`, `setDistance(d)`, `setSpeed(s)`, `setPaused(p)`
- `tick(frames=1, dt=1/60)` → step the loop
- `dumpMesh()` → bend window, prefix sums, X offsets
- `dumpWorld({ rowsAhead, rowsBehind })` → params + sampled bend / depth
- `screenshot()` → base64 PNG data URL

The Node-side helper `scripts/_runtime.ts` exposes the same surface as a
typed `Mode7Tunnel` so you don't have to write `page.evaluate` calls by hand.

## Adding a new headless check

Most checks fit into `scripts/snapshot.ts`'s structure: import
`withPreviewPage` from `_runtime.ts`, write the body inline, save artifacts
to `artifacts/`. Don't add a new dependency unless you genuinely need it.
