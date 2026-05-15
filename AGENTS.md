# AGENTS.md

This file is the orientation for AI agents. It assumes you already know how to
read TypeScript, run `pnpm`, and use `git`. It only tells you the things that
are specific to this project.

## What this project is

A real-time renderer with one unusual idea: the road is shaped from a 1D bend
field accumulated outward from the player's current row. The player never moves
in X or Z; they're pinned to the world origin and the road is repositioned
underneath them every frame. Forward is `−Z`. Up is `+Y`.

The single source of truth for the bend semantics lives in
[`src/render/bendMath.ts`](src/render/bendMath.ts). If you're touching anything
that affects road shape, read it first; the prose at the top is short and
exact.

## Codebase map

- `src/world/` — pure procedural sources. No DOM, no Three.js. Deterministic.
- `src/render/` — Three.js mesh, camera, scene; consumes `world` and
  `bendMath`.
- `src/player/` — input → `distance` along the road. `distance` IS `playerRow`.
- `src/debug/` — HUD, lil-gui knobs, and the `window.__MODE7__` inspector.
- `src/app.ts` — owns the loop and exposes the inspector surface.
- `src-tauri/` — Tauri 2 desktop shell. Loads the Vite build.
- `scripts/` — headless Playwright runners (snapshot, introspect, perf).
- `tests/` — Vitest specs for the math and the world layer.

## The verification gate

Before declaring a task done, run:

```bash
pnpm verify
```

That runs typecheck → lint → format check → unit tests → production build.
A clean exit means your change compiles, type-checks, lints clean, formats
correctly, doesn't break existing tests, and ships a working bundle.

## Headless introspection (your eyes when you can't see the screen)

The browser exposes `window.__MODE7__` with `getState()`, `setSeed()`,
`setDistance()`, `tick()`, `dumpMesh()`, `dumpWorld()`, and `screenshot()`.
Three Node-side scripts wrap it:

- `pnpm snapshot --seed mode7 --distance 120` → PNG + JSON in `artifacts/`.
  Use this for visual regression on render changes.
- `pnpm introspect --seed mode7 --distance 120` → JSON to stdout (or `--out
file.json`). Use this to reason about geometry without pixels.
- `pnpm perf --frames 600` → JSON percentiles of per-tick wall time. Use this
  to confirm a perf-sensitive change doesn't regress.

All three boot a Vite preview server, drive a headless Chromium with
`?headless=1` (which disables rAF and steps only via `tick()`), and tear
down on exit.

## Conventions

- TypeScript is strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Don't loosen them; either narrow at the call
  site or use a `?? defaultValue`.
- Comments explain intent or trade-offs, never restate code.
- New features go through the verification gate before commit. If a test pins
  a behaviour and you need to change it, change the test deliberately and
  explain why in the commit message.

## When you need to change…

- **Bend math** → load the `mode7-bend-math` skill, then edit
  `src/render/bendMath.ts` and update `tests/bendMath.spec.ts`.
- **Anything visual** → load the `mode7-introspect` skill and capture a
  before/after snapshot at a fixed seed.
- **Perf** → baseline with `pnpm perf` before your change, then again after.
