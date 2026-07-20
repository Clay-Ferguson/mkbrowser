import {
  buildSimulation,
  seedRadialPositions,
  settleTickCount,
  FLOATS_PER_NODE,
  type SimNode,
  type SimLink,
  type SettleRequest,
  type SettleResponse,
} from './graphSim';

/**
 * Runs the folder graph's initial force-layout settle off the main thread.
 *
 * The settle is pure computation over plain numbers — FolderGraphView.tsx
 * measures each node's label footprint in the DOM and reduces it to four floats
 * *before* posting the request, so nothing here needs a document. That lets the
 * layout run as a plain loop at full speed while the UI thread stays free to
 * animate the wait spinner and handle input.
 *
 * One request, one response: the worker is created per graph build and
 * terminated by the view's effect cleanup, so there is no session state to
 * track here.
 */

/**
 * The slice of DedicatedWorkerGlobalScope this file uses. Declared locally
 * because tsconfig's lib (esnext.full) provides the DOM's `self`, whose
 * postMessage takes a targetOrigin, rather than the worker's.
 */
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<SettleRequest>) => void): void;
  postMessage(message: SettleResponse, transfer: Transferable[]): void;
}

const ctx = self as unknown as WorkerScope;

ctx.addEventListener('message', (event: MessageEvent<SettleRequest>) => {
  const { nodes, links, width, height } = event.data;
  // Structured clone already gave us private copies, so mutating these in place
  // (seeding positions, forceLink resolving string endpoints to node objects)
  // cannot touch the view's data.
  const simNodes: SimNode[] = nodes;
  const simLinks: SimLink[] = links;

  seedRadialPositions(simNodes, simLinks, width / 2, height / 2);
  const { sim } = buildSimulation(simNodes, simLinks, width, height);

  // buildSimulation returns a stopped simulation, so this loop *is* the settle:
  // the same tick count d3's timer would have run, with no frame budget to
  // yield to and no DOM to update.
  const totalTicks = settleTickCount(sim);
  for (let i = 0; i < totalTicks; i++) sim.tick();

  const positions = new Float64Array(simNodes.length * FLOATS_PER_NODE);
  let offset = 0;
  for (const n of simNodes) {
    positions[offset] = n.x ?? 0;
    positions[offset + 1] = n.y ?? 0;
    positions[offset + 2] = n.vx ?? 0;
    positions[offset + 3] = n.vy ?? 0;
    offset += FLOATS_PER_NODE;
  }

  ctx.postMessage({ positions }, [positions.buffer]);
});
