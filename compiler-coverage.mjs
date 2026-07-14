// Runs babel-plugin-react-compiler — the EXACT version the renderer build uses — over
// renderer sources and reports which components/hooks compiled successfully and which
// bailed out (and why). A bailed-out component is silently de-memoized at build time,
// which matters here because this codebase removed all manual useCallback/useMemo in
// favor of the compiler (see REACT_COMPILER_PLAN.md).
//
// Usage:
//   node compiler-coverage.mjs              # gate mode: scan all of src/, print only
//                                           #   bailouts, exit 1 if any (used by build.sh)
//   node compiler-coverage.mjs [files...]   # verbose mode: per-function report including
//                                           #   successes (still exits 1 on bailouts)
//
// This script is the source of truth, complementing the react-hooks/todo + syntax ESLint
// rules: those embed a NEWER compiler than the build's babel-plugin-react-compiler (so
// they miss constructs only the older build compiler bails on), and they cannot see
// bailouts caused by eslint-disable comments. This script catches both.
//
// It reports two independent failures, both of which silently de-memoize code:
//
//   1. BAILOUT — the compiler tried to compile a function and gave up.
//   2. SKIPPED — Vite would never hand the file to the compiler at all. The build
//      wires the compiler through `reactCompilerPreset()` (vite.renderer.config.mts),
//      and that preset carries a *content-based* filter: Babel only runs on files whose
//      source matches a regex looking for component/hook-shaped declarations. A file
//      this script happily compiles, but that fails that filter, is compiled HERE and
//      not in the real build — the gate would be green while the app ships de-memoized.
//      See the filter check below.
import { transformAsync } from '@babel/core';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = process.cwd();

// The content filter the real build applies, obtained by calling the same public API the
// build calls: vite.renderer.config.mts passes `reactCompilerPreset()` to @rolldown/plugin-babel,
// and the preset carries the filter Babel is run behind. Asking the plugin for it (rather
// than duplicating the regex here) means it cannot drift from the version the build uses.
//
// The shape is validated rather than assumed: if a future plugin release moves or drops
// this filter, fail loudly instead of degrading into a check that silently always passes.
const codeFilter = reactCompilerPreset().rolldown?.filter?.code;
if (!(codeFilter instanceof RegExp)) {
  throw new Error(
    'compiler-coverage: reactCompilerPreset() no longer exposes rolldown.filter.code as a RegExp.\n' +
    '@vitejs/plugin-react changed shape — re-check how the preset decides which files Babel\n' +
    'runs on, and update this script. Do NOT drop this check: it is the only thing verifying\n' +
    'that the files compiled here are the files Vite actually compiles.',
  );
}

const explicitFiles = process.argv.slice(2);
const verbose = explicitFiles.length > 0;
const files = verbose
  ? explicitFiles
  : execSync(`find ${root}/src -name "*.ts" -o -name "*.tsx"`, { encoding: 'utf8' })
      .trim().split('\n').filter(f => f && !f.endsWith('.d.ts')).sort();

let bailouts = 0;
let compiled = 0;
const skippedByVite = [];
for (const file of files) {
  const events = [];
  const source = readFileSync(file, 'utf8');
  try {
    await transformAsync(source, {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [['babel-plugin-react-compiler', {
        panicThreshold: 'none',
        logger: { logEvent(_f, event) { events.push(event); } },
      }]],
    });
  } catch (e) {
    events.push({ kind: 'TransformCrash', detail: String(e.message).split('\n')[0] });
  }
  const successes = events.filter(e => e.kind === 'CompileSuccess');
  compiled += successes.length;

  // The disagreement that matters: this script compiled something in the file, but the
  // real build's filter wouldn't even open it. (The reverse — a file the filter lets
  // through that has nothing to compile — is harmless: Babel runs and finds no work.)
  if (successes.length > 0 && !codeFilter.test(source)) {
    skippedByVite.push({ file, fns: successes.map(e => e.fnName ?? '(anonymous)') });
  }

  const problems = events.filter(e => e.kind !== 'CompileSuccess');
  bailouts += problems.length;
  if (!verbose && problems.length === 0) continue;
  console.log('\n=== ' + file.replace(root + '/', ''));
  for (const e of (verbose ? events : problems)) {
    if (e.kind === 'CompileSuccess') console.log('  OK   ' + (e.fnName ?? '(anonymous)'));
    else if (e.kind === 'CompileError') {
      const d = e.detail ?? {};
      const reason = d.reason ?? d.options?.reason ?? JSON.stringify(d).slice(0, 120);
      console.log('  BAIL ' + (e.fnName ?? '(anonymous)') + ' ' + (e.fnLoc ? `L${e.fnLoc.start?.line}` : '') + ' :: ' + reason);
    } else console.log('  ' + e.kind + ' :: ' + (e.reason ?? e.detail ?? ''));
  }
}

for (const { file, fns } of skippedByVite) {
  console.log('\n=== ' + file.replace(root + '/', ''));
  console.log('  SKIPPED BY VITE :: compiles here, but @vitejs/plugin-react\'s content filter');
  console.log('  excludes this file, so the real build never compiles it: ' + fns.join(', '));
  console.log('  Fix: move the component/hook into a file the filter matches (any file that');
  console.log('  declares a capitalized or use-prefixed binding), rather than, say, a barrel.');
}

console.log(bailouts === 0 && skippedByVite.length === 0
  ? `\nReact Compiler coverage: ${compiled} components/hooks compiled across ${files.length} files, zero bailouts.`
  : `\nReact Compiler coverage: ${bailouts} bailout(s)/problem(s)` +
    `${skippedByVite.length > 0 ? ` and ${skippedByVite.length} file(s) skipped by Vite's filter` : ''}` +
    ` found (${compiled} compiled OK).`);
process.exit(bailouts > 0 || skippedByVite.length > 0 ? 1 : 0);
