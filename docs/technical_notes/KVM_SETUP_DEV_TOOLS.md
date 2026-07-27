# Setting Up Dev Tools in a KVM Guest

How to give an AI agent (or any developer) running inside a KVM/QEMU virtual machine the ability to
**lint, type-check, and run the unit tests** for this project, when the project folder is shared into
the guest from the host over **virtiofs**.

This documents the setup performed on 2026-07-27, including the two environment quirks that are not
obvious and cost the most time to diagnose.

## The Setup Being Described

| | |
|---|---|
| Host | Ubuntu, project at `/mnt/projects/mkbrowser` on real disk (ext4) |
| Guest | Ubuntu 26.04, x86_64, kernel 7.0 |
| Share | `/mnt/projects` mounted in the guest via **virtiofs** |
| Guest home | `/home/<user>` on the guest's own virtual disk (ext4) — **not** shared |

The critical consequence: **the guest and host see the same `node_modules`.** That is a feature, not
a problem — see [Never run `npm install` in the guest](#never-run-npm-install-in-the-guest).

## Quick Start

Four steps. Steps 1 and 3 need a human with `sudo`; the rest an agent can do itself.

```bash
# 1. Install Node (agent can do this; see the set -e caveat below)
bash ./install-node.sh
# ...if it exits early after installing nvm, finish manually:
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 22.22.3 && nvm alias default 22.22.3

# 2. Expose node/npm/npx to non-interactive shells (REQUIRED — see below)
NB="$HOME/.nvm/versions/node/v22.22.3/bin"
mkdir -p "$HOME/.local/bin"
ln -sf "$NB/node" "$HOME/.local/bin/node"
ln -sf "$NB/npm"  "$HOME/.local/bin/npm"
ln -sf "$NB/npx"  "$HOME/.local/bin/npx"

# 3. Install exiftool — REQUIRES sudo, a human must run this in the guest
sudo apt install libimage-exiftool-perl

# 4. Point the generated test fixtures at a non-virtiofs filesystem
#    (see the birthtime section for why; for a Claude Code agent, set this in
#     ~/.claude/settings.json instead — details below)
export MKB_TEST_DATA_DIR=/tmp/mkb-test-data
```

Verify:

```bash
npm run lint                 # tsc x2 + eslint    -> exit 0, ~50s
npm test                     # vitest             -> 1223 passed, 0 failed, ~12s
node compiler-coverage.mjs   # React Compiler     -> zero bailouts
```

## 1. Node.js

Use the repo's own `install-node.sh`. It pins **Node 22.22.3** (matching `.nvmrc` and the `engines`
field in `package.json`) via **nvm v0.40.3**. Do not substitute a different Node version — see the
warning at the top of that script about Node 24 hanging `npm run make`.

Everything lands in `~/.nvm`, on the guest's own disk. It never touches the shared project folder.

> ### Caveat: `install-node.sh` exits early
>
> The script uses `set -euo pipefail`, and the **nvm installer returns a non-zero exit code** after
> printing `Close and reopen your terminal…`. That aborts the script *after* nvm is installed but
> *before* Node is. There is no error message — it just stops.
>
> Symptom: `ls ~/.nvm/versions/node/` is empty.
>
> Either finish manually (Quick Start step 1) or change line 29 of the script to
> `bash "$INSTALL_SCRIPT" || true`.

## 2. The `~/.local/bin` Symlinks — why nvm alone is not enough

The nvm installer appends its `source` lines to `~/.bashrc`. **This does nothing for an agent.**

An agent's shell is typically **non-interactive and non-login**, and Ubuntu's stock `~/.bashrc`
begins with:

```bash
# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac
```

so it returns immediately. With no `BASH_ENV` set either, **no startup file is read at all** — the
environment is inherited wholesale from the parent process. Consequently:

- Adding `export` lines to `~/.bashrc` (even above the guard) will **not** reach the agent.
- The only thing that reliably works is putting binaries on the PATH the agent already has.

`~/.local/bin` is on the default Ubuntu PATH, so symlinking `node`, `npm`, and `npx` there makes
them resolvable from every shell with no profile involvement. That is what Quick Start step 2 does.

