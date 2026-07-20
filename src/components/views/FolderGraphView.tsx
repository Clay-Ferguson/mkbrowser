import { useEffect, useRef, useState } from 'react';
import type { Simulation, ForceCenter } from 'd3-force';
import { select } from 'd3-selection';
import { drag as d3drag, type D3DragEvent } from 'd3-drag';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { api } from '../../renderer/api';
import 'd3-transition';
import {
  buildSimulation,
  nodeRadius,
  USE_LABEL_PHYSICS,
  LABEL_BOX_PADDING,
  FLOATS_PER_NODE,
  type SimNode,
  type SimLink,
  type SettleRequest,
  type SettleResponse,
} from './graphSim';
import {
  useAS,
  navigateToBrowserPath,
  setHighlightItem,
} from '../../store';
import { parseFrontMatter } from '../../shared/frontMatterUtil';
import { getParentPath } from '../../renderer/pathUtil';
import { logger } from '../../shared/logUtil';

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
  const readResult = await api.readFile(filePath);
  // On a failed read, fall back to an empty body so the tooltip still shows the
  // file name (with an empty preview) rather than throwing.
  const raw = readResult.ok ? readResult.content : '';
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
 * Loads (or reuses) a file node's hover preview and applies it via `setTitle`.
 * The result is cached on the SimNode keyed by file mtime, so editing a file
 * and coming back regenerates the preview while repeat hovers reuse the cache.
 * On any read/stat error the default path tooltip is left in place. Module-level
 * (not compiled by the React Compiler): the conditionals inside try/catch would
 * make the compiler bail out on the whole component.
 */
async function loadPreviewIntoTooltip(d: SimNode, setTitle: (text: string) => void): Promise<void> {
  try {
    const mtime = await api.getFileMtime(d.id);
    if (d.previewText !== undefined && d.previewTimestamp !== undefined && mtime <= d.previewTimestamp) {
      setTitle(d.previewText);
      return;
    }
    const preview = await getFilePreview(d.id, d.name);
    d.previewText = preview;
    d.previewTimestamp = mtime;
    setTitle(preview);
  } catch {
    // On any read/stat error, leave the default path tooltip in place.
  }
}

/**
 * d3 `.each` callback that measures a node's rendered label and stores the
 * combined circle+label footprint box on the datum, for forceLabelRect.
 * getBBox gives exact metrics for the rendered text; we fall back to a
 * character-count estimate if it's unavailable. Module-level (not compiled by
 * the React Compiler): the `this` binding d3 uses would make the compiler bail
 * out on the whole component.
 *
 * This is the only part of the force model that needs a document, which is why
 * it runs here and ships its four numbers to the layout worker rather than the
 * worker needing any DOM of its own.
 */
function measureLabelFootprint(this: SVGTextElement, d: SimNode): void {
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
}

/**
 * Copies a worker-settled layout (packed [x, y, vx, vy] per node) back onto the
 * node objects the SVG selections are bound to. Module-level (not compiled by
 * the React Compiler): the running offset counter is a mutation the compiler
 * would bail on inside the component.
 */
function applySettledPositions(nodes: SimNode[], positions: Float64Array): void {
  let offset = 0;
  for (const n of nodes) {
    n.x = positions[offset] ?? 0;
    n.y = positions[offset + 1] ?? 0;
    n.vx = positions[offset + 2] ?? 0;
    n.vy = positions[offset + 3] ?? 0;
    offset += FLOATS_PER_NODE;
  }
}

/**
 * Interactive D3 force-directed graph of a folder tree. Nodes represent files
 * and folders; links represent parent-child containment. Supports drag-to-reposition,
 * scroll-to-zoom, click-to-navigate, and hover highlighting (green for a folder's
 * direct children, red for the hovered node's ancestor path to root). File nodes
 * show a lazily-loaded content preview in the native SVG tooltip.
 *
 * The layout itself lives in graphSim.ts and is computed in graphSimWorker.ts:
 * this component renders the graph, measures label footprints, ships the whole
 * settle to the worker, and takes ownership of the result for drag interaction.
 * See the constants in graphSim.ts for the physics tuning knobs.
 */
