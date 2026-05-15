import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cumulativeOffsetAt,
  rebuildOffsetsTangentAligned,
  tangentSlopeAt,
} from '../src/render/bendMath.ts';
import { bakeChunk, type ChunkParams } from '../src/render/chunkBaker.ts';
import { ChunkStreamer, type StreamerParams } from '../src/render/chunkStreamer.ts';
import { WorldFrame } from '../src/render/worldFrame.ts';
import { World } from '../src/world/world.ts';

const CHUNK_PARAMS: ChunkParams = {
  rowsPerChunk: 16,
  cols: 7,
  rowSpacing: 1.0,
  colSpacing: 0.6,
};

function composeFrameMatrix(
  playerWorldX: number,
  playerZ: number,
  s: number,
  rowSpacing: number,
): THREE.Matrix4 {
  const t = new THREE.Matrix4().makeTranslation(-playerWorldX, 0, -playerZ);
  const sh = new THREE.Matrix4().makeShear(0, 0, 0, 0, s / rowSpacing, 0);
  return new THREE.Matrix4().multiplyMatrices(sh, t);
}

describe('WorldFrame matrix — single-chunk equivalence to rebuildOffsetsTangentAligned', () => {
  it('M · X_world(r, centre) === rebuildOffsetsTangentAligned for every row in the chunk', () => {
    const world = new World('worldFrameSingleChunk');
    const chunk = bakeChunk(world, 0, CHUNK_PARAMS);
    const cols = CHUNK_PARAMS.cols;
    const centre = Math.floor(cols / 2);
    const positions = chunk.geometry.getAttribute('position').array as Float32Array;

    // Sample the equivalence at a few fractional player rows inside the chunk.
    const playerRows = [0, 0.5, 1.0, 3.7, 7.25, 12.9, CHUNK_PARAMS.rowsPerChunk - 0.01];
    const out = new Float32Array(CHUNK_PARAMS.rowsPerChunk + 1);
    for (const playerRow of playerRows) {
      const playerWorldX = cumulativeOffsetAt(playerRow, chunk.rowStart, chunk.bends, chunk.prefix);
      const playerZ = -playerRow * CHUNK_PARAMS.rowSpacing;
      const s = tangentSlopeAt(playerRow, chunk.rowStart, chunk.bends);
      const M = composeFrameMatrix(playerWorldX, playerZ, s, CHUNK_PARAMS.rowSpacing);

      rebuildOffsetsTangentAligned(
        chunk.rowStart,
        CHUNK_PARAMS.rowsPerChunk + 1,
        playerRow,
        chunk.bends,
        chunk.prefix,
        out,
      );

      for (let r = 0; r <= CHUNK_PARAMS.rowsPerChunk; r++) {
        const idx = r * cols + centre;
        const v = new THREE.Vector3(
          positions[idx * 3] ?? 0,
          positions[idx * 3 + 1] ?? 0,
          positions[idx * 3 + 2] ?? 0,
        ).applyMatrix4(M);
        const expectedX = 0 * CHUNK_PARAMS.colSpacing + (out[r] ?? 0);
        const expectedZ = -(chunk.rowStart + r - playerRow) * CHUNK_PARAMS.rowSpacing;
        expect(v.x).toBeCloseTo(expectedX, 4);
        expect(v.z).toBeCloseTo(expectedZ, 4);
      }
    }
  });

  it('extends to non-centre columns with the right X offset = signedCol·colSpacing + visible(r)', () => {
    const world = new World('worldFrameAllCols');
    const chunk = bakeChunk(world, 0, CHUNK_PARAMS);
    const cols = CHUNK_PARAMS.cols;
    const centre = Math.floor(cols / 2);
    const positions = chunk.geometry.getAttribute('position').array as Float32Array;
    const playerRow = 5.4;
    const playerWorldX = cumulativeOffsetAt(playerRow, chunk.rowStart, chunk.bends, chunk.prefix);
    const playerZ = -playerRow * CHUNK_PARAMS.rowSpacing;
    const s = tangentSlopeAt(playerRow, chunk.rowStart, chunk.bends);
    const M = composeFrameMatrix(playerWorldX, playerZ, s, CHUNK_PARAMS.rowSpacing);

    const out = new Float32Array(CHUNK_PARAMS.rowsPerChunk + 1);
    rebuildOffsetsTangentAligned(
      chunk.rowStart,
      CHUNK_PARAMS.rowsPerChunk + 1,
      playerRow,
      chunk.bends,
      chunk.prefix,
      out,
    );
    for (let r = 0; r <= CHUNK_PARAMS.rowsPerChunk; r++) {
      for (let c = 0; c < cols; c++) {
        const signedCol = c - centre;
        const idx = r * cols + c;
        const v = new THREE.Vector3(
          positions[idx * 3] ?? 0,
          positions[idx * 3 + 1] ?? 0,
          positions[idx * 3 + 2] ?? 0,
        ).applyMatrix4(M);
        const expectedX = signedCol * CHUNK_PARAMS.colSpacing + (out[r] ?? 0);
        expect(v.x).toBeCloseTo(expectedX, 4);
      }
    }
  });
});

const STREAMER_PARAMS: StreamerParams = {
  rowsPerChunk: CHUNK_PARAMS.rowsPerChunk,
  cols: CHUNK_PARAMS.cols,
  rowSpacing: CHUNK_PARAMS.rowSpacing,
  colSpacing: CHUNK_PARAMS.colSpacing,
  rowsAhead: 32,
  rowsBehind: 8,
};

function dummyMaterial(): { main: THREE.Material; wireframe: THREE.Material } {
  return {
    main: new THREE.MeshBasicMaterial(),
    wireframe: new THREE.MeshBasicMaterial({ wireframe: true }),
  };
}

