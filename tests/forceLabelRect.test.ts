import { describe, it, expect } from 'vitest';
import { rectPenetration, forceLabelRect, type RectCollideNode } from '../src/components/views/forceLabelRect';

describe('rectPenetration', () => {
  it('reports positive penetration on both axes when boxes overlap', () => {
    const a = { l: 0, t: 0, r: 10, b: 10 };
    const b = { l: 6, t: 6, r: 16, b: 16 };
    expect(rectPenetration(a, b)).toEqual({ x: 4, y: 4 });
  });

  it('reports a non-positive component on the axis where boxes are separated', () => {
    const a = { l: 0, t: 0, r: 10, b: 10 };
    const b = { l: 20, t: 2, r: 30, b: 8 }; // clear of `a` on x, overlapping on y
    const pen = rectPenetration(a, b);
    expect(pen.x).toBeLessThanOrEqual(0);
    expect(pen.y).toBeGreaterThan(0);
  });

  it('is symmetric in its arguments', () => {
    const a = { l: 0, t: 0, r: 10, b: 10 };
    const b = { l: 5, t: 5, r: 15, b: 15 };
    expect(rectPenetration(a, b)).toEqual(rectPenetration(b, a));
  });
});

describe('forceLabelRect', () => {
  // A symmetric box centered on the node keeps the math easy to reason about.
  const box = (n: RectCollideNode, halfW: number, halfH: number): RectCollideNode => ({
    ...n,
    bx0: -halfW,
    bx1: halfW,
    by0: -halfH,
    by1: halfH,
  });

  it('pushes two overlapping nodes apart along the axis of least penetration', () => {
    // Boxes overlap; horizontal penetration (small dx) is shallower than vertical.
    const a: RectCollideNode = box({ index: 0, x: 0, y: 0, vx: 0, vy: 0 }, 10, 10);
    const b: RectCollideNode = box({ index: 1, x: 4, y: 1, vx: 0, vy: 0 }, 10, 10);
    const force = forceLabelRect<RectCollideNode>();
    force.initialize([a, b]);
    force(1);
    // Separation resolved on x (shallower): a shoved left (negative), b right.
    expect(a.vx as number).toBeLessThan(0);
    expect(b.vx as number).toBeGreaterThan(0);
    expect(a.vy).toBe(0);
    expect(b.vy).toBe(0);
    // Split is symmetric.
    expect(a.vx as number).toBeCloseTo(-(b.vx as number), 10);
  });

  it('leaves non-overlapping nodes untouched', () => {
    const a: RectCollideNode = box({ index: 0, x: 0, y: 0, vx: 0, vy: 0 }, 5, 5);
    const b: RectCollideNode = box({ index: 1, x: 100, y: 100, vx: 0, vy: 0 }, 5, 5);
    const force = forceLabelRect<RectCollideNode>();
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('resolves more of the overlap with more iterations', () => {
    const make = (): [RectCollideNode, RectCollideNode] => [
      box({ index: 0, x: 0, y: 0, vx: 0, vy: 0 }, 10, 10),
      box({ index: 1, x: 4, y: 1, vx: 0, vy: 0 }, 10, 10),
    ];
    // Residual penetration after the force = (1-strength)^iterations of the
    // original, so total applied push grows with iterations and approaches
    // (but never exceeds) full separation.
    const [a1, b1] = make();
    const once = forceLabelRect<RectCollideNode>().strength(0.7).iterations(1);
    once.initialize([a1, b1]);
    once(1);

    const [a3, b3] = make();
    const thrice = forceLabelRect<RectCollideNode>().strength(0.7).iterations(3);
    thrice.initialize([a3, b3]);
    thrice(1);

    expect(Math.abs(a3.vx as number)).toBeGreaterThan(Math.abs(a1.vx as number));
    // Boxes overlap by 16 on x; full separation pushes each node 8.
    expect(Math.abs(a3.vx as number)).toBeLessThan(8);
    // Push still splits symmetrically across passes.
    expect(a3.vx as number).toBeCloseTo(-(b3.vx as number), 10);
  });

  it('scales the push by strength', () => {
    const make = (): [RectCollideNode, RectCollideNode] => [
      box({ index: 0, x: 0, y: 0, vx: 0, vy: 0 }, 10, 10),
      box({ index: 1, x: 4, y: 1, vx: 0, vy: 0 }, 10, 10),
    ];
    const [a1, b1] = make();
    const full = forceLabelRect<RectCollideNode>().strength(1);
    full.initialize([a1, b1]);
    full(1);

    const [a2, b2] = make();
    const half = forceLabelRect<RectCollideNode>().strength(0.5);
    half.initialize([a2, b2]);
    half(1);

    expect(Math.abs(a2.vx as number)).toBeCloseTo(Math.abs(a1.vx as number) / 2, 10);
  });
});
