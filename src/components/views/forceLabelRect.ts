import { quadtree, type QuadtreeLeaf } from 'd3-quadtree';
import type { SimulationNodeDatum } from 'd3-force';

/**
 * A simulation node carrying a precomputed label-footprint box. The four values
 * are the box edges expressed as offsets from the node's center (x, y):
 *
 *   left   = x + bx0   (bx0 is typically negative)
 *   right  = x + bx1
 *   top    = y + by0
 *   bottom = y + by1
 *
 * The box is intentionally asymmetric — it extends mostly rightward because the
 * label text is drawn to the right of the circle — and it already includes the
 * circle radius, so resolving box overlaps also keeps circles from overlapping.
 */
export interface RectCollideNode extends SimulationNodeDatum {
  bx0?: number;
  by0?: number;
  bx1?: number;
  by1?: number;
}

/** An axis-aligned box in absolute coordinates. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * Penetration depth of two boxes on each axis. A positive value on an axis means
 * the boxes overlap along that axis; the boxes truly overlap only when *both*
 * components are positive.
 */
export function rectPenetration(a: Box, b: Box): { x: number; y: number } {
  return {
    x: Math.min(a.r, b.r) - Math.max(a.l, b.l),
    y: Math.min(a.b, b.b) - Math.max(a.t, b.t),
  };
}

export interface ForceLabelRect<N extends RectCollideNode> {
  (alpha: number): void;
  initialize(nodes: N[], random?: () => number): void;
  strength(): number;
  strength(value: number): ForceLabelRect<N>;
}

/**
 * A d3-force collision force that separates nodes by their rectangular label
 * footprints instead of by circles (which is all the built-in `forceCollide`
 * supports). Modeled on `forceCollide`: each tick it builds a quadtree over node
 * centers and, for every node, visits only the quads that could possibly contain
 * an overlapping box (pruned using the global maximum half-extent). Overlapping
 * pairs are pushed apart along their axis of least penetration (the minimum
 * translation vector), split evenly between the two nodes and scaled by
 * `strength`. Like `forceCollide`, the push is applied to velocities and is not
 * scaled by alpha — a `strength` below 1 plus the simulation's velocity decay
 * lets the system settle.
 */
export function forceLabelRect<N extends RectCollideNode>(): ForceLabelRect<N> {
  let nodes: N[] = [];
  let strength = 0.7;
  let maxHalfW = 0;
  let maxHalfH = 0;

  function boxOf(node: N, cx: number, cy: number): Box {
    return {
      l: cx + (node.bx0 ?? 0),
      t: cy + (node.by0 ?? 0),
      r: cx + (node.bx1 ?? 0),
      b: cy + (node.by1 ?? 0),
    };
  }

  function resolve(a: N, b: N): void {
    // Use projected positions (current + pending velocity), matching forceCollide.
    const a0 = boxOf(a, (a.x ?? 0) + (a.vx ?? 0), (a.y ?? 0) + (a.vy ?? 0));
    const b0 = boxOf(b, (b.x ?? 0) + (b.vx ?? 0), (b.y ?? 0) + (b.vy ?? 0));
    const pen = rectPenetration(a0, b0);
    if (pen.x <= 0 || pen.y <= 0) return;

    if (pen.x < pen.y) {
      // Separate horizontally, along the shallower overlap.
      const dir = (a0.l + a0.r) >= (b0.l + b0.r) ? 1 : -1;
      const push = (pen.x / 2) * strength * dir;
      a.vx = (a.vx ?? 0) + push;
      b.vx = (b.vx ?? 0) - push;
    } else {
      // Separate vertically.
      const dir = (a0.t + a0.b) >= (b0.t + b0.b) ? 1 : -1;
      const push = (pen.y / 2) * strength * dir;
      a.vy = (a.vy ?? 0) + push;
      b.vy = (b.vy ?? 0) - push;
    }
  }

  function force(): void {
    const tree = quadtree(
      nodes,
      d => (d.x ?? 0) + (d.vx ?? 0),
      d => (d.y ?? 0) + (d.vy ?? 0),
    );
    for (const node of nodes) {
      const xi = (node.x ?? 0) + (node.vx ?? 0);
      const yi = (node.y ?? 0) + (node.vy ?? 0);
      // A box of node can reach at most its own half-extent plus the largest
      // half-extent in the graph; anything farther cannot overlap.
      const rx = Math.max(Math.abs(node.bx0 ?? 0), Math.abs(node.bx1 ?? 0)) + maxHalfW;
      const ry = Math.max(Math.abs(node.by0 ?? 0), Math.abs(node.by1 ?? 0)) + maxHalfH;
      tree.visit((quad, x0, y0, x1, y1) => {
        if (!Array.isArray(quad)) {
          // Leaf: walk its linked list of coincident points. Resolve each pair
          // once, when handling the lower-indexed of the two nodes.
          let leaf: QuadtreeLeaf<N> | undefined = quad;
          do {
            const other = leaf.data;
            if ((other.index ?? 0) > (node.index ?? 0)) resolve(node, other);
          } while ((leaf = leaf.next));
        }
        // Prune quads entirely outside the interaction window.
        return x0 > xi + rx || x1 < xi - rx || y0 > yi + ry || y1 < yi - ry;
      });
    }
  }

  force.initialize = (_nodes: N[]): void => {
    nodes = _nodes;
    maxHalfW = 0;
    maxHalfH = 0;
    for (const n of nodes) {
      maxHalfW = Math.max(maxHalfW, Math.abs(n.bx0 ?? 0), Math.abs(n.bx1 ?? 0));
      maxHalfH = Math.max(maxHalfH, Math.abs(n.by0 ?? 0), Math.abs(n.by1 ?? 0));
    }
  };

  force.strength = function (value?: number): number | ForceLabelRect<N> {
    if (value === undefined) return strength;
    strength = value;
    return force as ForceLabelRect<N>;
  };

  return force as ForceLabelRect<N>;
}
