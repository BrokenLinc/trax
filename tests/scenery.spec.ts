import { describe, expect, it } from 'vitest';

import {
  SCENERY_CLEARANCE_M,
  TREE_MIN_M,
  VALLEY_DROP_M,
  flatHeight,
  isTreeKind,
  sceneryForRow,
  sceneryInRange,
  type SceneryHeight,
  type SceneryKind,
} from '../src/world/scenery.ts';

const flat = flatHeight(0);

function isTree(kind: string): boolean {
  return isTreeKind(kind as SceneryKind);
}

describe('sceneryForRow', () => {
  it('stays off the asphalt, keeps trees off the shoulder, and is stable', () => {
    const first = sceneryForRow('mode7', 40, flat);
    expect(sceneryForRow('mode7', 40, flat)).toEqual(first);
    for (let row = -30; row < 250; row++) {
      for (const inst of sceneryForRow('mode7', row, flat)) {
        expect(Math.abs(inst.localX)).toBeGreaterThanOrEqual(SCENERY_CLEARANCE_M);
        expect(inst.row).toBe(row);
        expect(inst.height).toBeGreaterThan(0.4);
        if (isTree(inst.kind)) {
          expect(Math.abs(inst.localX)).toBeGreaterThanOrEqual(TREE_MIN_M);
          expect(inst.height).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  it('leaves gaps so a row can have no trees', () => {
    let empty = 0;
    for (let row = 0; row < 200; row++) {
      const trees = sceneryForRow('mode7', row, flat).filter((inst) => isTree(inst.kind));
      if (trees.length === 0) empty += 1;
    }
    expect(empty).toBeGreaterThan(8);
  });

  it('does not plant pines on a valley floor', () => {
    const valley: SceneryHeight = {
      at(_row, localX) {
        return Math.abs(localX) < 1 ? 0 : -(VALLEY_DROP_M + 8);
      },
    };
    for (let row = 0; row < 80; row++) {
      for (const inst of sceneryForRow('mode7', row, valley)) {
        expect(isTree(inst.kind)).toBe(false);
      }
    }
  });

  it('plants trees on a ridge', () => {
    const ridge = flatHeight(12);
    const trees = sceneryInRange('mode7', 0, 60, ridge).filter((inst) => isTree(inst.kind));
    expect(trees.length).toBeGreaterThan(10);
    for (const tree of trees) {
      expect(Math.abs(tree.localX)).toBeGreaterThanOrEqual(TREE_MIN_M);
    }
  });

  it('keeps conifer and maple groves together', () => {
    const rows = 180;
    const runs = (match: (kind: SceneryKind) => boolean): number[] => {
      const lengths: number[] = [];
      let run = 0;
      for (let row = 0; row < rows; row++) {
        const hit = sceneryForRow('mode7', row, flat).some(
          (inst) => inst.localX > 0 && match(inst.kind),
        );
        if (hit) run += 1;
        else if (run > 0) {
          lengths.push(run);
          run = 0;
        }
      }
      if (run > 0) lengths.push(run);
      return lengths;
    };
    const mean = (lengths: number[]): number =>
      lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
    const conifer = runs((kind) => kind === 'pine' || kind === 'broadleaf' || kind === 'cedar');
    const maple = runs((kind) => kind === 'maple');
    expect(conifer.length).toBeGreaterThan(0);
    expect(Math.max(...conifer)).toBeGreaterThan(2);
    expect(mean(conifer)).toBeGreaterThan(1.5);
    expect(maple.length).toBeGreaterThan(0);
    expect(Math.max(...maple)).toBeGreaterThan(2);

    let same = 0;
    let changed = 0;
    let prev: number | null = null;
    for (let row = 0; row < rows; row++) {
      const tree = sceneryForRow('mode7', row, flat).find(
        (inst) =>
          inst.localX > 0 &&
          (inst.kind === 'pine' || inst.kind === 'broadleaf' || inst.kind === 'cedar'),
      );
      if (!tree) {
        prev = null;
        continue;
      }
      if (prev !== null) {
        if (tree.hue === prev) same += 1;
        else changed += 1;
      }
      prev = tree.hue;
    }
    expect(same).toBeGreaterThan(changed);
  });

  it('changes with the seed', () => {
    const a = sceneryInRange('mode7', 0, 40, flat);
    const b = sceneryInRange('other-day', 0, 40, flat);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });
});
