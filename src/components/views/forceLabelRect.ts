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
  iterations(): number;
  iterations(value: number): ForceLabelRect<N>;
}

/**
 * A d3-force collision force that separates nodes by their rectangular label
 * footprints instead of by circles (which is all the built-in `forceCollide`
 * supports). Modeled on `forceCollide`: each tick it builds a quadtree over node
 * centers and, for every node, visits only the quads that could possibly contain
 * an overlapping box. Pruning uses per-subtree maximum half-extents cached on
 * the quadtree cells by a bottom-up pass (mirroring how `forceCollide` caches a
 * per-cell max radius), so one unusually wide label only widens the search near
 * itself rather than inflating every node's search window graph-wide. Overlapping
 * pairs are pushed apart along their axis of least penetration (the minimum
 * translation vector), split evenly between the two nodes and scaled by
 * `strength`. Like `forceCollide`, the push is applied to velocities and is not
 * scaled by alpha — a `strength` below 1 plus the simulation's velocity decay
 * lets the system settle.
 *
 * `iterations` (default 1, like `forceCollide`) repeats the whole resolution
 * pass that many times per tick, each pass seeing the velocities the previous
 * one produced. One pass at strength s leaves (1-s) of a penetration in place,
 * which other forces can keep replenishing; k passes shrink the residual to
 * (1-s)^k, so raise this for more rigidity when strong repulsion forces are
 * squeezing nodes together, at a linear cost per extra pass.
 */
/**
 * Subtree-max label half-extents cached on every quadtree cell (internal node
 * or leaf) by the bottom-up pass in onePass, then read by the top-down visit
 * to prune. Attached as expando properties, the same way d3's forceCollide
 * stores its per-cell max radius.
 */
interface QuadExtents {
  hw: number;
  hh: number;
}

export function forceLabelRect<N extends RectCollideNode>(): ForceLabelRect<N> {
  let nodes: N[] = [];
  let strength = 0.7;
  let iterations = 1;

  function halfW(n: N): number {
    return Math.max(Math.abs(n.bx0 ?? 0), Math.abs(n.bx1 ?? 0));
  }

  function halfH(n: N): number {
    return Math.max(Math.abs(n.by0 ?? 0), Math.abs(n.by1 ?? 0));
  }

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
    for (let k = 0; k < iterations; k++) onePass();
  }

  function onePass(): void {
    const tree = quadtree(
      nodes,
      d => (d.x ?? 0) + (d.vx ?? 0),
      d => (d.y ?? 0) + (d.vy ?? 0),
    );
    // Bottom-up pass caching each cell's subtree-max half-extents for pruning.
    tree.visitAfter((quad) => {
      let hw = 0;
      let hh = 0;
      if (Array.isArray(quad)) {
        // Internal cell: max over its (up to four) child cells, already tagged
        // since visitAfter runs children first.
        for (const child of quad) {
          if (!child) continue;
          const ext = child as unknown as QuadExtents;
          hw = Math.max(hw, ext.hw);
          hh = Math.max(hh, ext.hh);
        }
      } else {
        // Leaf: max over its linked list of coincident points.
        let leaf: QuadtreeLeaf<N> | undefined = quad;
        do {
          hw = Math.max(hw, halfW(leaf.data));
          hh = Math.max(hh, halfH(leaf.data));
        } while ((leaf = leaf.next));
      }
      const ext = quad as unknown as QuadExtents;
      ext.hw = hw;
      ext.hh = hh;
    });
    for (const node of nodes) {
      const xi = (node.x ?? 0) + (node.vx ?? 0);
      const yi = (node.y ?? 0) + (node.vy ?? 0);
      const nodeHw = halfW(node);
      const nodeHh = halfH(node);
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
        // Prune cells entirely outside the interaction window: a box in this
        // cell reaches at most this cell's subtree-max half-extent beyond the
        // cell bounds, plus this node's own reach.
        const ext = quad as unknown as QuadExtents;
        const rx = nodeHw + ext.hw;
        const ry = nodeHh + ext.hh;
        return x0 > xi + rx || x1 < xi - rx || y0 > yi + ry || y1 < yi - ry;
      });
    }
  }

  force.initialize = (_nodes: N[]): void => {
    nodes = _nodes;
  };

  force.strength = function (value?: number): number | ForceLabelRect<N> {
    if (value === undefined) return strength;
    strength = value;
    return force as ForceLabelRect<N>;
  };

  force.iterations = function (value?: number): number | ForceLabelRect<N> {
    if (value === undefined) return iterations;
    iterations = value;
    return force as ForceLabelRect<N>;
  };

  return force as ForceLabelRect<N>;
}