describe('WorldFrame matrix — multi-chunk seam continuity', () => {
  it('player crossing a chunk seam produces a continuous worldRoot matrix', () => {
    const world = new World('worldFrameSeam');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    const frame = new WorldFrame(streamer, { rowSpacing: STREAMER_PARAMS.rowSpacing });
    const seam = STREAMER_PARAMS.rowsPerChunk; // first chunk boundary
    const eps = 1e-4;

    frame.update(seam - eps);
    const mBefore = frame.worldRoot.matrix.clone();
    frame.update(seam + eps);
    const mAfter = frame.worldRoot.matrix.clone();

    for (let i = 0; i < 16; i++) {
      expect(mBefore.elements[i]).toBeCloseTo(mAfter.elements[i] ?? 0, 3);
    }
  });

  it('a fixed world-space point renders to (almost) the same screen X across a seam crossing', () => {
    const world = new World('worldFrameFixedPoint');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    const frame = new WorldFrame(streamer, { rowSpacing: STREAMER_PARAMS.rowSpacing });
    const seam = STREAMER_PARAMS.rowsPerChunk;
    const eps = 1e-4;

    // A world-space point 5 rows ahead of the seam, centre column.
    const fixedAbsRow = seam + 5;
    const fixedSignedCol = 0;

    function visibleX(playerRow: number): number {
      frame.update(playerRow);
      const containing = streamer.getChunkContaining(fixedAbsRow);
      // Sanity: the chunk holding fixedAbsRow must be loaded.
      expect(containing).toBeDefined();
      const baked = containing!.baked;
      const local = cumulativeOffsetAt(fixedAbsRow, baked.rowStart, baked.bends, baked.prefix);
      const worldX = containing!.phiAtStart + local + fixedSignedCol * STREAMER_PARAMS.colSpacing;
      const worldZ = -fixedAbsRow * STREAMER_PARAMS.rowSpacing;
      const p = new THREE.Vector3(worldX, 0, worldZ).applyMatrix4(frame.worldRoot.matrix);
      return p.x;
    }

    const before = visibleX(seam - eps);
    const after = visibleX(seam + eps);
    expect(before).toBeCloseTo(after, 3);
  });
});

describe('WorldFrame — unskewed debug mode', () => {
  it('disables the X-from-Z shear, leaving only translation', () => {
    const world = new World('unskewed');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    const frame = new WorldFrame(streamer, { rowSpacing: STREAMER_PARAMS.rowSpacing });
    frame.setUnskewed(true);
    frame.update(3.7);

    // A pure translation matrix has zero off-diagonals in the 3x3 part.
    // In Three.js Matrix4.elements is column-major. Index 8 is (row 0, col 2),
    // which is exactly the X-from-Z shear we want zero.
    expect(frame.worldRoot.matrix.elements[8]).toBeCloseTo(0, 6);
    // And the 3x3 is identity besides any tweak we made.
    expect(frame.worldRoot.matrix.elements[0]).toBeCloseTo(1, 6);
    expect(frame.worldRoot.matrix.elements[5]).toBeCloseTo(1, 6);
    expect(frame.worldRoot.matrix.elements[10]).toBeCloseTo(1, 6);
  });
});

describe('ChunkStreamer — loading behaviour', () => {
  it('loads chunks covering [playerRow − rowsBehind, playerRow + rowsAhead]', () => {
    const world = new World('streamerLoad');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    streamer.update(0);
    const loaded = streamer.getLoadedChunks();
    const min = Math.floor((0 - STREAMER_PARAMS.rowsBehind) / STREAMER_PARAMS.rowsPerChunk);
    const max = Math.floor((0 + STREAMER_PARAMS.rowsAhead) / STREAMER_PARAMS.rowsPerChunk);
    const indices = loaded.map((c) => c.chunkIndex);
    for (let i = min; i <= max; i++) expect(indices).toContain(i);
  });

  it('evicts chunks that drift outside the range as the player advances', () => {
    const world = new World('streamerEvict');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    streamer.update(0);
    streamer.update(STREAMER_PARAMS.rowsPerChunk * 4); // big forward step
    const loaded = streamer.getLoadedChunks();
    const min = Math.floor(
      (STREAMER_PARAMS.rowsPerChunk * 4 - STREAMER_PARAMS.rowsBehind) /
        STREAMER_PARAMS.rowsPerChunk,
    );
    for (const c of loaded) expect(c.chunkIndex).toBeGreaterThanOrEqual(min);
  });

  it('phiAtStart values form a chain: chunk N+1 starts at chunk N start + phiLocalSpan(N)', () => {
    const world = new World('streamerChain');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    streamer.update(0);
    const loaded = streamer.getLoadedChunks();
    for (let i = 0; i < loaded.length - 1; i++) {
      const left = loaded[i]!;
      const right = loaded[i + 1]!;
      if (right.chunkIndex !== left.chunkIndex + 1) continue;
      // Re-derive phiLocalSpan from the world to avoid coupling the test
      // to chunk internals.
      let span = 0;
      for (let r = 1; r <= STREAMER_PARAMS.rowsPerChunk; r++) {
        span += world.bend.sample(left.rowStart + r);
      }
      expect(right.phiAtStart).toBeCloseTo(left.phiAtStart + span, 4);
    }
  });

  it('invalidates and rebakes on a big jump (no overlap with previous range)', () => {
    const world = new World('streamerJump');
    const streamer = new ChunkStreamer(world, STREAMER_PARAMS, dummyMaterial());
    streamer.update(0);
    streamer.update(10_000);
    const loaded = streamer.getLoadedChunks();
    const containing = Math.floor(10_000 / STREAMER_PARAMS.rowsPerChunk);
    expect(loaded.some((c) => c.chunkIndex === containing)).toBe(true);
  });
});
