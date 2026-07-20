import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type ForceCenter,
} from 'd3-force';
import { forceLabelRect } from './forceLabelRect';
import { forceCrossGroupRepel } from './forceCrossGroupRepel';

/**
 * The folder-graph force model, with no dependency on the DOM, React, or d3
 * selections — so it can run identically on the main thread and inside
 * graphSimWorker.ts. FolderGraphView.tsx owns everything visual (colors, SVG
 * rendering, label measurement, drag/zoom behavior); this module owns the
 * physics and the shapes of the messages the two threads exchange.
 */

export interface SimNode extends SimulationNodeDatum {
  id: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  childCount: number;
  /** Cached hover preview text (file name + divider + first lines of body). */
  previewText?: string;
  /**
   * The file mtime (ms since epoch) the cached previewText was generated from.
   * If the file's current mtime is newer, the cache is stale and regenerated.
   */
  previewTimestamp?: number;
  /**
   * Label footprint box edges as offsets from the node center, populated when
   * USE_LABEL_PHYSICS is on and consumed by forceLabelRect. See RectCollideNode.
   */
  bx0?: number;
  by0?: number;
  bx1?: number;
  by1?: number;
  /**
   * Repulsion-group key: the parent folder path for files, the folder's own
   * path for folders. Same key = exempt from cross-group repulsion, so a file
   * and its own parent folder never repel. See CrossGroupNode.
   */
  crossRepelGroup?: string;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export const NODE_RADIUS_BASE = 5;

// Physics model for keeping nodes from colliding.
//   true  → rectangular collision on each node's circle + label footprint, so
//           file-name labels never overlap (labels stay glued to their circles
//           and whole nodes spread apart). See forceLabelRect.ts.
//   false → original circle-only collision (labels can overlap when circles are
//           close). Flip this one constant to revert to the previous physics.
export const USE_LABEL_PHYSICS: boolean = true;
// Breathing room (px) added around each label box before collisions are resolved.
export const LABEL_BOX_PADDING = 2;
// Label-collision resolution passes per tick. One pass at strength 0.7 leaves
// 30% of any overlap behind, which the repulsion forces (charge, crossRepel,
// fileFolderRepel, hubRepel) replenish each tick — visible as slight label
// overlap in crowded regions. Each extra pass cuts the residual by another
// 70% ((1-strength)^k overall), buying rigidity at linear cost.
const LABEL_COLLIDE_ITERATIONS = 3;

// Baseline repulsion between all nodes, and the range past which it's ignored
// (see the 'charge' force). Named so the cross-folder repulsion can match them.
const CHARGE_STRENGTH = -220;
const CHARGE_DISTANCE_MAX = 180;

// When true, files in *different* folders repel each other with an extra dose of
// charge equal to the baseline — so a cross-folder file pair feels double the
// repulsion of a same-folder pair, keeping the two folders' file clusters from
// intermingling and obscuring their connector lines. See forceCrossGroupRepel.ts.
// Flip to false to remove the effect (folders then rely on the baseline charge).
const USE_CROSS_FOLDER_REPULSION: boolean = true;
// Magnitude of the *extra* cross-folder repulsion. Equal to |CHARGE_STRENGTH|
// makes the total exactly double for cross-folder file pairs.
const CROSS_FOLDER_EXTRA_STRENGTH = 440; // try 220, 330, or 440

// Extra repulsion between a file and any folder that is NOT its parent, so
// files don't crowd up against neighboring folders' hubs. A file and its own
// parent share a repulsion-group key, which exempts that pair — the parent
// link stays the only attraction/spacing between them. Stronger than the
// file-vs-file extra above because folder hubs anchor whole clumps and need
// more clearance.
const USE_FILE_FOLDER_REPULSION: boolean = true;
const FILE_FOLDER_REPEL_STRENGTH = 500;

// Long-range repulsion between folder hubs. The baseline charge is capped at
// CHARGE_DISTANCE_MAX, so in graphs whose natural diameter exceeds that range
// nothing pushes separated subtrees apart and the layout compresses into one
// dense mat. This force restores cluster-scale separation: only folders emit
// it (files have zero strength here, keeping their charge local), but every
// node feels it, which is what carries whole clumps away from each other.
// Strength scales with direct child count so bigger clusters claim more room.
const USE_FOLDER_HUB_REPULSION: boolean = true;
const FOLDER_HUB_STRENGTH_BASE = -200;
const FOLDER_HUB_STRENGTH_PER_CHILD = -40;
// Most-negative strength a single hub can reach, so huge folders don't blast
// the rest of the graph off-screen.
const FOLDER_HUB_STRENGTH_MIN = -2200;
const FOLDER_HUB_DISTANCE_MAX = 1500;

// Link rest lengths. Folder→file links stay short so files hug their parent
// (tight clumps); folder→subfolder links are longer so hubs — and therefore
// the clumps around them — get structural spacing from each other.
const LINK_DISTANCE_FILE = 60;
const LINK_DISTANCE_FOLDER = 130;

// Radius step (px) between successive tree depths in the seeded initial layout.
// Matches the folder link rest length so the seed starts near link equilibrium.
const SEED_RADIAL_STEP = LINK_DISTANCE_FOLDER;

/** Returns the circle radius for a node — folders scale up with their child count. */
export function nodeRadius(d: SimNode): number {
  if (!d.isDirectory) return NODE_RADIUS_BASE;
  return NODE_RADIUS_BASE + Math.min(10, Math.sqrt(d.childCount));
}

/**
 * Per-pair strength for the merged cross-group force. Resolving both flavors
 * of supplementary repulsion here lets a single force instance — one quadtree
 * build and traversal per tick instead of two — serve both pair classes:
 *   file vs file in different folders → CROSS_FOLDER_EXTRA_STRENGTH
 *   file vs non-parent folder         → FILE_FOLDER_REPEL_STRENGTH
 *   folder vs folder                  → 0 (hub repulsion spaces those)
 * Symmetric in its arguments, as forceCrossGroupRepel requires.
 */
function crossGroupPairStrength(a: SimNode, b: SimNode): number {
  if (a.isDirectory !== b.isDirectory) {
    return USE_FILE_FOLDER_REPULSION ? FILE_FOLDER_REPEL_STRENGTH : 0;
  }
  if (!a.isDirectory && USE_CROSS_FOLDER_REPULSION) {
    return CROSS_FOLDER_EXTRA_STRENGTH;
  }
  return 0;
}

/**
 * Seeds initial node positions with a radial tree layout: the root at the
 * center, each depth ring SEED_RADIAL_STEP further out, and each subtree
 * confined to an angular sector sized by its node count. Without this, d3's
 * default phyllotaxis start packs all nodes into a tiny disc, which puts every
 * pair within the distance-capped repulsion forces' range for the first many
 * ticks (an O(n²) startup phase) and makes convergence slow; seeding starts
 * the layout near its equilibrium shape instead. Nodes unreachable from the
 * root (defensive — the scan emits a tree) are left for d3 to place.
 *
 * Must run before buildSimulation(), which assigns the packed phyllotaxis
 * default to any node still missing x/y. Links must still hold string
 * endpoints here — forceLink resolves them to node objects only once the
 * simulation is built.
 */
export function seedRadialPositions(nodes: SimNode[], links: SimLink[], cx: number, cy: number): void {
  const root = nodes.find(n => n.depth === 0);
  if (!root) return;
  const byId = new Map<string, SimNode>();
  for (const n of nodes) byId.set(n.id, n);
  const childrenOf = new Map<string, string[]>();
  for (const l of links) {
    const source = l.source as string;
    let arr = childrenOf.get(source);
    if (!arr) {
      arr = [];
      childrenOf.set(source, arr);
    }
    arr.push(l.target as string);
  }

  // Subtree node counts, used to weight each child's angular sector. The
  // visited set guards against cycles in malformed link data.
  const subtreeSize = new Map<string, number>();
  const visited = new Set<string>();
  const computeSize = (id: string): number => {
    if (visited.has(id)) return 0;
    visited.add(id);
    let size = 1;
    for (const c of childrenOf.get(id) ?? []) size += computeSize(c);
    subtreeSize.set(id, size);
    return size;
  };
  computeSize(root.id);

  const place = (id: string, depth: number, a0: number, a1: number): void => {
    const n = byId.get(id);
    if (n) {
      if (depth === 0) {
        n.x = cx;
        n.y = cy;
      } else {
        const a = (a0 + a1) / 2;
        const r = depth * SEED_RADIAL_STEP;
        n.x = cx + r * Math.cos(a);
        n.y = cy + r * Math.sin(a);
      }
    }
    const children = childrenOf.get(id) ?? [];
    let total = 0;
    for (const c of children) total += subtreeSize.get(c) ?? 0;
    if (total === 0) return;
    let start = a0;
    for (const c of children) {
      const size = subtreeSize.get(c) ?? 0;
      if (size === 0) continue; // cycle-guard skip in computeSize
      const end = start + ((a1 - a0) * size) / total;
      place(c, depth + 1, start, end);
      start = end;
    }
  };
  place(root.id, 0, 0, 2 * Math.PI);
}

/** A built simulation plus the one force the caller needs to retarget later. */
export interface BuiltSimulation {
  sim: Simulation<SimNode, SimLink>;
  /** Held out so a container resize can retarget the layout's center. */
  centerForce: ForceCenter<SimNode>;
}

/**
 * Assembles the layered force model over the given nodes and links. The
 * returned simulation is **stopped**: both callers drive it themselves — the
 * worker ticks it to convergence in a plain loop, and the main thread leaves
 * it idle until a drag restarts it. Note this mutates `links`, replacing their
 * string endpoints with node references (forceLink resolves ids on init).
 */
export function buildSimulation(
  nodes: SimNode[],
  links: SimLink[],
  width: number,
  height: number,
): BuiltSimulation {
  const centerForce = forceCenter<SimNode>(width / 2, height / 2);

  const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(nodes)
    .force('link', forceLink<SimNode, SimLink>(links)
      .id(d => d.id)
      // Source/target are resolved to nodes before this accessor runs.
      .distance(l => (l.target as SimNode).isDirectory ? LINK_DISTANCE_FOLDER : LINK_DISTANCE_FILE)
      .strength(0.7))
    // distanceMax caps the repulsion's range. Without it, every node repels
    // every other regardless of distance, so the summed push between two
    // separated subtrees stretches the single link bridging them (most
    // visibly the root's links) far past its target length. Limiting charge
    // to a local radius keeps the per-node repulsion from inflating the whole
    // layout; cluster-scale spacing is the hub force's job (below).
    .force('charge', forceManyBody<SimNode>().strength(CHARGE_STRENGTH).distanceMax(CHARGE_DISTANCE_MAX))
    // Folder hubs repel at long range so separated subtrees become distinct
    // clumps instead of compressing into one mat once the graph outgrows
    // CHARGE_DISTANCE_MAX. Only folders emit (few of them, so root links
    // don't get the runaway stretch that uncapped all-pairs charge caused).
    .force('hubRepel', USE_FOLDER_HUB_REPULSION
      ? forceManyBody<SimNode>()
          .strength(d => d.isDirectory
            ? Math.max(
                FOLDER_HUB_STRENGTH_MIN,
                FOLDER_HUB_STRENGTH_BASE + FOLDER_HUB_STRENGTH_PER_CHILD * d.childCount,
              )
            : 0)
          .distanceMax(FOLDER_HUB_DISTANCE_MAX)
      : null)
    // Extra repulsion between cross-group pairs — cross-folder file pairs and
    // file-vs-non-parent-folder pairs (the shared group key exempts a file's
    // own parent) — layered on top of the baseline charge above and capped at
    // the same range so the boost stays local. One merged force serves both
    // pair classes at their respective strengths; see crossGroupPairStrength.
    .force('crossRepel', (USE_CROSS_FOLDER_REPULSION || USE_FILE_FOLDER_REPULSION)
      ? forceCrossGroupRepel<SimNode>()
          .strength(crossGroupPairStrength)
          .distanceMax(CHARGE_DISTANCE_MAX)
      : null)
    .force('center', centerForce)
    .force('collide', USE_LABEL_PHYSICS
      ? forceLabelRect<SimNode>().strength(0.7).iterations(LABEL_COLLIDE_ITERATIONS)
      : forceCollide<SimNode>().radius(d => nodeRadius(d) + 4));

  // forceSimulation() auto-starts an internal timer driving ticks off
  // requestAnimationFrame. Neither caller wants that, and in a worker there is
  // no rAF to drive it at all.
  sim.stop();

  return { sim, centerForce };
}

/**
 * The exact number of ticks d3's internal timer would run to take alpha from
 * its initial value down to alphaMin — i.e. a full settle.
 */
export function settleTickCount(sim: Simulation<SimNode, SimLink>): number {
  return Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
}

/** Floats posted back per node in a SettleResponse: x, y, vx, vy. */
export const FLOATS_PER_NODE = 4;

/**
 * The node fields the worker needs to compute a layout. Deliberately narrower
 * than SimNode: the hover-preview cache is main-thread-only state, and sending
 * it would copy every previewed file's text across the boundary for nothing.
 */
export type SettleNode = Omit<SimNode, 'previewText' | 'previewTimestamp'>;

/** Main thread → worker: lay out this graph. */
export interface SettleRequest {
  nodes: SettleNode[];
  /** String endpoints; the worker's forceLink resolves them to its own nodes. */
  links: { source: string; target: string }[];
  width: number;
  height: number;
}

/** Worker → main thread: the settled layout. */
export interface SettleResponse {
  /**
   * Packed [x, y, vx, vy] per node, in the same order as the request's nodes.
   * A transferable buffer rather than an object array so handing back a large
   * layout is a pointer move instead of a structured clone.
   */
  positions: Float64Array;
}
