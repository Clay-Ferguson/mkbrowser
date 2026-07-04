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
import { transformAsync } from './node_modules/@babel/core/lib/index.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = process.cwd();
const explicitFiles = process.argv.slice(2);
const verbose = explicitFiles.length > 0;
const files = verbose
  ? explicitFiles
  : execSync(`find ${root}/src -name "*.ts" -o -name "*.tsx"`, { encoding: 'utf8' })
      .trim().split('\n').filter(f => f && !f.endsWith('.d.ts')).sort();

let bailouts = 0;
let compiled = 0;
for (const file of files) {
  const events = [];
  try {
    await transformAsync(readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [[`${root}/node_modules/babel-plugin-react-compiler/dist/index.js`, {
        panicThreshold: 'none',
        logger: { logEvent(_f, event) { events.push(event); } },
      }]],
    });
  } catch (e) {
    events.push({ kind: 'TransformCrash', detail: String(e.message).split('\n')[0] });
  }
  compiled += events.filter(e => e.kind === 'CompileSuccess').length;
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

console.log(bailouts === 0
  ? `\nReact Compiler coverage: ${compiled} components/hooks compiled across ${files.length} files, zero bailouts.`
  : `\nReact Compiler coverage: ${bailouts} bailout(s)/problem(s) found (${compiled} compiled OK).`);
process.exit(bailouts > 0 ? 1 : 0);
