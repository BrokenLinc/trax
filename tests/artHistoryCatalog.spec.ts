import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNotes, readCatalog, resolveMediaPath } from '../scripts/artHistoryCatalog.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'art-history-'));
  dirs.push(dir);
  return dir;
}

const BASELINE = `Round 001 — baseline
When: 2026-11-07
Seed: mode7
Distances: 0, 120, 200
Frame: chase camera, top-down inset off, debug gizmos off
Target: third person, blue-collar motorcycle rider,
weather-worn country road.

snapshot-mode7-0.png
An orange sphere sits low in the frame.
Note: still the baseline.

Scores: rider 0/20, road 4/20. Total 15/100.

snapshot-mode7-120.png
Same sphere, same night grade.
Scores: rider 0/20. Total 13/100.

snapshot-mode7-200.png
The road actually winds.
Scores: rider 0/20. Total 26/100.

Round: median 15, low 13, high 26. Stop bar is median over 95.
`;

describe('parseNotes', () => {
  it('reads a baseline-shaped notes file', () => {
    const notes = parseNotes(BASELINE);
    expect(notes.title).toBe('Round 001 — baseline');
    expect(notes.when).toBe('2026-11-07');
    expect(notes.seed).toBe('mode7');
    expect(notes.distances).toBe('0, 120, 200');
    expect(notes.frame).toBe('chase camera, top-down inset off, debug gizmos off');
    expect(notes.target).toBe(
      'third person, blue-collar motorcycle rider,\nweather-worn country road.',
    );
    expect(notes.frames.map((frame) => frame.file)).toEqual([
      'snapshot-mode7-0.png',
      'snapshot-mode7-120.png',
      'snapshot-mode7-200.png',
    ]);
    expect(notes.frames[0]?.prose).toBe(
      'An orange sphere sits low in the frame.\nNote: still the baseline.',
    );
    expect(notes.frames[0]?.scores).toBe('Scores: rider 0/20, road 4/20. Total 15/100.');
    expect(notes.frames[1]?.prose).toBe('Same sphere, same night grade.');
    expect(notes.frames[1]?.scores).toBe('Scores: rider 0/20. Total 13/100.');
    expect(notes.summary).toBe('Round: median 15, low 13, high 26. Stop bar is median over 95.');
  });

  it('keeps a paragraph that is still being written and omits missing scores', () => {
    const notes = parseNotes(`Round 003 — dusk
When: 2026-11-07

snapshot-mode7-40.png
The sky is still`);
    expect(notes.title).toBe('Round 003 — dusk');
    expect(notes.when).toBe('2026-11-07');
    expect(notes.frames).toEqual([
      { file: 'snapshot-mode7-40.png', prose: 'The sky is still', scores: '' },
    ]);
    expect(notes.summary).toBe('');
  });

  it('does not throw on text that is not notes yet', () => {
    expect(() => parseNotes('???\nnot a field\n')).not.toThrow();
    expect(parseNotes('???\nnot a field\n').title).toBe('???\nnot a field');
  });
});

describe('readCatalog', () => {
  it('sorts rounds and images, and skips notes that have no png', async () => {
    const root = await tempRoot();
    await mkdir(join(root, '010-late'));
    await mkdir(join(root, '002-b'));
    await mkdir(join(root, '002-a'));
    await mkdir(join(root, 'extra'));
    await mkdir(join(root, 'scratch'));

    await writeFile(join(root, '010-late', 'shot-10.png'), 'png');
    await writeFile(join(root, '010-late', 'shot-2.png'), 'png');
    await writeFile(join(root, '010-late', 'plain.png'), 'png');
    await writeFile(join(root, '002-b', 'only.png'), 'png');
    await writeFile(join(root, '002-a', 'keep.png'), 'png');
    await writeFile(join(root, '002-a', 'bare.png'), 'png');
    await writeFile(join(root, 'extra', 'e.png'), 'png');
    await writeFile(join(root, 'scratch', 's.png'), 'png');
    await writeFile(join(root, 'log.txt'), 'not a round');
    await writeFile(
      join(root, '002-a', 'notes.txt'),
      `Round 002 — a
keep.png
Kept.
Scores: road 1/20.
gone.png
Missing from disk.
`,
    );

    const older = new Date('2020-01-01T00:00:00Z');
    const newer = new Date('2024-01-01T00:00:00Z');
    await utimes(join(root, 'scratch'), older, older);
    await utimes(join(root, 'extra'), newer, newer);

    const catalog = await readCatalog(root);
    expect(catalog.rounds.map((round) => round.folder)).toEqual([
      '010-late',
      '002-b',
      '002-a',
      'extra',
      'scratch',
    ]);

    const late = catalog.rounds[0];
    expect(late?.images.map((image) => image.file)).toEqual([
      'shot-2.png',
      'shot-10.png',
      'plain.png',
    ]);
    expect(late?.images.map((image) => image.distance)).toEqual([2, 10, null]);

    const described = catalog.rounds[2];
    expect(described?.title).toBe('Round 002 — a');
    expect(described?.images.map((image) => image.file)).toEqual(['bare.png', 'keep.png']);
    expect(described?.images[0]?.prose).toBe('');
    expect(described?.images[0]?.scores).toBe('');
    expect(described?.images[1]?.prose).toBe('Kept.');
    expect(described?.images[1]?.scores).toBe('Scores: road 1/20.');
  });

  it('uses the folder name when a round has pngs and no notes', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'no-notes'));
    await writeFile(join(root, 'no-notes', 'snapshot-mode7-0.png'), 'png');
    const catalog = await readCatalog(root);
    expect(catalog.rounds[0]?.title).toBe('no-notes');
    expect(catalog.rounds[0]?.images[0]?.prose).toBe('');
  });

  it('returns an empty catalog when the root is missing', async () => {
    const root = await tempRoot();
    await expect(readCatalog(join(root, 'missing'))).resolves.toEqual({ rounds: [] });
  });
});

describe('resolveMediaPath', () => {
  it('accepts a png inside the root and rejects paths that escape it', async () => {
    const root = await tempRoot();
    expect(resolveMediaPath(root, '001-baseline', 'shot.png')).toBe(
      resolve(root, '001-baseline', 'shot.png'),
    );
    expect(resolveMediaPath(root, '..', 'a.png')).toBeNull();
    expect(resolveMediaPath(root, '001-baseline', '../secret.png')).toBeNull();
    expect(resolveMediaPath(root, '001-baseline/../../tmp', 'a.png')).toBeNull();
    expect(resolveMediaPath(root, '001-baseline', 'notes.txt')).toBeNull();
  });
});
