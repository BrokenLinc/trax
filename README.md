# mode7b

A Mode-7-style procedural road tech demo. The player stays at the world origin
while a windowed mesh of terrain slides under and around them. The world is
driven by two procedural channels: a 2D depth map for vertex heights and a 1D
bend field for per-row sideways offsets accumulated outward from the player.

## Quickstart

```bash
pnpm install
pnpm dev          # web preview at http://localhost:5173
pnpm tauri:dev    # desktop window (requires rustup + cargo)
```

Controls: `W/↑` forward, `S/↓` reverse, `Shift` boost, `Space` pause, `R`
reseed, `G` wireframe, `V` top-down debug view.

**How the engine fits together** (depth map, bends, mesh, tangent-aligned
rendering): [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

For agents working in this repo, start with [AGENTS.md](AGENTS.md).
