import { quadtree, type QuadtreeLeaf } from 'd3-quadtree';
import type { SimulationNodeDatum } from 'd3-force';

/**
 * A node that may belong to a repulsion group. Two nodes with *different*
 * defined groups receive extra repulsion from this force; nodes with an
 * undefined group do not participate at all (so e.g. folder nodes can opt out
 * by leaving it undefined, leaving only file-vs-file pairs to interact).
 */
export interface CrossGroupNode extends SimulationNodeDatum {
  crossRepelGroup?: string;
}

export interface ForceCrossGroupRepel<N extends CrossGroupNode> {
  (alpha: number): void;
  initialize(nodes: N[], random?: () => number): void;
  strength(): number;
  strength(value: number): ForceCrossGroupRepel<N>;
  distanceMax(): number;
  distanceMax(value: number): ForceCrossGroupRepel<N>;
  filter(): (a: N, b: N) => boolean;
  filter(value: (a: N, b: N) => boolean): ForceCrossGroupRepel<N>;
}

/**
 * Supplementary repulsion applied only between nodes whose `crossRepelGroup`
 * differs — intended to push files that live in *different* folders apart so
 * the two folders' file clusters don't intermingle and obscure their connector
 * lines. Files in the same folder are left to the simulation's baseline charge.
 *
 * It mirrors `forceManyBody`'s force law (acceleration ∝ strength·alpha / dist²,
 * scaled by alpha so it cools with the simulation), so layering this on top of a
 * `forceManyBody` of equal magnitude makes a cross-group pair feel exactly twice
 * the repulsion of a same-group pair. `strength` here is a positive magnitude
 * (the amount of *extra* repulsion). `distanceMax` caps the interaction range —
 * match it to the baseline charge's distanceMax so the doubling stays local and
 * doesn't reintroduce long-range cluster drift. A quadtree prunes the search to
 * that range, so the cost is local rather than O(n²).
 *
 * `filter` further restricts which cross-group pairs interact (e.g. only
 * file-vs-folder pairs), letting several instances of this force coexist with
 * different strengths without double-applying to the same pair.
 */
export function forceCrossGroupRepel<N extends CrossGroupNode>(): ForceCrossGroupRepel<N> {
  let nodes: N[] = [];
  let strength = 220;
  let maxDist = Infinity;
  let filter: (a: N, b: N) => boolean = () => true;

  function force(alpha: number): void {
    const maxSq = maxDist * maxDist;
    const tree = quadtree(
      nodes,
      d => d.x ?? 0,
      d => d.y ?? 0,
    );
    for (const node of nodes) {
      const group = node.crossRepelGroup;
      if (group === undefined) continue;
      const xi = node.x ?? 0;
      const yi = node.y ?? 0;
      tree.visit((quad, x0, y0, x1, y1) => {
        if (!Array.isArray(quad)) {
          // Leaf: walk its coincident-point list. Resolve each pair once, when
          // handling the lower-indexed node, applying the push to both.
          let leaf: QuadtreeLeaf<N> | undefined = quad;
          do {
            const other = leaf.data;
            const otherGroup = other.crossRepelGroup;
            if (
              otherGroup !== undefined &&
              otherGroup !== group &&
              (other.index ?? 0) > (node.index ?? 0) &&
              filter(node, other)
            ) {
              const dx = (other.x ?? 0) - xi;
              const dy = (other.y ?? 0) - yi;
              const l = dx * dx + dy * dy;
              if (l > 0 && l <= maxSq) {
                const w = (strength * alpha) / l;
                node.vx = (node.vx ?? 0) - dx * w;
                node.vy = (node.vy ?? 0) - dy * w;
                other.vx = (other.vx ?? 0) + dx * w;
                other.vy = (other.vy ?? 0) + dy * w;
              }
            }
          } while ((leaf = leaf.next));
        }
        // Prune quads entirely outside this node's interaction range.
        return x0 > xi + maxDist || x1 < xi - maxDist || y0 > yi + maxDist || y1 < yi - maxDist;
      });
    }
  }

  force.initialize = (_nodes: N[]): void => {
    nodes = _nodes;
  };

  force.strength = function (value?: number): number | ForceCrossGroupRepel<N> {
    if (value === undefined) return strength;
    strength = value;
    return force as ForceCrossGroupRepel<N>;
  };

  force.distanceMax = function (value?: number): number | ForceCrossGroupRepel<N> {
    if (value === undefined) return maxDist;
    maxDist = value;
    return force as ForceCrossGroupRepel<N>;
  };

  force.filter = function (value?: (a: N, b: N) => boolean): ((a: N, b: N) => boolean) | ForceCrossGroupRepel<N> {
    if (value === undefined) return filter;
    filter = value;
    return force as ForceCrossGroupRepel<N>;
  };

  return force as ForceCrossGroupRepel<N>;
}
