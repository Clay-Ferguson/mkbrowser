import { useEffect, useRef, useState } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { drag as d3drag, type D3DragEvent } from 'd3-drag';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { api } from '../../renderer/api';
import 'd3-transition';
import { forceLabelRect } from './forceLabelRect';
import { forceCrossGroupRepel } from './forceCrossGroupRepel';
import {
  useFolderGraph,
  useHighlightItem,
  navigateToBrowserPath,
  setHighlightItem,
} from '../../store';
import { parseFrontMatter } from '../../shared/frontMatterUtil';
import { getParentPath } from '../../renderer/pathUtil';

interface SimNode extends SimulationNodeDatum {
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

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

const NODE_RADIUS_BASE = 5;

// Physics model for keeping nodes from colliding.
//   true  → rectangular collision on each node's circle + label footprint, so
//           file-name labels never overlap (labels stay glued to their circles
//           and whole nodes spread apart). See forceLabelRect.ts.
//   false → original circle-only collision (labels can overlap when circles are
//           close). Flip this one constant to revert to the previous physics.
const USE_LABEL_PHYSICS = true;
// Breathing room (px) added around each label box before collisions are resolved.
const LABEL_BOX_PADDING = 2;
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
const USE_CROSS_FOLDER_REPULSION = true;
// Magnitude of the *extra* cross-folder repulsion. Equal to |CHARGE_STRENGTH|
// makes the total exactly double for cross-folder file pairs.
const CROSS_FOLDER_EXTRA_STRENGTH = 440; // try 220, 330, or 440

// Extra repulsion between a file and any folder that is NOT its parent, so
// files don't crowd up against neighboring folders' hubs. A file and its own
// parent share a repulsion-group key, which exempts that pair — the parent
// link stays the only attraction/spacing between them. Stronger than the
// file-vs-file extra above because folder hubs anchor whole clumps and need
// more clearance.
const USE_FILE_FOLDER_REPULSION = true;
const FILE_FOLDER_REPEL_STRENGTH = 500;

// Long-range repulsion between folder hubs. The baseline charge is capped at
// CHARGE_DISTANCE_MAX, so in graphs whose natural diameter exceeds that range
// nothing pushes separated subtrees apart and the layout compresses into one
// dense mat. This force restores cluster-scale separation: only folders emit
// it (files have zero strength here, keeping their charge local), but every
// node feels it, which is what carries whole clumps away from each other.
// Strength scales with direct child count so bigger clusters claim more room.
const USE_FOLDER_HUB_REPULSION = true;
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

// Node colors by type, tuned for a dark slate-900 background.
const COLOR_ROOT = '#ef4444';     // bright red
const COLOR_FOLDER = '#fb923c';   // orange
const COLOR_MARKDOWN = '#60a5fa'; // blue
const COLOR_OTHER = '#cbd5e1';    // light gray
const COLOR_HIGHLIGHT = '#a855f7'; // purple
const COLOR_CONTAINS = '#22c55e'; // green — shown on a folder's children while hovering it
const COLOR_PATH = '#ef4444';     // red — links from a hovered node up to the root

/** Returns the fill color for a graph node based on its type and highlight state. */
function colorForNode(d: SimNode, highlighted: boolean): string {
  if (highlighted) return COLOR_HIGHLIGHT;
  if (d.depth === 0) return COLOR_ROOT;
  if (d.isDirectory) return COLOR_FOLDER;
  const lower = d.name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return COLOR_MARKDOWN;
  return COLOR_OTHER;
}

/** Returns the circle radius for a node — folders scale up with their child count. */
function nodeRadius(d: SimNode): number {
  if (!d.isDirectory) return NODE_RADIUS_BASE;
  return NODE_RADIUS_BASE + Math.min(10, Math.sqrt(d.childCount));
}

const PREVIEW_MAX_CHARS = 500;
// U+2500 (box drawings light horizontal) renders as a continuous, gapless rule,
// so a run of them reads like an underline beneath the file name.
const PREVIEW_DIVIDER_CHAR = '─';

/**
 * Builds the hover-tooltip preview for a file: its name on the first line, an
 * underline matching the name's length, then the first five non-blank lines of
 * the body (front matter stripped), capped at PREVIEW_MAX_CHARS.
 */
async function getFilePreview(filePath: string, name: string): Promise<string> {
  const raw = await api.readFile(filePath);
  const { content } = parseFrontMatter(raw);
  const allLines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const lines = allLines.slice(0, 5);
  let preview = lines.join('\n');

  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS) + '…';
  }

  // Indicate, on its own line, that the file has more lines than we're showing.
  if (allLines.length > lines.length) {
    preview += '\n…';
  }
  const divider = PREVIEW_DIVIDER_CHAR.repeat(name.length);
  return `${name}\n${divider}\n${preview}`;
}

