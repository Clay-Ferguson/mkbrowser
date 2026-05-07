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
import 'd3-transition';
import {
  useFolderGraph,
  useHighlightItem,
  navigateToBrowserPath,
  setHighlightItem,
} from '../../store';

interface SimNode extends SimulationNodeDatum {
  id: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  childCount: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

const NODE_RADIUS_BASE = 5;
const LABEL_MAX_CHARS = 24;

// Node colors by type, tuned for a dark slate-900 background.
const COLOR_ROOT = '#ef4444';     // bright red
const COLOR_FOLDER = '#fb923c';   // orange
const COLOR_MARKDOWN = '#60a5fa'; // blue
const COLOR_OTHER = '#cbd5e1';    // light gray
const COLOR_HIGHLIGHT = '#a855f7'; // purple

function colorForNode(d: SimNode, highlighted: boolean): string {
  if (highlighted) return COLOR_HIGHLIGHT;
  if (d.depth === 0) return COLOR_ROOT;
  if (d.isDirectory) return COLOR_FOLDER;
  const lower = d.name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return COLOR_MARKDOWN;
  return COLOR_OTHER;
}

function nodeRadius(d: SimNode): number {
  if (!d.isDirectory) return NODE_RADIUS_BASE;
  return NODE_RADIUS_BASE + Math.min(10, Math.sqrt(d.childCount));
}

function truncateLabel(name: string): string {
  return name.length > LABEL_MAX_CHARS ? name.slice(0, LABEL_MAX_CHARS - 1) + '…' : name;
}

function FolderGraphView() {
  const folderGraph = useFolderGraph();
  const highlightItem = useHighlightItem();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const highlightRef = useRef<string | null>(highlightItem);
  highlightRef.current = highlightItem;
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
    }));
    const simLinks: SimLink[] = rawLinks.map(l => ({ source: l.source, target: l.target }));

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
    nodeSel.append('text')
      .attr('x', d => nodeRadius(d) + 4)
      .attr('y', '0.32em')
      .attr('font-size', 11)
      .attr('fill', d => colorForNode(d, false))
      .attr('paint-order', 'stroke')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.75)
      .text(d => truncateLabel(d.name));

    const applyHighlight = (): void => {
      circleSel.attr('fill', d => colorForNode(d, highlightRef.current === d.id));
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
        const parent = d.id.substring(0, d.id.lastIndexOf('/'));
        navigateToBrowserPath(parent, d.id);
      }
    });

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(60).strength(0.7))
      .force('charge', forceManyBody<SimNode>().strength(-220))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius(d => nodeRadius(d) + 4));

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
      <header className="flex-shrink-0 px-4 py-2 border-b border-slate-700">
        <div className="text-sm text-slate-300 truncate" title={folderGraph.folderPath}>
          <span className="text-slate-400">Folder Graph:</span>{' '}
          <span className="font-mono text-slate-200">{folderGraph.folderPath}</span>
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
