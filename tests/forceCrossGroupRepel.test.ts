import { describe, it, expect } from 'vitest';
import { forceCrossGroupRepel, type CrossGroupNode } from '../src/components/views/forceCrossGroupRepel';

const node = (index: number, x: number, group: string | undefined): CrossGroupNode => ({
  index,
  x,
  y: 0,
  vx: 0,
  vy: 0,
  crossRepelGroup: group,
});

describe('forceCrossGroupRepel', () => {
  it('pushes apart two nodes in different groups', () => {
    const a = node(0, 0, 'folderA');
    const b = node(1, 10, 'folderB');
    const force = forceCrossGroupRepel<CrossGroupNode>().strength(220);
    force.initialize([a, b]);
    force(1);
    // a is left of b → a shoved further left, b further right.
    expect(a.vx!).toBeLessThan(0);
    expect(b.vx!).toBeGreaterThan(0);
    expect(a.vx!).toBeCloseTo(-b.vx!, 10); // symmetric
  });

  it('does nothing for two nodes in the same group', () => {
    const a = node(0, 0, 'folderA');
    const b = node(1, 10, 'folderA');
    const force = forceCrossGroupRepel<CrossGroupNode>().strength(220);
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('ignores nodes with an undefined group (e.g. folders)', () => {
    const file = node(0, 0, 'folderA');
    const folder = node(1, 10, undefined);
    const force = forceCrossGroupRepel<CrossGroupNode>().strength(220);
    force.initialize([file, folder]);
    force(1);
    expect(file.vx).toBe(0);
    expect(folder.vx).toBe(0);
  });

  it('does not apply beyond distanceMax', () => {
    const a = node(0, 0, 'folderA');
    const b = node(1, 500, 'folderB'); // far apart
    const force = forceCrossGroupRepel<CrossGroupNode>().strength(220).distanceMax(180);
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('skips cross-group pairs rejected by the filter', () => {
    const a = node(0, 0, 'folderA');
    const b = node(1, 10, 'folderB');
    const force = forceCrossGroupRepel<CrossGroupNode>().strength(220).filter(() => false);
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('applies only to cross-group pairs accepted by the filter', () => {
    // Tag nodes via group naming: the filter only lets file-vs-folder pairs
    // through, mirroring how FolderGraphView separates pair classes.
    type KindNode = CrossGroupNode & { isDirectory: boolean };
    const kindNode = (index: number, x: number, group: string, isDirectory: boolean): KindNode =>
      ({ ...node(index, x, group), isDirectory });

    const fileA = kindNode(0, 0, 'folderA', false);
    const fileB = kindNode(1, 10, 'folderB', false);
    const folderC = kindNode(2, 20, 'folderC', true);
    const force = forceCrossGroupRepel<KindNode>()
      .strength(220)
      .filter((a, b) => a.isDirectory !== b.isDirectory);
    force.initialize([fileA, fileB, folderC]);
    force(1);
    // fileA-fileB is filtered out; each file interacts only with folderC,
    // which is pushed right by both files (it sits right of both).
    expect(fileA.vx!).toBeLessThan(0);
    expect(fileB.vx!).toBeLessThan(0);
    expect(folderC.vx!).toBeGreaterThan(0);
  });

  it('scales the push by alpha', () => {
    const make = (): [CrossGroupNode, CrossGroupNode] => [node(0, 0, 'A'), node(1, 10, 'B')];

    const [a1, b1] = make();
    const f1 = forceCrossGroupRepel<CrossGroupNode>().strength(220);
    f1.initialize([a1, b1]);
    f1(1);

    const [a2, b2] = make();
    const f2 = forceCrossGroupRepel<CrossGroupNode>().strength(220);
    f2.initialize([a2, b2]);
    f2(0.5);

    expect(Math.abs(a2.vx!)).toBeCloseTo(Math.abs(a1.vx!) / 2, 10);
  });
});
