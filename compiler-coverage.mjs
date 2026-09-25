// Runs babel-plugin-react-compiler — the EXACT version the renderer build uses — over
// renderer sources and reports which components/hooks compiled successfully and which
// bailed out (and why). A bailed-out component is silently de-memoized at build time,
// which matters here because this codebase removed all manual useCallback/useMemo in
// favor of the compiler (see REACT_COMPILER_PLAN.md).
//
// Usage:
//   node compiler-coverage.mjs              # gate mode: scan all of src/, print only
//                                           #   problems, exit 1 if any (runs as the
//                                           #   prePackage Forge hook in forge.config.ts)
//   node compiler-coverage.mjs [files...]   # verbose mode: per-function report including
//                                           #   successes (still exits 1 on problems)
//
// This script is the source of truth, complementing the react-hooks/todo + syntax ESLint
// rules: those embed a NEWER compiler than the build's babel-plugin-react-compiler (so
// they miss constructs only the older build compiler bails on), and they cannot see
// bailouts caused by eslint-disable comments. This script catches both.
//
// It reports four independent failures, all of which silently de-memoize code:
//
//   1. BAILOUT — the compiler tried to compile a function and gave up.
//   2. SKIPPED — Vite would never hand the file to the compiler at all. The build
//      wires the compiler through `reactCompilerPreset()` (vite.renderer.config.mts),
//      and that preset carries a *content-based* filter: Babel only runs on files whose
//      source matches a regex looking for component/hook-shaped declarations. A file
//      this script happily compiles, but that fails that filter, is compiled HERE and
//      not in the real build — the gate would be green while the app ships de-memoized.
//      See the filter check below.
//   3. UNCOMPILED — a PascalCase function containing JSX (i.e. a component) that the
//      compiler never even attempted. The compiler only considers MODULE-LEVEL
//      components and hooks, so a component returned from a factory
//      (`function make(x) { return function Foo() {...} }`) or declared inside another
//      function can be skipped without any bailout event — invisible to checks 1 and 2.
//      Fix by making it a top-level component and passing the closed-over values as
//      props or through context (see blockClickComponents.tsx / markdownEntryContext.ts).
//   4. UNCOMPILED HOOK — a `use*` function the compiler never attempted. In infer mode a
//      `use*` function is only treated as a hook if it actually calls a hook, so a
//      "hook" that calls none (e.g. `function useX(p) { return () => f(p); }`) is
//      skipped, and hands every caller a fresh value each render. Either it should call
//      a hook, or it isn't one: inline it at the call sites (where the compiler memoizes
//      it) or rename it to a plain function.
//
// Neither failure mode covers the compiler being configured out of the Vite pipeline
// entirely (this script bypasses Vite by design). That case is caught downstream:
// a clean gate-mode run records the compiled-function count in
// .compiler-coverage-count.json, and bundle-fingerprint.mjs (the postPackage Forge
// hook, run AFTER packaging) asserts the built renderer bundle contains at least
// that much compiler output.
import { transformAsync, parseAsync, traverse } from '@babel/core';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
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

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z0-9]/;

// Name a function the way a reader would: its own id, else the variable it's assigned to
// (`const Foo = () => ...`, `const Foo = function () {...}`).
function functionName(path) {
  if (path.node.id) return path.node.id.name;
  const parent = path.parent;
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  return null;
}

// Components (PascalCase functions whose body contains JSX) and hooks (`use*` functions) that
// the compiler neither compiled nor reported a bailout for — see UNCOMPILED and UNCOMPILED
// HOOK in the header. Compiler events carry the function's start offset, which identifies
// it in our own parse of the same source.
async function findUncompiled(file, source, events) {
  const seen = new Set(events.map(e => e.fnLoc?.start?.index).filter(i => i !== undefined));
  const ast = await parseAsync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
  });
  const found = [];
  traverse(ast, {
    Function(path) {
      const name = functionName(path);
      if (!name || seen.has(path.node.start)) return;
      const line = path.node.loc.start.line;
      if (HOOK_NAME.test(name)) {
        found.push({ kind: 'hook', name, line });
        return;
      }
      if (!PASCAL_CASE.test(name)) return;
      let hasJsx = false;
      path.traverse({
        JSXElement(p) { hasJsx = true; p.stop(); },
        JSXFragment(p) { hasJsx = true; p.stop(); },
      });
      if (hasJsx) found.push({ kind: 'component', name, line });
    },
  });
  return found;
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
const uncompiled = [];
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

  const fns = await findUncompiled(file, source, events);
  if (fns.length > 0) uncompiled.push({ file, fns });

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

for (const { file, fns } of uncompiled) {
  console.log('\n=== ' + file.replace(root + '/', ''));
  for (const { kind, name, line } of fns) {
    if (kind === 'component') {
      console.log(`  UNCOMPILED ${name} L${line} :: component-like function the compiler never attempted`);
      console.log('    Fix: the compiler only compiles module-level components. Make it top-level and pass');
      console.log('    closed-over values as props or via context instead of a factory/nested function.');
    } else {
      console.log(`  UNCOMPILED HOOK ${name} L${line} :: use* function the compiler never attempted`);
      console.log('    Fix: a use* function counts as a hook only if it calls one (and only at module level).');
      console.log('    If it calls no hooks, it is not a hook: inline it at the call sites or rename it.');
    }
  }
}

const uncompiledCount = uncompiled.reduce((sum, u) => sum + u.fns.filter(f => f.kind === 'component').length, 0);
const uncompiledHookCount = uncompiled.reduce((sum, u) => sum + u.fns.filter(f => f.kind === 'hook').length, 0);
const clean = bailouts === 0 && skippedByVite.length === 0 && uncompiledCount === 0 && uncompiledHookCount === 0;
console.log(clean
  ? `\nReact Compiler coverage: ${compiled} components/hooks compiled across ${files.length} files, zero bailouts.`
  : `\nReact Compiler coverage: ${bailouts} bailout(s)/problem(s)` +
    `${skippedByVite.length > 0 ? `, ${skippedByVite.length} file(s) skipped by Vite's filter` : ''}` +
    `${uncompiledCount > 0 ? `, ${uncompiledCount} uncompiled component(s)` : ''}` +
    `${uncompiledHookCount > 0 ? `, ${uncompiledHookCount} uncompiled hook(s)` : ''}` +
    ` found (${compiled} compiled OK).`);

// On a clean full-scan run, record the compiled count for bundle-fingerprint.mjs,
// which uses it as the floor for how much compiler output the packaged renderer
// bundle must contain (see the header). Verbose runs scan a subset, so their count
// would be a meaninglessly low floor.
if (clean && !verbose) {
  writeFileSync(`${root}/.compiler-coverage-count.json`,
    JSON.stringify({ compiled, generatedAt: new Date().toISOString() }) + '\n');
}
process.exit(clean ? 0 : 1);
