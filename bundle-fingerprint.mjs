// Asserts the React Compiler's output actually shipped in the packaged renderer
// bundle. This is the one gate that runs AFTER Vite: compiler-coverage.mjs (and
// lint, and tsc) all invoke the compiler standalone, so by construction none of
// them can detect the compiler being configured out of the Vite pipeline — which
// is exactly what happened during the Vite 8 / plugin-react 6 upgrade: the old
// `react({ babel: ... })` option was silently ignored by plugin-react 6,
// de-memoizing the entire app while every other gate stayed green.
//
// The signal: the compiler's emitted code references the react.memo_cache_sentinel
// symbol, and the number of occurrences scales with the number of compiled
// functions (85 functions produce ~217 occurrences today). With the compiler wired
// in, the count comfortably exceeds the compiled-function count; with it configured
// out, the count collapses to near zero. So the floor is the compiled-function
// count that compiler-coverage.mjs records in .compiler-coverage-count.json when
// its gate passes — the floor self-adjusts as components are added or removed.
//
// Usage: node bundle-fingerprint.mjs
//
// Runs as the postPackage Forge hook in forge.config.ts, so every
// `npm run package` / `npm run make` is gated. It cannot run earlier (e.g. from
// the prePackage hook) — the bundle does not exist until packaging builds it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const assetsDir = join(root, '.vite', 'renderer', 'main_window', 'assets');
const countFile = join(root, '.compiler-coverage-count.json');
const SENTINEL = 'react.memo_cache_sentinel';

if (!existsSync(assetsDir)) {
  console.error(`bundle-fingerprint: ${assetsDir} not found.`);
  console.error('Run `npm run package` (or `npm run make`) first — this check reads the built renderer bundle.');
  process.exit(1);
}

if (!existsSync(countFile)) {
  console.error(`bundle-fingerprint: ${countFile} not found.`);
  console.error('Run `node compiler-coverage.mjs` first (the prePackage hook does this); a passing run records');
  console.error('the compiled-function count there, which sets this check\'s floor.');
  process.exit(1);
}

const floor = JSON.parse(readFileSync(countFile, 'utf8')).compiled;
if (!Number.isInteger(floor) || floor <= 0) {
  console.error(`bundle-fingerprint: invalid "compiled" value in ${countFile}: ${floor}`);
  console.error('Re-run `node compiler-coverage.mjs` to regenerate it.');
  process.exit(1);
}

const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
let sentinels = 0;
for (const f of jsFiles) {
  sentinels += readFileSync(join(assetsDir, f), 'utf8').split(SENTINEL).length - 1;
}

if (sentinels < floor) {
  console.error(`bundle-fingerprint: FAIL — ${sentinels} "${SENTINEL}" occurrence(s) across ${jsFiles.length} JS asset(s); expected at least ${floor} (the compiled-function count from compiler-coverage.mjs).`);
  console.error('The React Compiler is partially or fully configured out of the Vite build — the app would');
  console.error('ship de-memoized. Check the babel({ presets: [reactCompilerPreset()] }) wiring in');
  console.error('vite.renderer.config.mts.');
  process.exit(1);
}

console.log(`bundle-fingerprint: OK — ${sentinels} "${SENTINEL}" occurrence(s) in the renderer bundle (floor: ${floor}).`);