/**
 * Interactive D3 force-directed graph of a folder tree. Nodes represent files
 * and folders; links represent parent-child containment. Supports drag-to-reposition,
 * scroll-to-zoom, click-to-navigate, and hover highlighting (green for a folder's
 * direct children, red for the hovered node's ancestor path to root). File nodes
 * show a lazily-loaded content preview in the native SVG tooltip. The simulation
 * uses several layered repulsion forces (cross-folder, file-vs-non-parent-folder,
 * folder-hub long-range) to keep clusters visually separated; see the module-level
 * constants for tuning knobs.
 */
function FolderGraphView() {
  const folderGraph = useFolderGraph();
  const highlightItem = useHighlightItem();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const highlightRef = useRef<string | null>(highlightItem);
  useEffect(() => {
    highlightRef.current = highlightItem;
  });
  const [ready, setReady] = useState(false);

  // Wait for container to be measured before building the simulation.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setReady(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container || !folderGraph || !ready) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const { nodes: rawNodes, links: rawLinks } = folderGraph;

    // Compute child counts so folder size can scale with subtree breadth.
    const childCount = new Map<string, number>();
    for (const l of rawLinks) {
      childCount.set(l.source, (childCount.get(l.source) ?? 0) + 1);
    }

    // d3-force mutates its inputs — copy so the store data stays clean.
    const simNodes: SimNode[] = rawNodes.map(n => ({
      id: n.id,
      name: n.name,
      isDirectory: n.isDirectory,
      depth: n.depth,
      childCount: childCount.get(n.id) ?? 0,
      // Files are grouped by their parent folder, folders by their own path —
      // so cross-folder file pairs and file-vs-non-parent-folder pairs differ
      // in group (extra repulsion applies), while a file and its own parent
      // match (exempt). Consumed by the crossRepel/fileFolderRepel forces.
      crossRepelGroup: n.isDirectory ? n.id : getParentPath(n.id),
    }));
    const simLinks: SimLink[] = rawLinks.map(l => ({ source: l.source, target: l.target }));

    // For the "hover a folder to see what it contains" behavior: map each folder
    // id to the set of its direct children (file or folder ids), so hovering can
    // paint those children — and the links reaching them — green.
    const childIdsByFolder = new Map<string, Set<string>>();
    // And map each child id to its parent id, so a hovered node's path up to the
    // root can be traced by walking parent links.
    const parentByChild = new Map<string, string>();
    for (const l of rawLinks) {
      let set = childIdsByFolder.get(l.source);
      if (!set) {
        set = new Set<string>();
        childIdsByFolder.set(l.source, set);
      }
      set.add(l.target);
      parentByChild.set(l.target, l.source);
    }

    const root = select(svg);
    root.selectAll('*').remove();

    const zoomLayer = root.append('g').attr('class', 'zoom-layer');

    const linkSel = zoomLayer.append('g')
      .attr('class', 'links')
      .attr('stroke', '#475569')
      .attr('stroke-opacity', 0.7)
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke-width', 1);

    const nodeSel = zoomLayer.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .style('cursor', 'pointer');

    const circleSel = nodeSel.append('circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => colorForNode(d, highlightRef.current === d.id))
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1.5);

    // Native SVG tooltip with the full path on hover.
    nodeSel.append('title').text(d => d.id);

    // Label: paint-order=stroke gives a dark outline so text reads against
    // any background (graph edges, other nodes).
    const labelSel = nodeSel.append('text')
      .attr('x', d => nodeRadius(d) + 4)
      .attr('y', '0.32em')
      .attr('font-size', 11)
      .attr('fill', d => colorForNode(d, highlightRef.current === d.id))
      .attr('font-weight', d => highlightRef.current === d.id ? 'bold' : 'normal')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.75)
      .text(d => d.name);

    // Measure each label so forceLabelRect can treat the circle + its text as a
    // single rectangular footprint. getBBox gives exact metrics for the rendered
    // text (the SVG is laid out by now — this effect only runs once `ready`);
    // we fall back to a character-count estimate if it's unavailable.
    if (USE_LABEL_PHYSICS) {
      nodeSel.select<SVGTextElement>('text').each(function (d) {
        const r = nodeRadius(d);
        let tx = r + 4;
        let ty = -6;
        let tw = d.name.length * 6.2;
        let th = 12;
        try {
          const bb = this.getBBox();
          if (bb.width > 0) {
            tx = bb.x;
            ty = bb.y;
            tw = bb.width;
            th = bb.height;
          }
        } catch {
          // Keep the estimate.
        }
        d.bx0 = -r - LABEL_BOX_PADDING;
        d.bx1 = tx + tw + LABEL_BOX_PADDING;
        d.by0 = Math.min(-r, ty) - LABEL_BOX_PADDING;
        d.by1 = Math.max(r, ty + th) + LABEL_BOX_PADDING;
      });
    }

    const applyHighlight = (): void => {
      const hl = highlightRef.current;
      circleSel.attr('fill', d => colorForNode(d, hl === d.id));
      // Highlighted label: purple and bold so it's easy to spot.
      labelSel
        .attr('fill', d => colorForNode(d, hl === d.id))
        .attr('font-weight', d => hl === d.id ? 'bold' : 'normal');
    };
    (svg as SVGSVGElement & { __applyHighlight?: () => void }).__applyHighlight = applyHighlight;

    // Click → navigate. d3-drag's clickDistance(4) suppresses the click event
    // when the gesture was actually a drag, so we don't need a manual guard.
    nodeSel.on('click', (_event, d) => {
      setHighlightItem(d.id);
      // Update the purple border immediately so it's visible on return,
      // since navigation below may unmount this view before the
      // highlight-watching effect would otherwise run.
      highlightRef.current = d.id;
      applyHighlight();
      if (d.isDirectory) {
        navigateToBrowserPath(d.id);
      } else {
        const parent = getParentPath(d.id);
        navigateToBrowserPath(parent, d.id);
      }
    });

    // Hover → load a content preview into the tooltip. The native <title>
    // starts as the full path; once the file is read we swap in a richer
    // preview (name + first body lines). We mutate the live <title> DOM node
    // directly so it updates without rebuilding the graph, and cache the
    // result on the SimNode keyed by file mtime so editing a file and coming
    // back regenerates the preview, while repeat hovers reuse the cache.
    nodeSel.on('mouseenter', (event: MouseEvent, d) => {
      if (d.isDirectory) return; // only files have content to preview
      const ext = d.name.slice(d.name.lastIndexOf('.')).toLowerCase();
      if (ext !== '.md' && ext !== '.txt') return; // only preview markdown/text files
      const titleSel = select(event.currentTarget as SVGGElement).select<SVGTitleElement>('title');
      void (async () => {
        try {
          const mtime = await api.getFileMtime(d.id);
          if (d.previewText !== undefined && d.previewTimestamp !== undefined && mtime <= d.previewTimestamp) {
            titleSel.text(d.previewText);
            return;
          }
          const preview = await getFilePreview(d.id, d.name);
          d.previewText = preview;
          d.previewTimestamp = mtime;
          titleSel.text(preview);
        } catch {
          // On any read/stat error, leave the default path tooltip in place.
        }
      })();
    });

    // Hover highlighting, driven by the node under the cursor (null clears it):
    //  • Green: a hovered *folder*'s direct children, and the links reaching them,
    //    so the user can confirm at a glance what that folder contains.
    //  • Red: the chain of links from the hovered node (file or folder) up through
    //    each ancestor folder to the root, tracing its full path.
    const idOf = (end: string | SimNode): string => typeof end === 'string' ? end : end.id;
    const linkKey = (parent: string, child: string): string => `${parent} ${child}`;
    const applyHoverHighlight = (hovered: SimNode | null): void => {
      // Children to paint green (only when hovering a folder).
      const children = hovered?.isDirectory
        ? childIdsByFolder.get(hovered.id) ?? new Set<string>()
        : null;
      // Links along the path to root to paint red, plus the nodes on that path
      // (the hovered node and each ancestor) whose labels also turn red.
      const redLinks = new Set<string>();
      const redNodes = new Set<string>();
      if (hovered) {
        redNodes.add(hovered.id);
        let cur = hovered.id;
        let parent = parentByChild.get(cur);
        while (parent !== undefined) {
          redLinks.add(linkKey(parent, cur));
          redNodes.add(parent);
          cur = parent;
          parent = parentByChild.get(cur);
        }
      }
      const isGreen = (d: SimNode): boolean => children !== null && children.has(d.id);
      const hl = highlightRef.current;
      circleSel.attr('fill', d => isGreen(d) ? COLOR_CONTAINS : colorForNode(d, hl === d.id));
      labelSel
        .attr('fill', d =>
          redNodes.has(d.id) ? COLOR_PATH : isGreen(d) ? COLOR_CONTAINS : colorForNode(d, hl === d.id))
        .attr('font-weight', d => (redNodes.has(d.id) || isGreen(d) || hl === d.id) ? 'bold' : 'normal');
      const linkColor = (d: SimLink): string | null => {
        const s = idOf(d.source);
        const t = idOf(d.target);
        if (redLinks.has(linkKey(s, t))) return COLOR_PATH;
        if (children !== null && s === (hovered as SimNode).id && children.has(t)) return COLOR_CONTAINS;
        return null;
      };
      linkSel
        .attr('stroke', d => linkColor(d) ?? '#475569')
        .attr('stroke-opacity', d => linkColor(d) !== null ? 1 : 0.7);
    };

    nodeSel.on('mouseenter.contains', (_event: MouseEvent, d) => applyHoverHighlight(d));
    nodeSel.on('mouseleave.contains', () => applyHoverHighlight(null));

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks)
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
      // Extra repulsion between files in different folders (layered on top of the
      // baseline charge above), capped at the same range so the doubling stays
      // local. The filter keeps this force to file-file pairs; file-folder pairs
      // get their own strength below.
      .force('crossRepel', USE_CROSS_FOLDER_REPULSION
        ? forceCrossGroupRepel<SimNode>()
            .strength(CROSS_FOLDER_EXTRA_STRENGTH)
            .distanceMax(CHARGE_DISTANCE_MAX)
            .filter((a, b) => !a.isDirectory && !b.isDirectory)
        : null)
      // Extra repulsion between a file and any non-parent folder (the shared
      // group key exempts the parent), so files keep their distance from
      // neighboring folders' hubs instead of crowding against them.
      .force('fileFolderRepel', USE_FILE_FOLDER_REPULSION
        ? forceCrossGroupRepel<SimNode>()
            .strength(FILE_FOLDER_REPEL_STRENGTH)
            .distanceMax(CHARGE_DISTANCE_MAX)
            .filter((a, b) => a.isDirectory !== b.isDirectory)
        : null)
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', USE_LABEL_PHYSICS
        ? forceLabelRect<SimNode>().strength(0.7).iterations(LABEL_COLLIDE_ITERATIONS)
        : forceCollide<SimNode>().radius(d => nodeRadius(d) + 4));

    const tick = () => {
      linkSel
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0);
      nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };
    sim.on('tick', tick);

    // d3-zoom on the root SVG. Transform applied to the inner zoomLayer <g>.
    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomLayer.attr('transform', event.transform.toString());
      });
    root.call(zoomBehavior);

    /**
     * Computes the bounding box of all settled nodes and applies a zoom transform
     * that fits the entire graph within the container with padding. Pass
     * `animate: true` for a smooth transition (used once on initial settle),
     * or `false` for an instant snap.
     */
    function zoomToFit(animate: boolean): void {
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const n of simNodes) {
        if (n.x === undefined || n.y === undefined) continue;
        if (n.x < xMin) xMin = n.x;
        if (n.x > xMax) xMax = n.x;
        if (n.y < yMin) yMin = n.y;
        if (n.y > yMax) yMax = n.y;
      }
      if (!isFinite(xMin)) return;
      const pad = 60;
      const dx = (xMax - xMin) + pad * 2;
      const dy = (yMax - yMin) + pad * 2;
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;
      const k = Math.min(2, Math.min(width / dx, height / dy));
      const tx = width / 2 - cx * k;
      const ty = height / 2 - cy * k;
      const t = zoomIdentity.translate(tx, ty).scale(k);
      if (animate) {
        root.transition().duration(600).call(zoomBehavior.transform, t);
      } else {
        root.call(zoomBehavior.transform, t);
      }
    }

    // Drag: standard d3-force pattern. Pin during drag (so the node follows
    // the cursor exactly), release on drop so the system equilibrates and the
    // user feels the physics respond.
    const dragBehavior = d3drag<SVGGElement, SimNode>()
      .clickDistance(4)
      .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = undefined;
        d.fy = undefined;
      });
    nodeSel.call(dragBehavior);

    // Zoom-to-fit when the simulation first settles. Subsequent settles
    // (after a drag) shouldn't re-zoom — that would be jarring — so guard
    // with a one-shot flag.
    let didInitialFit = false;
    sim.on('end', () => {
      if (didInitialFit) return;
      didInitialFit = true;
      zoomToFit(true);
    });

    return () => {
      sim.stop();
      sim.on('tick', null);
      sim.on('end', null);
      root.on('.zoom', null);
    };
  }, [folderGraph, ready]);

  useEffect(() => {
    const svg = svgRef.current as (SVGSVGElement & { __applyHighlight?: () => void }) | null;
    svg?.__applyHighlight?.();
  }, [highlightItem]);

  if (!folderGraph) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">No folder graph data. Run it from Tools &gt; Folder Graph.</p>
      </div>
    );
  }

  const folderCount = folderGraph.nodes.filter(n => n.isDirectory).length;
  const fileCount = folderGraph.nodes.length - folderCount;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-900">
      <header className="flex-shrink-0 px-4 py-2 border-b border-slate-700 flex items-center gap-3">
        <div className="flex-1 text-sm text-slate-300 truncate" title={folderGraph.folderPath}>
          <span className="font-mono text-slate-200">{folderGraph.folderPath}</span>
          {folderGraph.foldersOnly && (
            <span className="ml-3 px-2 py-0.5 rounded-full border border-yellow-400 text-yellow-300 font-bold text-xs">
              Folders Only, too many files
            </span>
          )}
          <span className="text-slate-500 ml-3">
            {folderGraph.nodes.length} nodes ({folderCount} folders, {fileCount} files)
            {' · '}
            {folderGraph.links.length} links
          </span>
          {folderGraph.truncated && (
            <span className="text-amber-400 ml-3">truncated — node cap reached</span>
          )}
          <span className="text-slate-500 ml-3">drag nodes · scroll to zoom · click to open</span>
        </div>
      </header>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <svg ref={svgRef} className="absolute inset-0 w-full h-full block" />
      </div>
    </div>
  );
}

export default FolderGraphView;