To set an *environment variable* for a Claude Code agent, see
[Configuring the agent's environment](#configuring-the-agents-environment).

## 3. Never run `npm install` in the guest

`/mnt/projects` is a virtiofs share, so **`node_modules` in the guest *is* the host's
`node_modules`** — 1.1 GB, already installed, already correct. Reinstalling from inside the guest
buys nothing and risks diverging from what the host built.

There is no version-drift risk to manage here *precisely because* there is only one copy. Leave it
alone.

This also means the guest needs **no** network access for packages — only for the initial Node
download.

## 4. exiftool — the one step that genuinely needs `sudo`

`npm test` includes 7 tests (`tests/writeExifMetadata.test.ts`, `tests/imageDimensions.test.ts`)
that shell out to **exiftool**. Without it they fail with `spawn exiftool ENOENT` after burning a
5-second timeout each.

```bash
sudo apt install libimage-exiftool-perl     # installs /usr/bin/exiftool
```

### It must be in `/usr/bin` — a PATH symlink will NOT work

This is the non-obvious part, and it wastes an afternoon if you don't know it.

`src/main/exifUtil.ts` deliberately runs the **system** exiftool via `exiftoolPath: 'exiftool'` (a
bare name resolved through PATH) rather than the perl copy vendored in `exiftool-vendored.pl` —
perl cannot read files inside the asar. See the comment block at the top of that file.

But `exiftool-vendored` spawns the child process with a **scrubbed environment**. In its
`ExifTool.js` the spawn options are built as:

```js
const env = { ...o.exiftoolEnv, LANG: "C" };   // note: no PATH
```

libuv replaces `environ` with that object *before* calling `execvp`, so the lookup for the bare name
`exiftool` falls back to glibc's compiled-in default path — **`/bin:/usr/bin`** — and nothing else.

Therefore:

- ✅ `/usr/bin/exiftool` (what the apt package installs) — works
- ❌ `~/.local/bin/exiftool` — invisible to the spawn, even though `command -v exiftool` finds it
- ❌ a symlink to `node_modules/exiftool-vendored.pl/bin/exiftool` on PATH — same reason

Ubuntu ships exiftool **13.50**; the vendored copy is **13.59**. The skew is harmless for this test
suite.

If you ever see `spawn exiftool ENOENT` return, it is a missing *system package*, never a code
defect.

## 5. birthtime — virtiofs reports no creation time

Two tests in `tests/search.test.ts` assert `expect(r.createdTime).toBeGreaterThan(0)`. On virtiofs,
`fs.statSync().birthtimeMs` is **`0`** for every file, so they fail:

```
AssertionError: expected 0 to be greater than 0
```

Confirm with `stat`:

```bash
stat /mnt/projects/mkbrowser/package.json | tail -1   # Birth: -
stat ~/.bashrc | tail -1                              # Birth: 2026-07-25 …
```

The guest kernel is not the limitation — FUSE gained `statx` support in Linux 6.6 and this guest
runs 7.0. virtiofsd simply does not supply a birth time. Whether a newer virtiofsd can is untested
here; treat it as unavailable.

### The fix: put the generated fixtures on a different filesystem

`tests/fixtures/setup.ts` honors an override:

```ts
export const TEST_DATA_DIR = process.env.MKB_TEST_DATA_DIR
  ? path.resolve(process.env.MKB_TEST_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'test-data');
```

Set `MKB_TEST_DATA_DIR=/tmp/mkb-test-data`. `/tmp` is **tmpfs**, which *does* report birthtime, and
the directory is fully generated and disposable (the suite wipes and rebuilds it every run), so
nothing is lost by relocating it.

Unset, the default is unchanged — `<projectRoot>/test-data`, exactly as the host has always used it.
**The host needs no configuration and behaves identically.**

Two things this override deliberately does *not* affect:

- **The e2e/Playwright suite.** It never imports `tests/fixtures/setup.ts`; its `testDataPath`
  fixture points at `<projectRoot>/mkbrowser-test`, a different folder entirely.
- **`tests/preprocess.test.ts`**, which computes its own path under the project root.

## Configuring the agent's environment

Since no shell startup file is read (see §2), `~/.bashrc` cannot deliver `MKB_TEST_DATA_DIR` to a
Claude Code agent. Use the `env` block in the agent's **user** settings instead:

```jsonc
// ~/.claude/settings.json   (guest-local — NOT the shared project folder)
{
  "theme": "dark",
  "model": "opus",
  "env": {
    "MKB_TEST_DATA_DIR": "/tmp/mkb-test-data"
  }
}
```

Put this in **`~/.claude/settings.json`**, not `.claude/settings.json` inside the project — the
project folder is shared, so a setting placed there would follow the repo onto the host and into
every other machine.

Claude Code picks the change up immediately via its settings watcher; no restart was needed.

## Verifying the Result

```bash
npm run lint                 # exit 0
npm test                     # 1223 passed (43 files), 0 failed, ~12s
node compiler-coverage.mjs   # 88 components/hooks compiled, zero bailouts
```

**A fully green suite is the expected baseline.** If you skip the exiftool or birthtime steps you
get 9 failures (7 + 2 respectively) that are purely environmental — but rather than memorize an
"expected failures" list, just do both steps and let any failure mean something.

## What This Setup Does *Not* Cover

- **git** — deliberately not provided to the agent in this configuration.
- **Playwright / e2e tests** — not set up. `tests/e2e/` launches the **packaged** Electron build and
  would additionally need `npx playwright install` plus a display (or xvfb) and the usual Electron
  system libraries.
- **`npm run package` / `build.sh`** — untested in the guest.
- **Running the app** — no display server.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `node: command not found` in agent shells, but works in your terminal | `~/.bashrc` isn't read by non-interactive shells | Create the `~/.local/bin` symlinks (§2) |
| `ls ~/.nvm/versions/node/` empty after running `install-node.sh` | Script's `set -e` aborted on the nvm installer's exit code | Finish manually (Quick Start step 1) |
| `spawn exiftool ENOENT`, 5s timeouts, 7 failures | exiftool missing, or installed somewhere other than `/bin`/`/usr/bin` | `sudo apt install libimage-exiftool-perl` (§4) |
| `expected 0 to be greater than 0` on `createdTime`, 2 failures | Fixtures are on virtiofs, which has no birthtime | Set `MKB_TEST_DATA_DIR` (§5) |
| `engine-strict` / Node version errors | `.npmrc` sets `engine-strict=true`; `package.json` requires Node >= 22 | Install 22.22.3, not something older |