function FolderGraphView() {
  const folderGraph = useAS(s => s.folderGraph);
  const highlightItem = useAS(s => s.highlightItem);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const highlightRef = useRef<string | null>(highlightItem);
  // Written by the graph effect, called by the highlight effect below: repaints
  // the existing selections instead of rebuilding the graph. Null whenever no
  // graph is built.
  const applyHighlightRef = useRef<(() => void) | null>(null);
  // Same pattern: written by the graph effect, called by the ResizeObserver so
  // a container resize re-frames the existing graph rather than rebuilding it.
  const resizeGraphRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    highlightRef.current = highlightItem;
  });
  const [ready, setReady] = useState(false);
  // True while the layout worker is computing the layout: the SVG is hidden
  // (visibility, not display — label measurement needs layout) and a centered
  // wait spinner shows in its place.
  const [settling, setSettling] = useState(false);

  // Wait for container to be measured before building the simulation.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      setReady(true);
      // No-op until the graph effect has built a graph to re-frame.
      resizeGraphRef.current?.();
    });
    ro.observe(el);
    // Returns the useEffect cleanup (an unsubscribe): disconnects the ResizeObserver on unmount.
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
      // match (exempt). Consumed by the merged crossRepel force.
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
    // single rectangular footprint (the SVG is laid out by now — this effect
    // only runs once `ready`). Must happen before the worker request below,
    // which ships these measurements as plain numbers.
    if (USE_LABEL_PHYSICS) {
      nodeSel.select<SVGTextElement>('text').each(measureLabelFootprint);
    }

    const applyHighlight = (): void => {
      const hl = highlightRef.current;
      circleSel.attr('fill', d => colorForNode(d, hl === d.id));
      // Highlighted label: purple and bold so it's easy to spot.
      labelSel
        .attr('fill', d => colorForNode(d, hl === d.id))
        .attr('font-weight', d => hl === d.id ? 'bold' : 'normal');
    };
    applyHighlightRef.current = applyHighlight;

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
    // directly so it updates without rebuilding the graph (see
    // loadPreviewIntoTooltip for the mtime-keyed caching).
    nodeSel.on('mouseenter', (event: MouseEvent, d) => {
      if (d.isDirectory) return; // only files have content to preview
      const ext = d.name.slice(d.name.lastIndexOf('.')).toLowerCase();
      if (ext !== '.md' && ext !== '.txt') return; // only preview markdown/text files
      const titleSel = select(event.currentTarget as SVGGElement).select<SVGTitleElement>('title');
      void loadPreviewIntoTooltip(d, (text) => {
        titleSel.text(text);
      });
    });

    // Hover highlighting, driven by the node under the cursor (null clears it):
    //  • Green: a hovered *folder*'s direct children, and the links reaching them,
    //    so the user can confirm at a glance what that folder contains.
    //  • Red: the chain of links from the hovered node (file or folder) up through
    //    each ancestor folder to the root, tracing its full path.
    const idOf = (end: string | SimNode): string => typeof end === 'string' ? end : end.id;
    const linkKey = (parent: string, child: string): string => `${parent} ${child}`;
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

    // Syncs the DOM to current node positions. Only meaningful once a
    // simulation exists on this thread and has resolved the links' string
    // endpoints to node objects.
    const tick = () => {
      linkSel
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0);
      nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };

    // Set once the user zooms/pans by hand, which makes the viewport theirs: a
    // later resize then preserves their transform instead of re-fitting over it.
    // d3 populates sourceEvent only for user gestures — programmatic transforms
    // (the initial fit, the resize re-fit) leave it null and don't trip this.
    let userAdjustedView = false;

    // d3-zoom on the root SVG. Transform applied to the inner zoomLayer <g>.
    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomLayer.attr('transform', event.transform.toString());
        if (event.sourceEvent) userAdjustedView = true;
      });
    root.call(zoomBehavior);

    /**
     * Computes the bounding box of all settled nodes and applies a zoom transform
     * that fits the entire graph within the container with padding. Pass
     * `animate: true` for a smooth transition (used once on initial settle),
     * or `false` for an instant snap. The container box is read live rather than
     * captured at build time, so a fit that lands after a resize uses the box
     * the user is actually looking at.
     */
    const zoomToFit = (animate: boolean): void => {
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const n of simNodes) {
        if (n.x === undefined || n.y === undefined) continue;
        if (n.x < xMin) xMin = n.x;
        if (n.x > xMax) xMax = n.x;
        if (n.y < yMin) yMin = n.y;
        if (n.y > yMax) yMax = n.y;
      }
      if (!isFinite(xMin)) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      const pad = 60;
      const dx = (xMax - xMin) + pad * 2;
      const dy = (yMax - yMin) + pad * 2;
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;
      const k = Math.min(2, Math.min(w / dx, h / dy));
      const tx = w / 2 - cx * k;
      const ty = h / 2 - cy * k;
      const t = zoomIdentity.translate(tx, ty).scale(k);
      if (animate) {
        root.transition().duration(600).call(zoomBehavior.transform, t);
      } else {
        root.call(zoomBehavior.transform, t);
      }
    };

    // The main thread's copy of the simulation, created only once the worker
    // hands back a settled layout. It exists purely so drags feel live: it is
    // seeded with the worker's result and left cold at alpha 0 until a drag
    // wakes it. Null (with nothing draggable) for the whole settle.
    let sim: Simulation<SimNode, SimLink> | null = null;
    let centerForce: ForceCenter<SimNode> | null = null;
    let isSettling = true;
    setSettling(true);

    const worker = new Worker(new URL('./graphSimWorker.ts', import.meta.url), { type: 'module' });

    worker.addEventListener('message', (event: MessageEvent<SettleResponse>) => {
      applySettledPositions(simNodes, event.data.positions);

      // Rebuild the same force model here, over the settled positions, so drags
      // continue the physics the worker computed. The container box is read
      // live rather than reusing the request's, so a resize mid-settle leaves
      // the center force pointing at the viewport the user actually has.
      const built = buildSimulation(simNodes, simLinks, container.clientWidth, container.clientHeight);
      sim = built.sim;
      centerForce = built.centerForce;
      // forceSimulation starts alpha at 1. Left there, the first drag's
      // restart() would re-run a full settle and visibly explode the layout;
      // at 0 the graph stays put until alphaTarget lifts it.
      sim.alpha(0);

      // buildSimulation resolved the links' endpoints, so the DOM can now be
      // synced to the settled layout and kept in sync for subsequent drags.
      isSettling = false;
      tick();
      sim.on('tick', tick);

      // Drag: standard d3-force pattern. Pin during drag (so the node follows
      // the cursor exactly), release on drop so the system equilibrates and the
      // user feels the physics respond. Attached only now — there is no live
      // simulation to drag against until the settle lands.
      const dragBehavior = d3drag<SVGGElement, SimNode>()
        .clickDistance(4)
        .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
          if (!event.active) built.sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
          if (!event.active) built.sim.alphaTarget(0);
          d.fx = undefined;
          d.fy = undefined;
        });
      nodeSel.call(dragBehavior);

      setSettling(false);
      zoomToFit(true);
    });

    // A worker that fails to start (a bundling or CSP regression) would
    // otherwise leave the spinner up forever. Reveal the graph — unsettled and
    // visibly wrong — rather than hiding the breakage behind a main-thread
    // fallback that would make the worker silently optional.
    worker.addEventListener('error', (event: ErrorEvent) => {
      logger.error('[FolderGraphView] layout worker failed:', event.message);
      isSettling = false;
      setSettling(false);
    });

    const request: SettleRequest = {
      // Explicitly picked rather than posting simNodes, so the hover-preview
      // cache these accumulate never gets cloned across the boundary.
      nodes: simNodes.map(n => ({
        id: n.id,
        name: n.name,
        isDirectory: n.isDirectory,
        depth: n.depth,
        childCount: n.childCount,
        crossRepelGroup: n.crossRepelGroup,
        bx0: n.bx0,
        by0: n.by0,
        bx1: n.bx1,
        by1: n.by1,
      })),
      // Fresh string-endpoint links: the worker's forceLink resolves them
      // against its own node copies, and simLinks is bound to the DOM here.
      links: rawLinks.map(l => ({ source: l.source, target: l.target })),
      width,
      height,
    };
    worker.postMessage(request);

    /**
     * Called by the ResizeObserver after the container changes size. Re-frames
     * the graph we already have — rebuilding it would re-randomize the layout
     * and throw away the user's zoom, pan, and dragged node positions.
     *
     * The simulation is deliberately not restarted: retargeting the centering
     * force only matters to future ticks (a drag, a rebuild), and the fit below
     * is what actually re-frames a settled graph. Restarting would make the
     * nodes physically drift on every resize tick, which is far more jarring
     * than the empty margin it would fix.
     *
     * Mid-settle there is no simulation here to retarget; the center the worker
     * was given stands, and the settle's own zoomToFit reads the container box
     * live, so the finished layout still lands framed correctly.
     */
    const handleContainerResize = (): void => {
      centerForce?.x(container.clientWidth / 2).y(container.clientHeight / 2);
      if (!userAdjustedView && !isSettling) zoomToFit(false);
    };
    resizeGraphRef.current = handleContainerResize;

    // Returns the useEffect cleanup (an unsubscribe): terminates the layout
    // worker (whose result would land on dead selections), stops the D3 force
    // simulation, detaches its tick and zoom listeners, and drops the
    // repaint/re-frame closures on unmount / before re-run.
    return () => {
      worker.terminate();
      sim?.stop();
      sim?.on('tick', null);
      root.on('.zoom', null);
      applyHighlightRef.current = null;
      resizeGraphRef.current = null;
    };
  }, [folderGraph, ready]);

  useEffect(() => {
    applyHighlightRef.current?.();
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
        <svg
          ref={svgRef}
          className={`absolute inset-0 w-full h-full block ${settling ? 'invisible' : ''}`}
        />
        {settling && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
              <p className="text-sm">
                Laying out {folderGraph.nodes.length} nodes…
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FolderGraphView;
